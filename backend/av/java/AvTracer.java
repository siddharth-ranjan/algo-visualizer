import com.sun.jdi.*;
import com.sun.jdi.connect.Connector;
import com.sun.jdi.connect.LaunchingConnector;
import com.sun.jdi.event.*;
import com.sun.jdi.request.*;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/**
 * JDI-based step tracer.
 *
 * Launches the target program under debug control and records a linear stream
 * of call / line / return events as newline-delimited JSON. Frames get an
 * invocation-unique id (fid) so recursive calls never collide.
 *
 * Usage:
 *   AvTracer <classpath> <mainClass> <userClassesCSV> <eventsOut> <stdoutOut> <maxEvents> <wallMillis>
 */
public final class AvTracer {

    private static Writer sink;
    private static long seq = 0;
    private static long nextFid = 1;
    private static final Deque<long[]> frames = new ArrayDeque<>(); // [fid, depth]
    private static final Map<Long, Map<String, String>> lastVars = new HashMap<>();
    private static Set<String> userClasses;
    private static long maxEvents;
    private static long deadline;
    private static String stopReason = "completed";
    private static int maxDepthSeen = 0;
    private static long callCount = 0;

    public static void main(String[] argv) throws Exception {
        String classpath   = argv[0];
        String mainClass   = argv[1];
        userClasses        = new LinkedHashSet<>(Arrays.asList(argv[2].split(",")));
        Path eventsOut     = Paths.get(argv[3]);
        Path stdoutOut     = Paths.get(argv[4]);
        maxEvents          = Long.parseLong(argv[5]);
        long wallMillis    = Long.parseLong(argv[6]);
        deadline = System.currentTimeMillis() + wallMillis;

        sink = Files.newBufferedWriter(eventsOut, StandardCharsets.UTF_8);

        LaunchingConnector conn = Bootstrap.virtualMachineManager().defaultConnector();
        Map<String, Connector.Argument> args = conn.defaultArguments();
        args.get("main").setValue(mainClass);
        args.get("options").setValue("-cp \"" + classpath + "\" -Xmx256m -Xss16m -XX:-UsePerfData");
        args.get("suspend").setValue("true");

        VirtualMachine vm = conn.launch(args);
        Process proc = vm.process();
        Thread outPump = pump(proc.getInputStream(), stdoutOut);
        Thread errPump = pump(proc.getErrorStream(), null);

        EventRequestManager erm = vm.eventRequestManager();
        for (String cls : userClasses) {
            MethodEntryRequest me = erm.createMethodEntryRequest();
            me.addClassFilter(cls);
            me.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
            me.enable();

            MethodExitRequest mx = erm.createMethodExitRequest();
            mx.addClassFilter(cls);
            mx.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
            mx.enable();
        }

        boolean stepArmed = false;
        vm.resume();

        EventQueue queue = vm.eventQueue();
        loop:
        while (true) {
            EventSet set;
            try {
                set = queue.remove(250);
            } catch (InterruptedException ie) {
                break;
            }
            if (set == null) {
                if (System.currentTimeMillis() > deadline) { stopReason = "timeout"; break; }
                continue;
            }
            for (Event ev : set) {
                if (ev instanceof VMDeathEvent || ev instanceof VMDisconnectEvent) break loop;

                if (System.currentTimeMillis() > deadline) { stopReason = "timeout"; break loop; }
                if (seq >= maxEvents) { stopReason = "event_budget"; break loop; }

                if (ev instanceof MethodEntryEvent mee) {
                    onCall(mee);
                    if (!stepArmed) {
                        armStepping(erm, mee.thread());
                        stepArmed = true;
                    }
                } else if (ev instanceof MethodExitEvent mxe) {
                    onReturn(mxe);
                } else if (ev instanceof StepEvent se) {
                    onLine(se);
                }
            }
            set.resume();
        }

        emitSummary();
        sink.flush();
        sink.close();
        try { vm.exit(0); } catch (Exception ignored) {}
        try { proc.destroy(); } catch (Exception ignored) {}
        outPump.join(1000);
        errPump.join(1000);
    }

    private static void armStepping(EventRequestManager erm, ThreadReference t) {
        StepRequest sr = erm.createStepRequest(t, StepRequest.STEP_LINE, StepRequest.STEP_INTO);
        for (String ex : new String[]{"java.*", "javax.*", "sun.*", "jdk.*", "com.sun.*", "kotlin.*"}) {
            sr.addClassExclusionFilter(ex);
        }
        sr.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
        sr.enable();
    }

