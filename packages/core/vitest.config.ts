import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // آزمون‌های ویژگی (schedulingProperties) روی صدها پروژه‌ی تصادفی اجرا می‌شوند و با SCHED_PROP_N بزرگ‌تر هم می‌شوند؛
    // پیش‌فرض ۵ ثانیه‌ی vitest روی ماشین‌های کند کافی نیست.
    testTimeout: 120000,
  },
});
