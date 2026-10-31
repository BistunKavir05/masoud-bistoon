-- کنترل مدارک (ارسال‌کننده، دریافت‌کننده، شماره/ویرایش، وضعیت گردش)، صورت‌وضعیت‌ها و تدارکات.

-- ───── اسناد: نوع «نامه»، فیلدهای کنترل مدارک، و لینک اختیاری (مدرک کاغذی یا نامه لینک ندارد)
ALTER TABLE project_documents DROP CONSTRAINT project_documents_doc_type_check;
ALTER TABLE project_documents ADD CONSTRAINT project_documents_doc_type_check
  CHECK (doc_type IN ('contract', 'letter', 'drawing', 'minutes', 'report', 'spec', 'other'));
ALTER TABLE project_documents DROP CONSTRAINT project_documents_url_check;
ALTER TABLE project_documents ADD CONSTRAINT project_documents_url_check CHECK (url = '' OR url ~ '^https?://');
ALTER TABLE project_documents
  ADD COLUMN sender    text NOT NULL DEFAULT '' CHECK (length(sender) <= 120),
  ADD COLUMN receiver  text NOT NULL DEFAULT '' CHECK (length(receiver) <= 120),
  ADD COLUMN doc_number text NOT NULL DEFAULT '' CHECK (length(doc_number) <= 60),
  ADD COLUMN revision  text NOT NULL DEFAULT '' CHECK (length(revision) <= 30),
  ADD COLUMN doc_status text CHECK (doc_status IN ('sent', 'received', 'in_review', 'approved', 'returned'));

-- ───── صورت‌وضعیت‌ها و دریافتی‌ها
CREATE TABLE payments (
  project_id      bigint   NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  id              integer  NOT NULL,
  number          text     NOT NULL DEFAULT '' CHECK (length(number) <= 40),
  title           text     NOT NULL DEFAULT '' CHECK (length(title) <= 200),
  sent_date       date,
  sent_amount     numeric(20, 2) NOT NULL DEFAULT 0 CHECK (sent_amount >= 0),
  approved_amount numeric(20, 2) CHECK (approved_amount IS NULL OR approved_amount >= 0),
  received_amount numeric(20, 2) NOT NULL DEFAULT 0 CHECK (received_amount >= 0),
  received_date   date,
  status          text     NOT NULL DEFAULT 'preparing' CHECK (status IN ('preparing', 'sent', 'approved', 'paid')),
  notes           text     NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  version         integer  NOT NULL DEFAULT 1,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      bigint REFERENCES users (id),
  PRIMARY KEY (project_id, id)
);

-- ───── تدارکات و سفارش‌ها
CREATE TABLE procurement_items (
  project_id       bigint   NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  id               integer  NOT NULL,
  item             text     NOT NULL DEFAULT '' CHECK (length(item) <= 200),
  task_id          integer,
  supplier         text     NOT NULL DEFAULT '' CHECK (length(supplier) <= 200),
  order_number     text     NOT NULL DEFAULT '' CHECK (length(order_number) <= 60),
  amount           numeric(20, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  order_date       date,
  planned_delivery date,
  actual_delivery  date,
  status           text     NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'inquiry', 'ordered', 'manufacturing', 'shipping', 'delivered')),
  notes            text     NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  version          integer  NOT NULL DEFAULT 1,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       bigint REFERENCES users (id),
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, task_id) REFERENCES tasks (project_id, id) ON DELETE SET NULL (task_id)
);