    // ---- event handlers -------------------------------------------------

    private static void onCall(MethodEntryEvent e) throws Exception {
        Location loc = e.location();
        Method method = loc.method();
        int depth = frameCount(e.thread());
        long fid = nextFid++;
        Long parent = frames.isEmpty() ? null : frames.peek()[0];
        frames.push(new long[]{fid, depth});
        maxDepthSeen = Math.max(maxDepthSeen, frames.size());
        callCount++;

        StringBuilder sb = new StringBuilder();
        sb.append("{\"ev\":\"call\",\"seq\":").append(seq++)
          .append(",\"fid\":").append(fid)
          .append(",\"parent\":").append(parent == null ? "null" : parent)
          .append(",\"depth\":").append(frames.size() - 1)
          .append(",\"cls\":").append(json(loc.declaringType().name()))
          .append(",\"m\":").append(json(method.name()))
          .append(",\"sig\":").append(json(readableSig(method)))
          .append(",\"line\":").append(loc.lineNumber())
          .append(",\"args\":");
        appendVars(sb, e.thread(), true);
        sb.append('}');
        writeLine(sb);
        lastVars.remove(fid);
    }

    private static void onReturn(MethodExitEvent e) throws Exception {
        if (frames.isEmpty()) return;
        long fid = frames.pop()[0];
        lastVars.remove(fid);

        StringBuilder sb = new StringBuilder();
        sb.append("{\"ev\":\"return\",\"seq\":").append(seq++)
          .append(",\"fid\":").append(fid)
          .append(",\"depth\":").append(frames.size())
          .append(",\"line\":").append(e.location().lineNumber())
          .append(",\"value\":");
        Value rv = e.returnValue();
        if (rv == null || rv instanceof VoidValue) sb.append("null");
        else renderValue(sb, rv, 0);
        sb.append('}');
        writeLine(sb);
    }

    private static void onLine(StepEvent e) throws Exception {
        Location loc = e.location();
        if (!userClasses.contains(loc.declaringType().name())) return;
        if (frames.isEmpty()) return;
        long fid = frames.peek()[0];

        StringBuilder sb = new StringBuilder();
        sb.append("{\"ev\":\"line\",\"seq\":").append(seq++)
          .append(",\"fid\":").append(fid)
          .append(",\"depth\":").append(frames.size() - 1)
          .append(",\"line\":").append(loc.lineNumber())
          .append(",\"vars\":");
        appendVars(sb, e.thread(), false);
        sb.append('}');
        writeLine(sb);
    }

    // ---- variable capture ------------------------------------------------

    /** Appends a JSON object of variables; when `onlyArgs`, restricts to parameters.
     *  For line events only *changed* variables are emitted, keyed off the frame. */
    private static void appendVars(StringBuilder sb, ThreadReference t, boolean onlyArgs) {
        Map<String, String> rendered = new LinkedHashMap<>();
        try {
            StackFrame f = t.frame(0);
            List<LocalVariable> vars;
            try {
                vars = f.visibleVariables();
            } catch (AbsentInformationException ai) {
                sb.append("{}");
                return;
            }
            Map<LocalVariable, Value> values = f.getValues(vars);
            for (LocalVariable lv : vars) {
                if (onlyArgs && !lv.isArgument()) continue;
                StringBuilder one = new StringBuilder();
                renderValue(one, values.get(lv), 0);
                rendered.put(lv.name(), one.toString());
            }
        } catch (Exception ex) {
            sb.append("{}");
            return;
        }

        Map<String, String> emit = rendered;
        if (!onlyArgs && !frames.isEmpty()) {
            long fid = frames.peek()[0];
            Map<String, String> prev = lastVars.get(fid);
            if (prev != null) {
                emit = new LinkedHashMap<>();
                for (Map.Entry<String, String> en : rendered.entrySet()) {
                    if (!en.getValue().equals(prev.get(en.getKey()))) emit.put(en.getKey(), en.getValue());
                }
            }
            lastVars.put(fid, rendered);
        }

        sb.append('{');
        boolean first = true;
        for (Map.Entry<String, String> en : emit.entrySet()) {
            if (!first) sb.append(',');
            first = false;
            sb.append(json(en.getKey())).append(':').append(en.getValue());
        }
        sb.append('}');
    }

