import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // هر فایل آزمون پایگاه‌داده‌ی جدا می‌سازد؛ اجرای موازی‌ی فایل‌ها امن است.
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
