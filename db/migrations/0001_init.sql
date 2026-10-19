-- بیستون — طرح اولیه‌ی پایگاه‌داده (PostgreSQL 16)
--
-- اصول:
--  * هر جدول پروژه‌ای با (project_id, id) کلید می‌خورد؛ id یک عدد کوچک و قابل‌خواندن در محدوده‌ی همان پروژه است
--    (کدی که کاربر در ستون «پیش‌نیاز» می‌نویسد). ساخت آن با next_seq() اتمی است.
--  * داده‌ی مشتق (ES/EF/LS/LF، WBS، مسیر بحرانی، شاخص‌های EVM) هرگز ذخیره نمی‌شود؛ هسته آن را از ورودی‌ها حساب می‌کند.
--  * تاریخ‌ها از نوع date (میلادی). تبدیل به شمسی فقط در لایه‌ی نمایش است.
--  * هر ردیف قابل‌ویرایش ستون version دارد؛ ویرایش با شرط version انجام می‌شود (قفل خوش‌بینانه‌ی اتمی).
--  * ممیزی (audit_log) فقط-افزودنی است و با trigger از ویرایش و حذف محافظت می‌شود.

-- ───────────────────────── کاربران و نشست‌ها ─────────────────────────

CREATE TABLE users (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username             text        NOT NULL,
  display_name         text        NOT NULL CHECK (length(btrim(display_name)) > 0),
  email                text,
  password_hash        text        NOT NULL,
  is_system_admin      boolean     NOT NULL DEFAULT false,
  is_active            boolean     NOT NULL DEFAULT true,
  must_change_password boolean     NOT NULL DEFAULT false,
  failed_logins        integer     NOT NULL DEFAULT 0 CHECK (failed_logins >= 0),
  locked_until         timestamptz,
  last_login_at        timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_username_format CHECK (username ~ '^[A-Za-z0-9._-]{3,64}$')
);
CREATE UNIQUE INDEX users_username_lower_uq ON users (lower(username));