    /** Renders a JDI value as {"t":<type>,"v":<json>[,"ref":<id>]}. */
    private static void renderValue(StringBuilder sb, Value v, int depth) {
        if (v == null) { sb.append("{\"t\":\"null\",\"v\":null}"); return; }

        if (v instanceof ArrayReference arr) {
            String type = arr.type().name();
            sb.append("{\"t\":").append(json(type))
              .append(",\"ref\":").append(arr.uniqueID())
              .append(",\"n\":").append(arr.length())
              .append(",\"v\":");
            if (depth >= 3) { sb.append("null}"); return; }
            int n = Math.min(arr.length(), 256);
            sb.append('[');
            List<Value> items = n == 0 ? List.of() : arr.getValues(0, n);
            for (int i = 0; i < n; i++) {
                if (i > 0) sb.append(',');
                renderValue(sb, items.get(i), depth + 1);
            }
            sb.append(']');
            if (n < arr.length()) sb.append(",\"truncated\":true");
            sb.append('}');
            return;
        }
        if (v instanceof StringReference s) {
            sb.append("{\"t\":\"String\",\"v\":").append(json(s.value())).append('}');
            return;
        }
        if (v instanceof PrimitiveValue) {
            String t = v.type().name();
            String out;
            if (v instanceof CharValue c)        out = json(String.valueOf(c.value()));
            else if (v instanceof BooleanValue b) out = String.valueOf(b.value());
            else if (v instanceof DoubleValue d)  out = finite(d.value());
            else if (v instanceof FloatValue fl)  out = finite(fl.value());
            else                                  out = v.toString();
            sb.append("{\"t\":").append(json(t)).append(",\"v\":").append(out).append('}');
            return;
        }
        ObjectReference o = (ObjectReference) v;
        sb.append("{\"t\":").append(json(o.referenceType().name()))
          .append(",\"ref\":").append(o.uniqueID())
          .append(",\"v\":null}");
    }

    // ---- plumbing --------------------------------------------------------

    private static String finite(double d) {
        return (Double.isNaN(d) || Double.isInfinite(d)) ? json(String.valueOf(d)) : String.valueOf(d);
    }

    private static int frameCount(ThreadReference t) {
        try { return t.frameCount(); } catch (Exception e) { return frames.size(); }
    }

    private static String readableSig(Method m) {
        StringBuilder sb = new StringBuilder(m.name()).append('(');
        try {
            List<String> names = m.argumentTypeNames();
            for (int i = 0; i < names.size(); i++) {
                if (i > 0) sb.append(", ");
                sb.append(simple(names.get(i)));
            }
        } catch (Exception ignored) {}
        return sb.append(')').toString();
    }

    private static String simple(String fqn) {
        int i = fqn.lastIndexOf('.');
        return i < 0 ? fqn : fqn.substring(i + 1);
    }

    private static void writeLine(StringBuilder sb) throws IOException {
        sink.write(sb.toString());
        sink.write('\n');
    }

    private static void emitSummary() throws IOException {
        StringBuilder sb = new StringBuilder();
        sb.append("{\"ev\":\"summary\",\"seq\":").append(seq++)
          .append(",\"stopReason\":").append(json(stopReason))
          .append(",\"events\":").append(seq)
          .append(",\"calls\":").append(callCount)
          .append(",\"maxDepth\":").append(maxDepthSeen)
          .append('}');
        writeLine(sb);
    }

    private static Thread pump(InputStream in, Path out) {
        Thread t = new Thread(() -> {
            try (InputStream i = in) {
                byte[] buf = new byte[8192];
                ByteArrayOutputStream acc = new ByteArrayOutputStream();
                int r;
                while ((r = i.read(buf)) > 0) {
                    acc.write(buf, 0, r);
                    if (acc.size() > 1 << 20) break;
                }
                if (out != null) Files.write(out, acc.toByteArray());
            } catch (IOException ignored) {}
        });
        t.setDaemon(true);
        t.start();
        return t;
    }

    private static String json(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"'  -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> {
                    if (c < 0x20 || c > 0x7e) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
                }
            }
        }
        return sb.append('"').toString();
    }
}
