/**
 * پروژه‌ی جدید — فقط ادمین سیستم. چهار منبع:
 *  - خالی: نام و تاریخ‌ها را می‌دهید.
 *  - فایل MS Project (XML): شناسه‌ی فعالیت = UID فایل، تقویم از خود فایل.
 *  - بازیابی پشتیبان (JSON بیستون): همیشه پروژه‌ی «جدید» می‌سازد؛ کاربران و نقش‌ها وارد نمی‌شوند.
 *  - نسخه‌ی قدیمی بیستون (JSON): تبدیل با اصلاح و هشدار.
 * برای سه حالت فایلی، پیش‌نمایش را سرور (dryRun) با همان اعتبارسنجی ساخت می‌دهد و چیزی نوشته نمی‌شود.
 */
import { useEffect, useRef, useState } from 'react';
import { ROLE_LABELS } from '@bistoon/core';
import type { Capped, ImportPreviewDto, MspNewPreviewDto } from '@bistoon/core';
import { apiPost, errorMessage } from '../api/client.ts';
import { faDate, faDateTime, faInt } from '../lib/fmt.ts';
import { FileReadError, readJsonFile, readXmlFile } from '../lib/readFile.ts';
import { navigate } from '../state/route.ts';
import { refreshProjects } from '../state/session.ts';
import { Alert, Btn, NumberField, Segmented, TextField, useAction } from '../ui/controls.tsx';
import { DateField } from '../ui/DateField.tsx';
import { Facts, FilePick, WarningList } from './shared.tsx';

type Source = 'empty' | 'msp' | 'backup' | 'legacy';
const SOURCES: readonly { value: Source; label: string }[] = [
  { value: 'empty', label: 'پروژه‌ی خالی' },
  { value: 'msp', label: 'از فایل MS Project' },
  { value: 'backup', label: 'بازیابی پشتیبان' },
  { value: 'legacy', label: 'نسخه‌ی قدیمی' },
];

export function NewProjectForm({ close }: { close: () => void }) {
  const [source, setSource] = useState<Source>('empty');
  return (
    <>
      <div className="body" style={{ paddingBottom: 0 }}>
        <Segmented<Source> label="منبع پروژه" value={source} onChange={setSource} options={SOURCES} />
      </div>
      {source === 'empty' ? <EmptyForm close={close} /> : source === 'msp' ? <MspForm close={close} /> : <JsonForm key={source} kind={source} close={close} />}
    </>
  );
}

async function created(id: number, close: () => void): Promise<void> {
  await refreshProjects();
  close();
  navigate({ pid: id, tab: 'tasks' });
}

function EmptyForm({ close }: { close: () => void }) {
  const [name, setName] = useState('');
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [unit, setUnit] = useState('ریال');
  const { busy, run } = useAction();
  const endErr = start && end && end <= start ? 'تاریخ پایان باید بعد از تاریخ شروع باشد.' : null;
  const valid = name.trim() !== '' && start !== null && !endErr && unit.trim() !== '';
  return (
    <>
      <div className="body form-grid">
        <TextField label="نام پروژه" value={name} onChange={setName} maxLength={200} required wide autoFocus testId="np-name" />
        <DateField label="تاریخ شروع" value={start} onChange={setStart} required testId="np-start" hint="پس از ساخت پروژه قابل تغییر نیست مگر با دسترسی تنظیمات پروژه." />
        <DateField label="تاریخ پایان قرارداد" value={end} onChange={setEnd} allowEmpty error={endErr} testId="np-end" />
        <TextField label="واحد پول" value={unit} onChange={setUnit} maxLength={24} hint="فقط برچسب است؛ تبدیل ارز انجام نمی‌شود." />
      </div>
      <footer>
        <Btn
          kind="primary"
          busy={busy}
          disabled={!valid}
          testId="np-submit"
          onClick={async () => {
            const r = await run(() => apiPost<{ project: { id: number } }>('/projects', { name: name.trim(), start, contractEnd: end, finance: { unit: unit.trim() } }), 'پروژه ساخته شد.');
            if (r) await created(r.project.id, close);
          }}
        >
          ساخت پروژه
        </Btn>
        <Btn onClick={close}>انصراف</Btn>
      </footer>
    </>
  );
}

// ───── از فایل MS Project ─────