-- توکن نشست فقط به‌صورت هش ذخیره می‌شود تا نشت پایگاه‌داده نشست‌ها را لو ندهد.
CREATE TABLE sessions (
  token_hash   bytea       PRIMARY KEY,
  user_id      bigint      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  csrf_token   text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  ip           inet,
  user_agent   text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- ───────────────────────── پروژه و عضویت ─────────────────────────

CREATE TABLE projects (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name            text          NOT NULL CHECK (length(btrim(name)) > 0),
  start_date      date          NOT NULL,
  status_date     date          NOT NULL,
  contract_end    date,
  finance_unit    text          NOT NULL DEFAULT 'ریال' CHECK (length(finance_unit) BETWEEN 1 AND 24),
  finance_budget  numeric(20,2) NOT NULL DEFAULT 0 CHECK (finance_budget >= 0),
  eac_method      text          NOT NULL DEFAULT 'remaining' CHECK (eac_method IN ('remaining', 'cpi', 'both')),
  -- افزایش با هر تغییر ساختاری فعالیت‌ها (درج/حذف/جابه‌جایی)؛ کلاینت‌های قدیمی‌تر را رد می‌کند
  structure_version integer     NOT NULL DEFAULT 1,
  version         integer       NOT NULL DEFAULT 1,
  archived_at     timestamptz,
  created_by      bigint REFERENCES users (id),
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  updated_by      bigint REFERENCES users (id)
);

-- نقش‌ها به‌ازای هر پروژه تعیین می‌شوند؛ یک کاربر می‌تواند در چند پروژه نقش‌های مختلف داشته باشد.
-- ادمین سیستم (users.is_system_admin) جدا از نقش «ادمین پروژه» است.
CREATE TABLE project_members (
  project_id bigint      NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  user_id    bigint      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role       text        NOT NULL CHECK (role IN ('admin', 'pm', 'finance', 'commerce', 'management', 'expert')),
  granted_by bigint REFERENCES users (id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id, role)
);
CREATE INDEX project_members_user_idx ON project_members (user_id);

-- شمارنده‌ی اتمی شناسه‌های پروژه‌ای
CREATE TABLE project_counters (
  project_id bigint  NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  kind       text    NOT NULL,
  next_value integer NOT NULL CHECK (next_value >= 1),
  PRIMARY KEY (project_id, kind)
);

-- مقدار بعدی را برمی‌گرداند و شمارنده را جلو می‌برد. هم‌زمانی با قفل ردیف سریال می‌شود.
CREATE FUNCTION next_seq(p_project bigint, p_kind text) RETURNS integer
LANGUAGE sql AS $$
  INSERT INTO project_counters (project_id, kind, next_value) VALUES (p_project, p_kind, 2)
  ON CONFLICT (project_id, kind) DO UPDATE SET next_value = project_counters.next_value + 1
  RETURNING next_value - 1;
$$;

-- پس از ورود داده‌ی دارای شناسه‌ی صریح، شمارنده را از بیشینه‌ی موجود جلوتر نگه می‌دارد.
CREATE FUNCTION bump_seq(p_project bigint, p_kind text, p_at_least integer) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO project_counters (project_id, kind, next_value) VALUES (p_project, p_kind, GREATEST(p_at_least, 1))
  ON CONFLICT (project_id, kind) DO UPDATE SET next_value = GREATEST(project_counters.next_value, EXCLUDED.next_value);
$$;

-- ───────────────────────── تقویم ─────────────────────────

-- weekday به سبک جاوااسکریپت: ۰ یکشنبه … ۵ جمعه، ۶ شنبه
CREATE TABLE project_workdays (
  project_id bigint   NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  weekday    smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  working    boolean  NOT NULL,
  from_time  time     NOT NULL DEFAULT '07:30',
  to_time    time     NOT NULL DEFAULT '15:00',
  PRIMARY KEY (project_id, weekday)
);

CREATE TABLE project_holidays (
  project_id   bigint NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  holiday_date date   NOT NULL,
  title        text   NOT NULL DEFAULT '',
  PRIMARY KEY (project_id, holiday_date)
);

-- ───────────────────────── منابع ─────────────────────────

CREATE TABLE resources (
  project_id       bigint        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  id               integer       NOT NULL,
  name             text          NOT NULL CHECK (length(btrim(name)) > 0 AND name !~ '[,،:]'),
  type             text          NOT NULL DEFAULT 'human' CHECK (type IN ('human', 'equipment', 'financial', 'other')),
  capacity_percent numeric(7,2)  NOT NULL DEFAULT 100 CHECK (capacity_percent > 0),
  daily_rate       numeric(20,2) NOT NULL DEFAULT 0 CHECK (daily_rate >= 0),
  -- پیوند منبع انسانی به کاربر سامانه؛ کارشناس فقط فعالیت‌های منبع خودش را ویرایش می‌کند
  user_id          bigint REFERENCES users (id) ON DELETE SET NULL,
  PRIMARY KEY (project_id, id),
  UNIQUE (project_id, name)
);

-- ───────────────────────── فعالیت‌ها ─────────────────────────

CREATE TABLE tasks (
  project_id            bigint        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  id                    integer       NOT NULL,
  position              integer       NOT NULL,
  name                  text          NOT NULL CHECK (length(btrim(name)) > 0),
  level                 smallint      NOT NULL CHECK (level BETWEEN 1 AND 9),
  kind                  text          NOT NULL CHECK (kind IN ('task', 'summary', 'milestone')),
  duration              integer       NOT NULL DEFAULT 1 CHECK (duration >= 0),
  weight                numeric(12,3) NOT NULL DEFAULT 0 CHECK (weight >= 0),
  percent_complete      numeric(5,2)  NOT NULL DEFAULT 0 CHECK (percent_complete BETWEEN 0 AND 100),
  actual_start          date,
  actual_finish         date,
  work                  numeric(12,3) NOT NULL DEFAULT 0 CHECK (work >= 0),
  start_no_earlier_than date,
  start_no_earlier_source text CHECK (start_no_earlier_source IN ('manual', 'msp', 'leveling')),
  deadline              date,
  level_of_effort       boolean       NOT NULL DEFAULT false,
  legacy_actual_cost    numeric(20,2) CHECK (legacy_actual_cost >= 0),
  cost_tracked          boolean       NOT NULL DEFAULT false,
  version               integer       NOT NULL DEFAULT 1,
  updated_at            timestamptz   NOT NULL DEFAULT now(),
  updated_by            bigint REFERENCES users (id),
  PRIMARY KEY (project_id, id),
  -- ترتیب ردیف‌ها؛ در جابه‌جایی‌های داخل تراکنش، بررسی یکتایی تا پایان تراکنش به تعویق می‌افتد
  CONSTRAINT tasks_position_uq UNIQUE (project_id, position) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT tasks_milestone_zero CHECK (kind <> 'milestone' OR duration = 0),
  CONSTRAINT tasks_task_duration CHECK (kind <> 'task' OR duration >= 1),
  CONSTRAINT tasks_summary_derived CHECK (
    kind <> 'summary' OR (
      duration = 0 AND weight = 0 AND percent_complete = 0 AND work = 0
      AND actual_start IS NULL AND actual_finish IS NULL
      AND start_no_earlier_than IS NULL AND deadline IS NULL
      AND NOT level_of_effort AND legacy_actual_cost IS NULL
    )
  ),
  CONSTRAINT tasks_actual_order CHECK (actual_finish IS NULL OR actual_start IS NULL OR actual_finish >= actual_start),
  CONSTRAINT tasks_finish_complete CHECK (actual_finish IS NULL OR percent_complete = 100),
  CONSTRAINT tasks_snet_source CHECK ((start_no_earlier_than IS NULL) = (start_no_earlier_source IS NULL))
);

CREATE TABLE task_dependencies (
  project_id     bigint   NOT NULL,
  task_id        integer  NOT NULL,
  predecessor_id integer  NOT NULL,
  dep_type       text     NOT NULL DEFAULT 'FS' CHECK (dep_type IN ('FS', 'SS', 'FF', 'SF')),
  lag            integer  NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, task_id, predecessor_id),
  FOREIGN KEY (project_id, task_id) REFERENCES tasks (project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, predecessor_id) REFERENCES tasks (project_id, id) ON DELETE CASCADE,
  CONSTRAINT task_dependencies_not_self CHECK (task_id <> predecessor_id)
);
CREATE INDEX task_dependencies_pred_idx ON task_dependencies (project_id, predecessor_id);

