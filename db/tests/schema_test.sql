-- آزمون‌های طرح پایگاه‌داده؛ هر شکست یک EXCEPTION می‌اندازد و psql با ON_ERROR_STOP متوقف می‌شود.
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null

CREATE TEMP TABLE t_result (name text, ok boolean);

CREATE FUNCTION pg_temp.expect_error(label text, stmt text, expected_state text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE got text;
BEGIN
  BEGIN
    SET CONSTRAINTS ALL IMMEDIATE;
    EXECUTE stmt;
    RAISE EXCEPTION 'FAIL [%]: expected error % but statement succeeded', label, expected_state;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS got = RETURNED_SQLSTATE;
    IF SQLERRM LIKE 'FAIL [%' THEN RAISE; END IF;
    IF got <> expected_state THEN
      RAISE EXCEPTION 'FAIL [%]: expected SQLSTATE % but got % (%)', label, expected_state, got, SQLERRM;
    END IF;
  END;
  INSERT INTO t_result VALUES (label, true);
END $$;

CREATE FUNCTION pg_temp.expect_true(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL [%]: condition is not true', label; END IF;
  INSERT INTO t_result VALUES (label, true);
END $$;

-- ───── داده‌ی پایه
INSERT INTO users (username, display_name, password_hash, is_system_admin) VALUES ('admin', 'مدیر سیستم', 'x', true), ('ali', 'علی', 'x', false);
INSERT INTO projects (name, start_date, status_date, created_by) VALUES ('پروژه‌ی آزمون', '2026-09-01', '2026-09-01', 1), ('پروژه‌ی دوم', '2026-09-01', '2026-09-01', 1);

SELECT pg_temp.expect_error('username format', $$INSERT INTO users (username, display_name, password_hash) VALUES ('a b', 'x', 'x')$$, '23514');
SELECT pg_temp.expect_error('username case-insensitive unique', $$INSERT INTO users (username, display_name, password_hash) VALUES ('ALI', 'x', 'x')$$, '23505');
SELECT pg_temp.expect_error('project name required', $$INSERT INTO projects (name, start_date, status_date) VALUES ('  ', '2026-09-01', '2026-09-01')$$, '23514');
SELECT pg_temp.expect_error('role enum', $$INSERT INTO project_members (project_id, user_id, role) VALUES (1, 2, 'god')$$, '23514');
INSERT INTO project_members (project_id, user_id, role) VALUES (1, 2, 'pm'), (1, 2, 'finance'), (2, 2, 'expert');
SELECT pg_temp.expect_true('multi-role per project and different role per project', (SELECT count(*) FROM project_members WHERE user_id = 2) = 3);
SELECT pg_temp.expect_error('duplicate role', $$INSERT INTO project_members (project_id, user_id, role) VALUES (1, 2, 'pm')$$, '23505');

-- ───── شمارنده‌ی شناسه
SELECT pg_temp.expect_true('next_seq starts at 1', next_seq(1, 'task') = 1);
SELECT pg_temp.expect_true('next_seq increments', next_seq(1, 'task') = 2);
SELECT pg_temp.expect_true('next_seq independent per project', next_seq(2, 'task') = 1);
SELECT pg_temp.expect_true('next_seq independent per kind', next_seq(1, 'risk') = 1);
SELECT bump_seq(1, 'task', 50);
SELECT pg_temp.expect_true('bump_seq moves forward', next_seq(1, 'task') = 50);
SELECT bump_seq(1, 'task', 10);
SELECT pg_temp.expect_true('bump_seq never moves backward', next_seq(1, 'task') = 51);

-- ───── فعالیت‌ها
INSERT INTO tasks (project_id, id, position, name, level, kind, duration, weight) VALUES
  (1, 1, 1, 'گروه', 1, 'summary', 0, 0),
  (1, 2, 2, 'الف', 2, 'task', 5, 5),
  (1, 3, 3, 'ب', 2, 'task', 3, 3),
  (1, 4, 4, 'م', 2, 'milestone', 0, 0);
INSERT INTO task_dependencies (project_id, task_id, predecessor_id, dep_type, lag) VALUES (1, 3, 2, 'FS', 0), (1, 4, 3, 'SS', -1);

SELECT pg_temp.expect_error('task name required', $$INSERT INTO tasks (project_id, id, position, name, level, kind, duration) VALUES (1, 9, 9, ' ', 1, 'task', 1)$$, '23514');
SELECT pg_temp.expect_error('level range', $$INSERT INTO tasks (project_id, id, position, name, level, kind, duration) VALUES (1, 9, 9, 'x', 10, 'task', 1)$$, '23514');
SELECT pg_temp.expect_error('milestone duration must be zero', $$INSERT INTO tasks (project_id, id, position, name, level, kind, duration) VALUES (1, 9, 9, 'x', 1, 'milestone', 2)$$, '23514');
SELECT pg_temp.expect_error('task duration at least one', $$INSERT INTO tasks (project_id, id, position, name, level, kind, duration) VALUES (1, 9, 9, 'x', 1, 'task', 0)$$, '23514');
SELECT pg_temp.expect_error('summary cannot carry progress', $$INSERT INTO tasks (project_id, id, position, name, level, kind, duration, percent_complete) VALUES (1, 9, 9, 'x', 1, 'summary', 0, 10)$$, '23514');
SELECT pg_temp.expect_error('summary cannot carry actual dates', $$INSERT INTO tasks (project_id, id, position, name, level, kind, duration, actual_start) VALUES (1, 9, 9, 'x', 1, 'summary', 0, '2026-09-01')$$, '23514');
SELECT pg_temp.expect_error('actual finish before start', $$INSERT INTO tasks (project_id, id, position, name, level, kind, duration, actual_start, actual_finish, percent_complete) VALUES (1, 9, 9, 'x', 1, 'task', 1, '2026-09-05', '2026-09-01', 100)$$, '23514');
SELECT pg_temp.expect_error('actual finish implies 100%', $$INSERT INTO tasks (project_id, id, position, name, level, kind, duration, actual_start, actual_finish, percent_complete) VALUES (1, 9, 9, 'x', 1, 'task', 1, '2026-09-01', '2026-09-05', 40)$$, '23514');
SELECT pg_temp.expect_error('percent range', $$INSERT INTO tasks (project_id, id, position, name, level, kind, duration, percent_complete) VALUES (1, 9, 9, 'x', 1, 'task', 1, 101)$$, '23514');
SELECT pg_temp.expect_error('snet source pairing', $$INSERT INTO tasks (project_id, id, position, name, level, kind, duration, start_no_earlier_than) VALUES (1, 9, 9, 'x', 1, 'task', 1, '2026-10-01')$$, '23514');
SELECT pg_temp.expect_error('duplicate position', $$INSERT INTO tasks (project_id, id, position, name, level, kind, duration) VALUES (1, 9, 4, 'x', 1, 'task', 1)$$, '23505');
SELECT pg_temp.expect_error('duplicate task id in project', $$INSERT INTO tasks (project_id, id, position, name, level, kind, duration) VALUES (1, 2, 9, 'x', 1, 'task', 1)$$, '23505');
INSERT INTO tasks (project_id, id, position, name, level, kind, duration) VALUES (2, 2, 1, 'همان کد در پروژه‌ی دیگر', 1, 'task', 1);
SELECT pg_temp.expect_true('same task id allowed in another project', true);

-- جابه‌جایی ردیف‌ها در یک تراکنش بدون برخورد موقت
BEGIN;
UPDATE tasks SET position = position + 100 WHERE project_id = 1;
UPDATE tasks SET position = position - 99 WHERE project_id = 1;
COMMIT;
SELECT pg_temp.expect_true('position shift inside a transaction', (SELECT min(position) FROM tasks WHERE project_id = 1) = 2);
-- جابه‌جایی دو ردیف با هم (swap) به لطف DEFERRABLE
BEGIN;
UPDATE tasks SET position = CASE id WHEN 2 THEN 4 WHEN 3 THEN 3 END WHERE project_id = 1 AND id IN (2, 3);
COMMIT;
SELECT pg_temp.expect_true('swap positions', (SELECT position FROM tasks WHERE project_id = 1 AND id = 2) = 4 AND (SELECT position FROM tasks WHERE project_id = 1 AND id = 3) = 3);

-- ───── وابستگی‌ها
SELECT pg_temp.expect_error('self dependency', $$INSERT INTO task_dependencies (project_id, task_id, predecessor_id) VALUES (1, 2, 2)$$, '23514');
SELECT pg_temp.expect_error('dependency type enum', $$INSERT INTO task_dependencies (project_id, task_id, predecessor_id, dep_type) VALUES (1, 4, 2, 'XX')$$, '23514');
SELECT pg_temp.expect_error('dependency to missing task', $$INSERT INTO task_dependencies (project_id, task_id, predecessor_id) VALUES (1, 4, 99)$$, '23503');
SELECT pg_temp.expect_error('dependency across projects', $$INSERT INTO task_dependencies (project_id, task_id, predecessor_id) VALUES (2, 2, 3)$$, '23503');
SELECT pg_temp.expect_error('duplicate pair', $$INSERT INTO task_dependencies (project_id, task_id, predecessor_id) VALUES (1, 3, 2)$$, '23505');

-- ───── منابع و تخصیص
INSERT INTO resources (project_id, id, name, type, capacity_percent, daily_rate) VALUES (1, 1, 'ENG', 'human', 100, 1000), (1, 2, 'CASH', 'financial', 100, 5000);
SELECT pg_temp.expect_error('resource name unique per project', $$INSERT INTO resources (project_id, id, name) VALUES (1, 3, 'ENG')$$, '23505');
SELECT pg_temp.expect_error('resource name separators forbidden', $$INSERT INTO resources (project_id, id, name) VALUES (1, 3, 'a:b')$$, '23514');
SELECT pg_temp.expect_error('resource capacity positive', $$INSERT INTO resources (project_id, id, name, capacity_percent) VALUES (1, 3, 'z', 0)$$, '23514');
INSERT INTO task_assignments (project_id, task_id, resource_id, units) VALUES (1, 2, 1, 100), (1, 3, 1, 50);
SELECT pg_temp.expect_error('assignment units positive', $$INSERT INTO task_assignments (project_id, task_id, resource_id, units) VALUES (1, 4, 2, 0)$$, '23514');
SELECT pg_temp.expect_error('cannot delete assigned resource', $$DELETE FROM resources WHERE project_id = 1 AND id = 1$$, '23503');
SELECT pg_temp.expect_error('direct cost positive', $$INSERT INTO task_direct_costs (project_id, task_id, line_no, amount) VALUES (1, 2, 1, 0)$$, '23514');

-- ───── هزینه‌ی واقعی
INSERT INTO cost_entries (project_id, id, entry_date, task_id, amount) VALUES (1, 1, '2026-09-02', 2, 300), (1, 2, '2026-09-02', NULL, 50);
SELECT pg_temp.expect_error('cost amount positive', $$INSERT INTO cost_entries (project_id, id, entry_date, amount) VALUES (1, 3, '2026-09-02', 0)$$, '23514');
SELECT pg_temp.expect_error('deleting a task with ledger entries is blocked', $$DELETE FROM tasks WHERE project_id = 1 AND id = 2$$, '23503');
SELECT pg_temp.expect_error('ledger entry for missing task', $$INSERT INTO cost_entries (project_id, id, entry_date, task_id, amount) VALUES (1, 4, '2026-09-02', 77, 5)$$, '23503');
DELETE FROM tasks WHERE project_id = 1 AND id = 4;
SELECT pg_temp.expect_true('deleting a task cascades its dependencies', (SELECT count(*) FROM task_dependencies WHERE project_id = 1 AND task_id = 4) = 0);

-- ───── خط مبنا
INSERT INTO baselines (project_id, id, status_date, is_current) VALUES (1, 1, '2026-09-01', true);
SELECT pg_temp.expect_error('only one current baseline', $$INSERT INTO baselines (project_id, id, status_date, is_current) VALUES (1, 2, '2026-09-02', true)$$, '23505');
INSERT INTO baselines (project_id, id, status_date, is_current) VALUES (1, 2, '2026-09-02', false);
INSERT INTO baseline_items (project_id, baseline_id, task_id, start_date, finish_date, zero_duration, cost) VALUES (1, 1, 3, '2026-09-01', '2026-09-03', false, 100);
SELECT pg_temp.expect_error('baseline item finish before start', $$INSERT INTO baseline_items (project_id, baseline_id, task_id, start_date, finish_date) VALUES (1, 1, 2, '2026-09-05', '2026-09-01')$$, '23514');
-- بایگانی خط مبنا باید پس از حذف فعالیت هم سالم بماند
DELETE FROM tasks WHERE project_id = 1 AND id = 3;
SELECT pg_temp.expect_true('baseline items survive task deletion', (SELECT count(*) FROM baseline_items WHERE project_id = 1 AND task_id = 3) = 1);

-- ───── اسنپ‌شات
INSERT INTO snapshots (project_id, snapshot_date, actual_percent, planned_percent, estimated) VALUES (1, '2026-09-02', 20, 20, false);
INSERT INTO snapshot_tasks (project_id, snapshot_date, task_id, percent) VALUES (1, '2026-09-02', 2, 50);
SELECT pg_temp.expect_error('snapshot task percent range', $$INSERT INTO snapshot_tasks (project_id, snapshot_date, task_id, percent) VALUES (1, '2026-09-02', 3, 150)$$, '23514');
SELECT pg_temp.expect_error('one snapshot per date', $$INSERT INTO snapshots (project_id, snapshot_date, actual_percent) VALUES (1, '2026-09-02', 1)$$, '23505');

-- ───── قرارداد
INSERT INTO project_contract (project_id, amount, retention_mode, retention_value) VALUES (1, 1000000, 'percent', 10);
SELECT pg_temp.expect_error('retention percent above 100', $$UPDATE project_contract SET retention_value = 150 WHERE project_id = 1$$, '23514');
SELECT pg_temp.expect_error('commission percent above 100', $$UPDATE project_contract SET sales_commission_percent = 101 WHERE project_id = 1$$, '23514');
SELECT pg_temp.expect_error('retention mode enum', $$UPDATE project_contract SET retention_mode = 'x' WHERE project_id = 1$$, '23514');

-- ───── رکوردها
SELECT pg_temp.expect_error('risk probability range', $$INSERT INTO risks (project_id, id, probability) VALUES (1, 1, 6)$$, '23514');
SELECT pg_temp.expect_error('risk status enum', $$INSERT INTO risks (project_id, id, status) VALUES (1, 1, 'weird')$$, '23514');
SELECT pg_temp.expect_error('document url scheme', $$INSERT INTO project_documents (project_id, id, title, url) VALUES (1, 1, 't', 'javascript:alert(1)')$$, '23514');
INSERT INTO project_documents (project_id, id, title, url, task_id) VALUES (1, 1, 'نقشه', 'https://example.com/a.pdf', 2);
SELECT pg_temp.expect_error('chat body required', $$INSERT INTO chat_messages (project_id, id, user_id, body) VALUES (1, 1, 2, '   ')$$, '23514');

-- ───── ممیزی فقط-افزودنی
INSERT INTO audit_log (project_id, actor_id, actor_name, action, entity, entity_id, field, old_value, new_value) VALUES (1, 2, 'علی', 'update', 'task', '2', 'percent_complete', '0', '50');
SELECT pg_temp.expect_error('audit update blocked', $$UPDATE audit_log SET actor_name = 'x'$$, '42501');
SELECT pg_temp.expect_error('audit delete blocked', $$DELETE FROM audit_log$$, '42501');
SELECT pg_temp.expect_error('audit truncate blocked', $$TRUNCATE audit_log$$, '42501');
DELETE FROM projects WHERE id = 2;
SELECT pg_temp.expect_true('audit row still there', (SELECT count(*) FROM audit_log) = 1);

-- ───── حذف پروژه همه‌ی وابسته‌ها را پاک می‌کند
DELETE FROM projects WHERE id = 1;
SELECT pg_temp.expect_true('project deletion cascades', (SELECT count(*) FROM tasks) = 0 AND (SELECT count(*) FROM resources) = 0 AND (SELECT count(*) FROM baseline_items) = 0 AND (SELECT count(*) FROM project_members) = 0);

\o
\pset tuples_only on
SELECT 'passed checks: ' || count(*) FROM t_result;
