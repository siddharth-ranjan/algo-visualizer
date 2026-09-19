export const SAMPLE_SOURCE = `import java.util.Random;

class Solution {
    private final Random rand = new Random();

    public int findKthLargest(int[] nums, int k) {
        int target = nums.length - k;
        int left = 0, right = nums.length - 1;

        while (left <= right) {
            int pivotIndex = left + rand.nextInt(right - left + 1);
            int pivot = nums[pivotIndex];

            // 3-way partition (Dutch National Flag) to handle duplicates
            int lt = left;
            int i = left;
            int gt = right;

            while (i <= gt) {
                if (nums[i] < pivot) {
                    swap(nums, lt++, i++);
                } else if (nums[i] > pivot) {
                    swap(nums, i, gt--);
                } else {
                    i++;
                }
            }

            if (target >= lt && target <= gt) {
                return nums[target];
            } else if (target < lt) {
                right = lt - 1;
            } else {
                left = gt + 1;
            }
        }

        return -1;
    }

    private void swap(int[] nums, int i, int j) {
        int temp = nums[i];
        nums[i] = nums[j];
        nums[j] = temp;
    }
}
`;

export const SAMPLE_INPUT = "[[3,2,1,5,6,4], 2]";