CREATE TABLE task_assignments (
  project_id  bigint       NOT NULL,
  task_id     integer      NOT NULL,
  resource_id integer      NOT NULL,
  units       numeric(7,2) NOT NULL CHECK (units > 0),
  PRIMARY KEY (project_id, task_id, resource_id),
  FOREIGN KEY (project_id, task_id) REFERENCES tasks (project_id, id) ON DELETE CASCADE,
  -- بررسی تا پایان تراکنش به تعویق می‌افتد تا حذف آبشاریِ کل پروژه ممکن باشد، ولی حذف منبعِ تخصیص‌یافته رد شود
  FOREIGN KEY (project_id, resource_id) REFERENCES resources (project_id, id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE task_direct_costs (
  project_id bigint        NOT NULL,
  task_id    integer       NOT NULL,
  line_no    smallint      NOT NULL,
  name       text          NOT NULL DEFAULT '' CHECK (length(name) <= 80),
  amount     numeric(20,2) NOT NULL CHECK (amount > 0),
  PRIMARY KEY (project_id, task_id, line_no),
  FOREIGN KEY (project_id, task_id) REFERENCES tasks (project_id, id) ON DELETE CASCADE
);

-- ───────────────────────── خط مبنا، اسنپ‌شات، هزینه‌ی واقعی ─────────────────────────

CREATE TABLE baselines (
  project_id  bigint      NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  id          integer     NOT NULL,
  label       text        NOT NULL DEFAULT '',
  status_date date        NOT NULL,
  is_current  boolean     NOT NULL DEFAULT false,
  created_by  bigint REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id)
);
CREATE UNIQUE INDEX baselines_one_current_uq ON baselines (project_id) WHERE is_current;

-- عمداً بدون کلید خارجی به tasks: خط مبنای بایگانی‌شده باید پس از حذف فعالیت هم سالم بماند.
CREATE TABLE baseline_items (
  project_id    bigint        NOT NULL,
  baseline_id   integer       NOT NULL,
  task_id       integer       NOT NULL,
  start_date    date          NOT NULL,
  finish_date   date          NOT NULL,
  zero_duration boolean       NOT NULL DEFAULT false,
  cost          numeric(20,2),
  PRIMARY KEY (project_id, baseline_id, task_id),
  FOREIGN KEY (project_id, baseline_id) REFERENCES baselines (project_id, id) ON DELETE CASCADE,
  CONSTRAINT baseline_items_order CHECK (finish_date >= start_date)
);

CREATE TABLE snapshots (
  project_id      bigint        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  snapshot_date   date          NOT NULL,
  actual_percent  numeric(9,4)  NOT NULL,
  planned_percent numeric(9,4),
  estimated       boolean       NOT NULL DEFAULT false,
  actual_cost     numeric(20,2),
  created_by      bigint REFERENCES users (id),
  created_at      timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, snapshot_date)
);