function MspForm({ close }: { close: () => void }) {
  const [file, setFile] = useState<{ name: string; xml: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('ریال');
  const [hours, setHours] = useState<number | null>(null);
  const [preview, setPreview] = useState<MspNewPreviewDto | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const { busy, run } = useAction();

  const body = (): Record<string, unknown> => ({ xml: file!.xml, ...(name.trim() ? { name: name.trim() } : {}), unit: unit.trim() || 'ریال', ...(hours !== null ? { hoursPerDay: hours } : {}) });

  // نام دلخواه تنها پس از اولین پیش‌نمایش از فایل پر می‌شود؛ تغییر نام پیش‌نمایش را دوباره نمی‌گیرد
  useEffect(() => {
    if (!file) return;
    const my = ++seq.current;
    setLoading(true);
    const h = setTimeout(() => {
      apiPost<MspNewPreviewDto>('/import/msp', { ...body(), dryRun: true })
        .then((p) => {
          if (my !== seq.current) return;
          setPreview(p);
          setPreviewError(null);
          setName((n) => (n.trim() === '' ? p.name : n));
        })
        .catch((e) => {
          if (my !== seq.current) return;
          setPreview(null);
          setPreviewError(errorMessage(e));
        })
        .finally(() => {
          if (my === seq.current) setLoading(false);
        });
    }, 300);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, hours]);

  const pick = async (f: File): Promise<void> => {
    setFileError(null);
    try {
      const xml = await readXmlFile(f);
      setPreview(null);
      setPreviewError(null);
      setName('');
      setFile({ name: f.name, xml });
    } catch (e) {
      setFileError(e instanceof FileReadError ? e.message : 'خواندن فایل ممکن نشد.');
    }
  };

  const s = preview?.summary;
  return (
    <>
      <div className="body stack" data-testid="np-msp">
        <Alert kind="info">فایل XML ذخیره‌شده از Microsoft Project را انتخاب کنید. شناسه‌ی هر فعالیت همان UID فایل می‌شود و تقویم کاری و تعطیلات هم از خود فایل خوانده می‌شود. منابع، هزینه و قرارداد در فایل نیست و بعداً در خود برنامه تکمیل می‌شود.</Alert>
        <FilePick label="انتخاب فایل XML" accept=".xml,text/xml,application/xml" onFile={(f) => void pick(f)} testId="np-msp-file" fileName={file?.name ?? null} />
        {fileError ? <Alert kind="bad">{fileError}</Alert> : null}
        {file ? (
          <div className="form-grid">
            <TextField label="نام پروژه" value={name} onChange={setName} maxLength={200} required wide testId="np-msp-name" hint="از فایل پیشنهاد می‌شود؛ می‌توانید عوض کنید." />
            <TextField label="واحد پول" value={unit} onChange={setUnit} maxLength={24} hint="فقط برچسب است." />
            <NumberField label="ساعت کاری هر روز" value={hours} onChange={setHours} min={0.25} max={24} allowEmpty maxFraction={2} hint={s ? `خالی = مقدار فایل (${s.file.hoursPerDay} ساعت)` : 'خالی = مقدار خود فایل'} />
          </div>
        ) : null}
        {loading ? <p className="muted" role="status">در حال بررسی فایل…</p> : null}
        {previewError ? <Alert kind="bad"><span data-testid="np-preview-error">{previewError}</span></Alert> : null}
        {s ? (
          <div className="stack" data-testid="np-msp-preview">
            <Facts
              items={[
                { label: 'ردیف‌های فایل', value: `${faInt(s.rows)} (${faInt(s.file.counts.tasks)} فعالیت، ${faInt(s.file.counts.summaries)} خلاصه، ${faInt(s.file.counts.milestones)} مایلستون)` },
                { label: 'شروع پروژه', value: <span className="num">{faDate(s.file.start)}</span> },
                { label: 'خط مبنا', value: s.baselineItems > 0 ? `${faInt(s.baselineItems)} ردیف` : 'ندارد' },
                { label: 'تقویم', value: s.file.calendarFromFile ? 'از فایل' : 'پیش‌فرض برنامه' },
                { label: 'اسنپ‌شات‌های تخمینی', value: faInt(s.snapshots) },
              ]}
            />
            {s.schedule.ok ? (
              <p className="small">
                پیش‌بینی پایان <strong className="num">{faDate(s.schedule.finish)}</strong>، {faInt(s.schedule.workingDays)} روز کاری، {faInt(s.schedule.criticalCount)} فعالیت بحرانی.
              </p>
            ) : (
              <Alert kind="bad">وابستگی‌های فایل چرخه دارد؛ ورود ممکن نیست (فعالیت‌های درگیر: {s.schedule.cycleTaskNames.slice(0, 6).join('، ')}).</Alert>
            )}
            <WarningList warnings={preview!.warnings as Capped<{ code: string; message: string }>} testId="np-warnings" />
          </div>
        ) : null}
      </div>
      <footer>
        <Btn
          kind="primary"
          busy={busy}
          disabled={!preview || loading || name.trim() === '' || !preview.summary.schedule.ok}
          testId="np-msp-submit"
          onClick={async () => {
            const r = await run(() => apiPost<{ projectId: number }>('/import/msp', body()), 'پروژه از فایل ساخته شد.');
            if (r) await created(r.projectId, close);
          }}
        >
          ساخت پروژه از فایل
        </Btn>
        <Btn onClick={close}>انصراف</Btn>
      </footer>
    </>
  );
}

// ───── بازیابی پشتیبان و ورود نسخه‌ی قدیمی ─────

function JsonForm({ kind, close }: { kind: 'backup' | 'legacy'; close: () => void }) {
  const url = kind === 'backup' ? '/import/project' : '/import/legacy';
  const [file, setFile] = useState<{ name: string; doc: Record<string, unknown> } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreviewDto | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { busy, run } = useAction();

  const pick = async (f: File): Promise<void> => {
    setFileError(null);
    setPreview(null);
    setPreviewError(null);
    setFile(null);
    let doc: Record<string, unknown>;
    try {
      doc = await readJsonFile(f);
    } catch (e) {
      setFileError(e instanceof FileReadError ? e.message : 'خواندن فایل ممکن نشد.');
      return;
    }
    setFile({ name: f.name, doc });
    setLoading(true);
    try {
      setPreview(await apiPost<ImportPreviewDto>(`${url}?dryRun=1`, doc));
    } catch (e) {
      setPreviewError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const s = preview?.summary;
  return (
    <>
      <div className="body stack" data-testid={`np-${kind}`}>
        {kind === 'backup' ? (
          <Alert kind="info">فایل پشتیبانی را انتخاب کنید که از «خروجی ← پشتیبان کامل پروژه» گرفته‌اید. بازیابی همیشه یک پروژه‌ی <strong>جدید</strong> می‌سازد؛ پروژه‌های موجود، کاربران و نقش‌ها تغییر نمی‌کنند و اعضای پروژه را باید دوباره اضافه کنید.</Alert>
        ) : (
          <Alert kind="info">فایل JSON نسخه‌ی قدیمی بیستون را انتخاب کنید. داده‌ها با اصلاح و هشدار به قالب جدید تبدیل می‌شوند؛ کاربران قدیمی وارد نمی‌شوند و باید در پروژه عضو شوند.</Alert>
        )}
        <FilePick label="انتخاب فایل JSON" accept=".json,application/json" onFile={(f) => void pick(f)} testId={`np-${kind}-file`} fileName={file?.name ?? null} />
        {fileError ? <Alert kind="bad">{fileError}</Alert> : null}
        {loading ? <p className="muted" role="status">در حال بررسی فایل…</p> : null}
        {previewError ? <Alert kind="bad"><span data-testid="np-preview-error">{previewError}</span></Alert> : null}
        {preview && s ? (
          <div className="stack" data-testid={`np-${kind}-preview`}>
            <Facts
              items={[
                { label: 'نام پروژه', value: preview.name },
                { label: 'شروع', value: <span className="num">{faDate(preview.start)}</span> },
                ...(preview.status ? [{ label: 'تاریخ وضعیت', value: <span className="num">{faDate(preview.status)}</span> }] : []),
                ...(preview.schemaVersion !== undefined ? [{ label: 'نسخه‌ی قالب پشتیبان', value: faInt(preview.schemaVersion) }] : []),
                ...(preview.exportedAt ? [{ label: 'زمان تهیه‌ی پشتیبان', value: faDateTime(preview.exportedAt) }] : []),
                ...(preview.exportedBy ? [{ label: 'تهیه‌کننده', value: preview.exportedBy }] : []),
                { label: 'فعالیت‌ها', value: faInt(s.tasks) },
                { label: 'منابع', value: faInt(s.resources) },
                { label: 'ردیف هزینه', value: faInt(s.costs) },
                { label: 'ریسک‌ها', value: faInt(s.risks) },
                ...(s.issues !== undefined ? [{ label: 'مسائل / تغییرها / تصمیم‌ها', value: `${faInt(s.issues)} / ${faInt(s.changes ?? 0)} / ${faInt(s.decisions ?? 0)}` }] : []),
                ...(s.documents !== undefined ? [{ label: 'مستندات', value: faInt(s.documents) }] : []),
                { label: 'اسنپ‌شات‌ها', value: faInt(s.snapshots) },
                { label: 'ردیف‌های خط مبنا', value: faInt(s.baselineItems) },
              ]}
            />
            {preview.legacyUsers && preview.legacyUsers.length > 0 ? (
              <details>
                <summary>{faInt(preview.legacyUsers.length)} کاربر در فایل قدیمی (وارد نمی‌شوند)</summary>
                <ul className="plain-list small">
                  {preview.legacyUsers.map((u) => (
                    <li key={u.id}>
                      <span className="ltr">{u.id}</span> ← نقش پیشنهادی در بیستون: {ROLE_LABELS[u.suggestedRole]}
                      {u.resourceNames ? ` (منبع: ${u.resourceNames})` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            <WarningList warnings={{ count: preview.warnings.length, items: preview.warnings }} testId={`np-${kind}-warnings`} />
          </div>
        ) : null}
      </div>
      <footer>
        <Btn
          kind="primary"
          busy={busy}
          disabled={!file || !preview || loading}
          testId={`np-${kind}-submit`}
          onClick={async () => {
            if (!file) return;
            const r = await run(() => apiPost<{ projectId: number }>(url, file.doc), kind === 'backup' ? 'پروژه از پشتیبان بازیابی شد.' : 'پروژه‌ی قدیمی وارد شد.');
            if (r) await created(r.projectId, close);
          }}
        >
          {kind === 'backup' ? 'بازیابی به‌عنوان پروژه‌ی جدید' : 'ورود به‌عنوان پروژه‌ی جدید'}
        </Btn>
        <Btn onClick={close}>انصراف</Btn>
      </footer>
    </>
  );
}
