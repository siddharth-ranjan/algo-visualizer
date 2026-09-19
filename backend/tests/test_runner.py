"""End-to-end: these compile and trace real Java, so they need a JDK."""

import pytest

from av import driver, runner


FIB = """
class Solution {
    public int fib(int n) {
        if (n < 2) return n;
        return fib(n - 1) + fib(n - 2);
    }
}
"""

SWAPPER = """
class Solution {
    public int[] reverse(int[] a) {
        for (int i = 0, j = a.length - 1; i < j; i++, j--) {
            int t = a[i]; a[i] = a[j]; a[j] = t;
        }
        return a;
    }
}
"""


def test_recursive_trace_has_a_full_call_tree():
    r = runner.run_java(FIB, [5])
    assert r.stdout.strip() == "5"
    calls = [e for e in r.events if e["ev"] == "call" and e["m"] == "fib"]
    assert len(calls) == 15          # fib(5) makes 15 calls
    assert r.summary["stopReason"] == "completed"

    returns = {e["fid"]: e["value"] for e in r.events if e["ev"] == "return"}
    root = calls[0]
    assert returns[root["fid"]] == {"t": "int", "v": 5}


def test_array_mutations_are_captured_with_stable_refs():
    r = runner.run_java(SWAPPER, [[1, 2, 3, 4]])
    assert r.stdout.strip() == "[4, 3, 2, 1]"
    refs = {
        v["ref"]
        for e in r.events
        for v in {**e.get("vars", {}), **e.get("args", {})}.values()
        if isinstance(v, dict) and v.get("t") == "int[]"
    }
    assert len(refs) == 1, "the same array must keep one identity across frames"


def test_compile_errors_do_not_leak_temp_paths():
    with pytest.raises(runner.RunError) as exc:
        runner.run_java("class Solution { public int f(int x) { return nope; } }", [1])
    assert exc.value.stage == "compile"
    assert "/tmp" not in exc.value.message
    assert "Solution.java" in exc.value.message


def test_event_budget_truncates_rather_than_hanging():
    limits = runner.Limits(max_events=200)
    r = runner.run_java(FIB, [18], limits=limits)
    assert r.summary["stopReason"] == "event_budget"
    assert len(r.events) <= 220


def test_unsupported_param_type_is_rejected_before_compiling():
    src = "class Solution { public int f(java.io.File f) { return 0; } }"
    with pytest.raises(driver.DriverError, match="Unsupported parameter type"):
        runner.run_java(src, [{"path": "x"}])