CREATE TABLE snapshot_tasks (
  project_id    bigint       NOT NULL,
  snapshot_date date         NOT NULL,
  task_id       integer      NOT NULL,
  percent       numeric(5,1) NOT NULL CHECK (percent BETWEEN 0 AND 100),
  PRIMARY KEY (project_id, snapshot_date, task_id),
  FOREIGN KEY (project_id, snapshot_date) REFERENCES snapshots (project_id, snapshot_date) ON DELETE CASCADE
);

-- حذف فعالیتی که هزینه‌ی ثبت‌شده دارد ممنوع است (برخلاف برنامه‌ی قبلی که هزینه را بی‌صدا به «سربار» تبدیل می‌کرد).
CREATE TABLE cost_entries (
  project_id  bigint        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  id          integer       NOT NULL,
  entry_date  date          NOT NULL,
  task_id     integer,
  description text          NOT NULL DEFAULT '' CHECK (length(description) <= 120),
  document    text          NOT NULL DEFAULT '' CHECK (length(document) <= 60),
  amount      numeric(20,2) NOT NULL CHECK (amount > 0),
  created_by  bigint REFERENCES users (id),
  created_at  timestamptz   NOT NULL DEFAULT now(),
  version     integer       NOT NULL DEFAULT 1,
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, task_id) REFERENCES tasks (project_id, id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX cost_entries_task_idx ON cost_entries (project_id, task_id);

-- ───────────────────────── منشور و قرارداد ─────────────────────────

CREATE TABLE project_charter (
  project_id      bigint PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
  client          text NOT NULL DEFAULT '',
  location        text NOT NULL DEFAULT '',
  subject         text NOT NULL DEFAULT '',
  product         text NOT NULL DEFAULT '',
  project_manager text NOT NULL DEFAULT '',
  sales_owner     text NOT NULL DEFAULT '',
  goals           text NOT NULL DEFAULT '',
  scope           text NOT NULL DEFAULT '',
  assumptions     text NOT NULL DEFAULT '',
  stakeholders    text NOT NULL DEFAULT '',
  version         integer     NOT NULL DEFAULT 1,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      bigint REFERENCES users (id)
);

CREATE TABLE project_contract (
  project_id                    bigint PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
  number                        text          NOT NULL DEFAULT '',
  contract_date                 date,
  type                          text          NOT NULL DEFAULT '',
  validity                      text          NOT NULL DEFAULT '',
  amount                        numeric(20,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  advance_date                  date,
  advance_guarantee_serial      text          NOT NULL DEFAULT '',
  advance_amount                numeric(20,2) NOT NULL DEFAULT 0 CHECK (advance_amount >= 0),
  invoice_numbers               text          NOT NULL DEFAULT '',
  invoiced_total                numeric(20,2) NOT NULL DEFAULT 0 CHECK (invoiced_total >= 0),
  collected_total               numeric(20,2) NOT NULL DEFAULT 0 CHECK (collected_total >= 0),
  performance_guarantee_serial  text          NOT NULL DEFAULT '',
  -- حسن انجام کار: مبلغ ثابت یا درصدی از مبلغ قرارداد (به ازای هر قرارداد)
  retention_mode                text          NOT NULL DEFAULT 'fixed' CHECK (retention_mode IN ('fixed', 'percent')),
  retention_value               numeric(20,4) NOT NULL DEFAULT 0 CHECK (retention_value >= 0),
  sales_approval                text CHECK (sales_approval IN ('pending', 'approved', 'rejected')),
  sales_commission_percent      numeric(5,2)  NOT NULL DEFAULT 0 CHECK (sales_commission_percent BETWEEN 0 AND 100),
  retention_commission_percent  numeric(5,2)  NOT NULL DEFAULT 0 CHECK (retention_commission_percent BETWEEN 0 AND 100),
  version                       integer       NOT NULL DEFAULT 1,
  updated_at                    timestamptz   NOT NULL DEFAULT now(),
  updated_by                    bigint REFERENCES users (id),
  CONSTRAINT contract_retention_percent CHECK (retention_mode <> 'percent' OR retention_value <= 100)
);

-- ───────────────────────── ریسک، مسئله، تغییر، تصمیم، اسناد، گفتگو ─────────────────────────

CREATE TABLE risks (
  project_id  bigint   NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  id          integer  NOT NULL,
  title       text     NOT NULL DEFAULT '',
  category    text CHECK (category IN ('technical', 'schedule', 'cost', 'procurement', 'client', 'hse', 'other')),
  probability smallint NOT NULL DEFAULT 3 CHECK (probability BETWEEN 1 AND 5),
  impact      smallint NOT NULL DEFAULT 3 CHECK (impact BETWEEN 1 AND 5),
  owner       text     NOT NULL DEFAULT '',
  strategy    text CHECK (strategy IN ('avoid', 'mitigate', 'transfer', 'accept')),
  response    text     NOT NULL DEFAULT '',
  due         date,
  status      text     NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'closed')),
  version     integer  NOT NULL DEFAULT 1,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  bigint REFERENCES users (id),
  PRIMARY KEY (project_id, id)
);

