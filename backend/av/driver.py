"""Synthesises a runnable `main` for LeetCode-style solution classes.

Users paste a bare `class Solution { public int foo(int[] a, int k) {...} }`
with no entry point. We locate the public method, render the supplied JSON
input as Java literals, and emit an AvMain that calls it.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

CLASS_RE = re.compile(
    r"^[ \t]*(?:public\s+|final\s+|abstract\s+)*class\s+(\w+)", re.MULTILINE
)
METHOD_RE = re.compile(
    r"\bpublic\s+(?!class\b|interface\b|enum\b|record\b)"
    r"((?:[\w.$]+(?:<[^;{}]*?>)?(?:\s*\[\s*\])*)|void)\s+"
    r"(\w+)\s*\(([^)]*)\)\s*(?:throws\s[\w.,\s]+)?\{",
    re.MULTILINE,
)


class DriverError(ValueError):
    pass


@dataclass
class Param:
    type: str
    name: str


@dataclass
class Entry:
    cls: str
    method: str
    ret: str
    params: list[Param] = field(default_factory=list)

    @property
    def label(self) -> str:
        ps = ", ".join(f"{p.type} {p.name}" for p in self.params)
        return f"{self.ret} {self.method}({ps})"


def _split_params(blob: str) -> list[Param]:
    """Comma-split that respects generic nesting: Map<String, Integer> x."""
    out, depth, cur = [], 0, ""
    for ch in blob:
        if ch == "<":
            depth += 1
        elif ch == ">":
            depth -= 1
        if ch == "," and depth == 0:
            out.append(cur)
            cur = ""
        else:
            cur += ch
    if cur.strip():
        out.append(cur)

    params = []
    for chunk in out:
        toks = chunk.replace("final ", "").strip().split()
        if len(toks) < 2:
            raise DriverError(f"Cannot parse parameter: {chunk.strip()!r}")
        name = toks[-1]
        ptype = " ".join(toks[:-1])
        # trailing C-style array dims: int nums[]
        while name.endswith("[]"):
            name, ptype = name[:-2], ptype + "[]"
        params.append(Param(re.sub(r"\s+", "", ptype), name))
    return params


def find_entry(source: str, prefer: str | None = None) -> Entry:
    classes = CLASS_RE.findall(source)
    if not classes:
        raise DriverError("No class declaration found in the submitted source.")
    cls = classes[0]

    candidates = []
    for ret, name, params in METHOD_RE.findall(source):
        if name == "main":
            continue
        candidates.append(Entry(cls, name, re.sub(r"\s+", "", ret), _split_params(params)))
    if not candidates:
        raise DriverError(
            f"class {cls} has no public method to visualise. "
            "Mark the method you want traced as `public`."
        )
    if prefer:
        for c in candidates:
            if c.method == prefer:
                return c
        raise DriverError(f"No public method named {prefer!r} was found.")
    return candidates[0]


# --- JSON input -> Java literal ------------------------------------------

_PRIMS = {"int", "long", "short", "byte", "float", "double", "boolean", "char"}


def to_literal(jtype: str, value, nested: bool = False) -> str:
    """Render a JSON value as a Java literal.

    Only the outermost array spells out `new T[]{...}`; inner dimensions are
    bare brace initialisers, which is what Java's grammar requires.
    """
    t = jtype.strip()

    if t.endswith("[]"):
        if not isinstance(value, list):
            raise DriverError(f"Expected a list for {t}, got {type(value).__name__}.")
        inner = t[:-2]
        items = ", ".join(to_literal(inner, v, nested=True) for v in value)
        return f"{{{items}}}" if nested else f"new {t}{{{items}}}"

    if t in ("String", "java.lang.String"):
        if value is None:
            return "null"
        return json.dumps(str(value))

    if t == "char":
        s = str(value)
        if len(s) != 1:
            raise DriverError(f"Expected a single character, got {value!r}.")
        return "'\\''" if s == "'" else f"'{s}'" if s != "\\" else "'\\\\'"

    if t == "boolean":
        return "true" if value else "false"

    if t in ("int", "short", "byte"):
        return str(int(value))
    if t == "long":
        return f"{int(value)}L"
    if t in ("double", "float"):
        return f"{float(value)}" + ("f" if t == "float" else "")

    if t.startswith("List<") or t.startswith("java.util.List<"):
        inner = t[t.index("<") + 1 : -1]
        boxed = _box(inner)
        items = ", ".join(to_literal(inner, v) for v in value)
        return f"new java.util.ArrayList<{boxed}>(java.util.List.of({items}))"

    if value is None:
        return "null"
    raise DriverError(f"Unsupported parameter type for auto-input: {t}")


def _box(t: str) -> str:
    return {
        "int": "Integer", "long": "Long", "double": "Double", "float": "Float",
        "boolean": "Boolean", "char": "Character", "short": "Short", "byte": "Byte",
    }.get(t, t)


def _print_expr(ret: str, var: str) -> str:
    if ret == "void":
        return ""
    if ret.count("[]") >= 2:
        return f"System.out.println(java.util.Arrays.deepToString({var}));"
    if ret.endswith("[]"):
        return f"System.out.println(java.util.Arrays.toString({var}));"
    return f"System.out.println(String.valueOf({var}));"


def build_main(entry: Entry, inputs: list) -> str:
    if len(inputs) != len(entry.params):
        raise DriverError(
            f"{entry.method} expects {len(entry.params)} argument(s) "
            f"({', '.join(p.name for p in entry.params)}), but {len(inputs)} were supplied."
        )

    lines = ["public class AvMain {", "    public static void main(String[] __av) {"]
    for p, val in zip(entry.params, inputs):
        lines.append(f"        {p.type} {p.name} = {to_literal(p.type, val)};")
    lines.append(f"        {entry.cls} __solution = new {entry.cls}();")
    call = f"__solution.{entry.method}({', '.join(p.name for p in entry.params)})"
    if entry.ret == "void":
        lines.append(f"        {call};")
    else:
        lines.append(f"        {entry.ret} __result = {call};")
        lines.append("        " + _print_expr(entry.ret, "__result"))
    lines += ["    }", "}"]
    return "\n".join(lines) + "\n"


RANDOM_RE = re.compile(r"new\s+Random\s*\(\s*\)")


def make_deterministic(source: str, seed: int = 42) -> tuple[str, bool]:
    """Seed bare `new Random()` so a traced run is reproducible.

    Line-preserving on purpose: event line numbers must still address the
    source the user is looking at.
    """
    new_src, n = RANDOM_RE.subn(f"new Random({seed}L)", source)
    return new_src, n > 0
