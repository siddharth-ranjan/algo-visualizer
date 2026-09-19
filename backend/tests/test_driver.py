import pytest

from av import driver


SOLUTION = """
class Solution {
    public int findKthLargest(int[] nums, int k) { return nums[k]; }
    private void swap(int[] a, int i, int j) {}
}
"""


def test_finds_public_method_and_skips_private():
    entry = driver.find_entry(SOLUTION)
    assert entry.cls == "Solution"
    assert entry.method == "findKthLargest"
    assert entry.label == "int findKthLargest(int[] nums, int k)"


def test_generic_params_are_split_on_top_level_commas():
    src = "class S { public int f(java.util.Map<String, Integer> m, int k) { return k; } }"
    entry = driver.find_entry(src)
    assert [p.type for p in entry.params] == ["java.util.Map<String,Integer>", "int"]


def test_c_style_array_dims_move_to_the_type():
    entry = driver.find_entry("class S { public int f(int nums[]) { return 0; } }")
    assert entry.params[0].type == "int[]"
    assert entry.params[0].name == "nums"


@pytest.mark.parametrize(
    "jtype,value,expected",
    [
        ("int", 3, "3"),
        ("long", 3, "3L"),
        ("boolean", True, "true"),
        ("String", "hi", '"hi"'),
        ("int[]", [1, 2], "new int[]{1, 2}"),
        ("int[][]", [[1], [2, 3]], "new int[][]{{1}, {2, 3}}"),
    ],
)
def test_literals(jtype, value, expected):
    assert driver.to_literal(jtype, value) == expected


def test_arity_mismatch_is_reported_in_user_terms():
    entry = driver.find_entry(SOLUTION)
    with pytest.raises(driver.DriverError, match="expects 2 argument"):
        driver.build_main(entry, [[1, 2, 3]])


def test_no_public_method_is_a_clear_error():
    with pytest.raises(driver.DriverError, match="no public method"):
        driver.find_entry("class Solution { private int f() { return 1; } }")


def test_seeding_is_line_preserving():
    src = "a\nnew Random()\nb\n"
    out, changed = driver.make_deterministic(src)
    assert changed
    assert "new Random(42L)" in out
    assert len(out.splitlines()) == len(src.splitlines())


def test_already_seeded_random_is_left_alone():
    _, changed = driver.make_deterministic("new Random(7L)")
    assert not changed