CREATE TABLE issues (
  project_id     bigint  NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  id             integer NOT NULL,
  title          text    NOT NULL DEFAULT '',
  owner          text    NOT NULL DEFAULT '',
  priority       text    NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  due            date,
  impact         text    NOT NULL DEFAULT '',
  action         text    NOT NULL DEFAULT '',
  needs_decision boolean NOT NULL DEFAULT false,
  status         text    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
  version        integer NOT NULL DEFAULT 1,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     bigint REFERENCES users (id),
  PRIMARY KEY (project_id, id)
);

CREATE TABLE change_requests (
  project_id      bigint  NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  id              integer NOT NULL,
  title           text    NOT NULL DEFAULT '',
  requester       text    NOT NULL DEFAULT '',
  request_date    date,
  reason          text    NOT NULL DEFAULT '',
  impact          text    NOT NULL DEFAULT '',
  previous_finish date,
  new_finish      date,
  status          text    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by     text    NOT NULL DEFAULT '',
  approved_on     date,
  version         integer NOT NULL DEFAULT 1,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      bigint REFERENCES users (id),
  PRIMARY KEY (project_id, id)
);

CREATE TABLE decisions (
  project_id    bigint  NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  id            integer NOT NULL,
  topic         text    NOT NULL DEFAULT '',
  decision_text text    NOT NULL DEFAULT '',
  maker         text    NOT NULL DEFAULT '',
  decision_date date,
  status        text    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'decided', 'implemented')),
  version       integer NOT NULL DEFAULT 1,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    bigint REFERENCES users (id),
  PRIMARY KEY (project_id, id)
);

CREATE TABLE project_documents (
  project_id bigint  NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  id         integer NOT NULL,
  title      text    NOT NULL CHECK (length(btrim(title)) > 0 AND length(title) <= 200),
  doc_type   text    NOT NULL DEFAULT 'other' CHECK (doc_type IN ('contract', 'drawing', 'minutes', 'report', 'spec', 'other')),
  url        text    NOT NULL CHECK (url ~ '^https?://'),
  task_id    integer,
  doc_date   date,
  added_by   bigint REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, task_id) REFERENCES tasks (project_id, id) ON DELETE SET NULL (task_id)
);

CREATE TABLE chat_messages (
  project_id bigint      NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  id         integer     NOT NULL,
  user_id    bigint      NOT NULL REFERENCES users (id),
  body       text        NOT NULL CHECK (length(btrim(body)) > 0 AND length(body) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by bigint REFERENCES users (id),
  PRIMARY KEY (project_id, id)
);
CREATE INDEX chat_messages_time_idx ON chat_messages (project_id, created_at);

-- ───────────────────────── ممیزی ─────────────────────────

CREATE TABLE audit_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  -- بدون کلید خارجی: ممیزی باید پس از آرشیو/حذف پروژه یا کاربر هم باقی بماند
  project_id bigint,
  actor_id   bigint,
  actor_name text        NOT NULL DEFAULT '',
  action     text        NOT NULL,
  entity     text        NOT NULL DEFAULT '',
  entity_id  text        NOT NULL DEFAULT '',
  field      text        NOT NULL DEFAULT '',
  old_value  jsonb,
  new_value  jsonb,
  ip         inet,
  request_id text        NOT NULL DEFAULT '',
  details    jsonb
);
CREATE INDEX audit_log_project_time_idx ON audit_log (project_id, at DESC);
CREATE INDEX audit_log_actor_time_idx ON audit_log (actor_id, at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id);

CREATE FUNCTION audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (% blocked)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;
CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();

-- ───────────────────────── ورود از نسخه‌ی قدیمی ─────────────────────────

CREATE TABLE legacy_imports (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id    bigint REFERENCES projects (id) ON DELETE SET NULL,
  imported_by   bigint REFERENCES users (id),
  imported_at   timestamptz NOT NULL DEFAULT now(),
  source_name   text        NOT NULL DEFAULT '',
  source_sha256 text        NOT NULL,
  warnings      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  original      jsonb       NOT NULL
);
