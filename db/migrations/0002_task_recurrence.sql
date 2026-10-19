-- الگوی فعالیت تکرارشونده: روی ردیف «گروه» (فعالیت خلاصه) ذخیره می‌شود تا ویرایش الگو رخدادها را دوباره بسازد.
-- ساختار و درستی الگو در هسته‌ی برنامه (validateRecurrence) سنجیده می‌شود؛ پایگاه‌داده فقط نوع و جایگاه را نگه می‌دارد.
ALTER TABLE tasks ADD COLUMN recurrence jsonb;
ALTER TABLE tasks ADD CONSTRAINT tasks_recurrence_shape CHECK (
  recurrence IS NULL OR (kind = 'summary' AND jsonb_typeof(recurrence) = 'object')
);
