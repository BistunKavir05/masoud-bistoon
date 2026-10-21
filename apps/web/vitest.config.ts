import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // آزمون‌های ویژگیِ منحنی روی صدها ورودی تصادفی اجرا می‌شوند؛ پیش‌فرض ۵ ثانیه‌ی vitest روی ماشین‌های کند کافی نیست.
    testTimeout: 60000,
  },
});
