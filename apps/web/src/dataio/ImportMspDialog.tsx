/**
 * ورود برنامه از فایل Microsoft Project (XML) به پروژه‌ی موجود — فقط ادمین (data.import).
 * جریان: انتخاب فایل ← پیش‌نمایش کامل از سرور (چیزی نوشته نمی‌شود) ← بررسی اثر بر هر دسته از داده ← تأیید صریح ← اعمال یکجا.
 * اگر مانعی باشد (چرخه‌ی وابستگی، هزینه‌ی ثبت‌شده روی فعالیت حذف‌شونده، پروژه‌ی بایگانی‌شده) اعمال ممکن نیست.
 */
import { useEffect, useRef, useState } from 'react';
import type { MspMapping, MspPreviewDto } from '@bistoon/core';
import { apiPost, errorMessage } from '../api/client.ts';
import { faDate, faInt, faMoney, faNum } from '../lib/fmt.ts';
import { FileReadError, readXmlFile } from '../lib/readFile.ts';
import { reloadProject, useProjectState } from '../state/project.ts';
import { Alert, Badge, Btn, CheckField, Kpi, NumberField, SelectField, useAction } from '../ui/controls.tsx';
import { confirmDialog, openDialog } from '../ui/dialogs.tsx';
import { downloadBackup } from './ExportMenu.tsx';
import { Facts, FilePick, LEVEL_BADGE, WarningList } from './shared.tsx';

type MappingChoice = 'auto' | MspMapping;

export const MAPPING_LABELS: Record<MspMapping, string> = {
  id: 'هم‌شناسه (UID فایل = شناسه‌ی فعالیت در بیستون)',
  name: 'هم‌نام (تطبیق با نام فعالیت)',
  none: 'بدون نگاشت (همه‌ی فعالیت‌های فعلی حذف و فعالیت‌های فایل تازه ساخته می‌شود)',
};
const MAPPING_SHORT: Record<MspMapping, string> = { id: 'هم‌شناسه', name: 'هم‌نام', none: 'بدون نگاشت' };

export function openMspImportDialog(): void {
  void openDialog('ورود برنامه از فایل MS Project', (close) => <MspImportBody close={() => close()} />, { wide: true });
}

function MspImportBody({ close }: { close: () => void }) {
  const ps = useProjectState();
  const project = ps.bundle!.project;
  const [file, setFile] = useState<{ name: string; xml: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<MappingChoice>('auto');
  const [keepProgress, setKeepProgress] = useState(false);
  const [keepStart, setKeepStart] = useState(false);
  const [hours, setHours] = useState<number | null>(null);
  const [backupFirst, setBackupFirst] = useState(true);
  const [preview, setPreview] = useState<MspPreviewDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const seq = useRef(0);
  const { busy, run } = useAction();

  const body = (): Record<string, unknown> => ({ xml: file!.xml, mapping, keepProgress, keepStart, ...(hours !== null ? { hoursPerDay: hours } : {}) });

  // هر تغییر در فایل یا گزینه‌ها پیش‌نمایش را دوباره می‌گیرد (با کمی تأخیر برای تایپ ساعت)
  useEffect(() => {
    if (!file) return;
    const my = ++seq.current;
    setLoading(true);
    const h = setTimeout(() => {
      apiPost<MspPreviewDto>(`/projects/${project.id}/import/msp/preview`, body())
        .then((p) => {
          if (my !== seq.current) return;
          setPreview(p);
          setPreviewError(null);
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
  }, [file, mapping, keepProgress, keepStart, hours, nonce, project.id]);

  const pick = async (f: File): Promise<void> => {
    setFileError(null);
    try {
      const xml = await readXmlFile(f);
      setPreview(null);
      setPreviewError(null);
      setFile({ name: f.name, xml });
    } catch (e) {
      setFileError(e instanceof FileReadError ? e.message : 'خواندن فایل ممکن نشد.');
    }
  };

  const blocked = (preview?.blockers.length ?? 0) > 0;
  const canApply = preview !== null && !blocked && !loading && !busy && !project.archived;

  const apply = async (): Promise<void> => {
    if (!preview || !file) return;
    const r = preview.result;
    const ok = await confirmDialog({
      title: 'اعمال ورود از فایل MS Project',
      danger: r.removed.count > 0 || r.replaceBaseline,
      confirmLabel: 'اعمال ورود',
      message: (
        <div className="stack gap-s">
          <p>
            برنامه‌ی فعالیت‌ها با «{file.name}» جایگزین می‌شود: {faInt(r.matched)} فعالیت به‌روز، {faInt(r.added)} فعالیت جدید و {faInt(r.removed.count)} فعالیت حذف می‌شود.
            {r.replaceBaseline ? ' خط مبنای فعلی بایگانی و با خط مبنای فایل جایگزین می‌شود.' : ''}
          </p>
          <p className="small">ثبت یکجاست (یا همه یا هیچ) و در گزارش تغییرات می‌ماند. بازگرداندن آن فقط با بازیابی پشتیبان ممکن است{backupFirst ? '؛ پشتیبان همین‌حالا ذخیره می‌شود.' : ' و شما پشتیبان نگرفته‌اید.'}</p>
        </div>
      ),
    });
    if (!ok) return;
    const done = await run(async () => {
      if (backupFirst) {
        try {
          await downloadBackup(project.id, project.status);
        } catch (e) {
          throw new Error(`پشتیبان گرفته نشد و ورود انجام نشد: ${errorMessage(e)}`);
        }
      }
      await apiPost(`/projects/${project.id}/import/msp`, { ...body(), token: preview.token, confirm: true });
      await reloadProject();
      return true;
    }, 'برنامه از فایل وارد شد.');
    if (done) close();
    else setNonce((n) => n + 1); // اگر پروژه عوض شده بود پیش‌نمایش تازه لازم است
  };

  return (
    <>
      <div className="body stack" data-testid="msp-import-dialog">
        <Alert kind="info">
          فایل XML ذخیره‌شده از Microsoft Project (قالب MSPDI) را انتخاب کنید. تا وقتی «اعمال ورود» را نزده‌اید چیزی در پروژه تغییر نمی‌کند. منابع، تخصیص‌ها، دفتر هزینه، اسناد و سایر داده‌های پروژه از فایل نمی‌آیند و دست‌نخورده می‌مانند.
        </Alert>

        <FilePick label="انتخاب فایل XML" accept=".xml,text/xml,application/xml" onFile={(f) => void pick(f)} testId="msp-file" fileName={file?.name ?? null} />
        {fileError ? <Alert kind="bad">{fileError}</Alert> : null}

        {file ? (
          <div className="form-grid">
            <SelectField<MappingChoice>
              label="نگاشت فعالیت‌ها"
              value={mapping}
              onChange={setMapping}
              options={[
                { value: 'auto', label: preview ? `خودکار (پیشنهاد: ${MAPPING_SHORT[preview.mapping.suggested]})` : 'خودکار' },
                { value: 'id', label: MAPPING_SHORT.id },
                { value: 'name', label: MAPPING_SHORT.name },
                { value: 'none', label: MAPPING_SHORT.none },
              ]}
              hint="مشخص می‌کند هر ردیف فایل کدام فعالیت فعلی را به‌روز کند؛ ردیف‌های بی‌جفت جدید و فعالیت‌های بی‌جفت حذف می‌شوند."
              wide
            />
            <NumberField label="ساعت کاری هر روز" value={hours} onChange={setHours} min={0.25} max={24} allowEmpty maxFraction={2} hint={preview ? `خالی = مقدار فایل (${faNum(preview.file.hoursPerDay, 2)} ساعت)` : 'خالی = مقدار خود فایل'} testId="msp-hours" />
            <CheckField label="پیشرفت و تاریخ‌های واقعی فعلی حفظ شود" checked={keepProgress} onChange={setKeepProgress} hint="برای فعالیت‌های هم‌جفت، درصد پیشرفت و تاریخ‌های واقعی از پروژه می‌ماند نه از فایل." />
            <CheckField label="تاریخ شروع فعلی پروژه حفظ شود" checked={keepStart} onChange={setKeepStart} hint="در غیر این صورت شروع پروژه از فایل گرفته می‌شود." />
          </div>
        ) : null}

        {loading ? <p className="muted" role="status">در حال بررسی فایل…</p> : null}
        {previewError ? <Alert kind="bad"><span data-testid="msp-preview-error">{previewError}</span></Alert> : null}
        {preview ? <PreviewPanel p={preview} mapping={mapping} /> : null}

        {preview ? <CheckField label="پیش از ورود، پشتیبان کامل پروژه (JSON) را ذخیره کن" checked={backupFirst} onChange={setBackupFirst} hint="توصیه می‌شود؛ بازگردانی ورود فقط با همین پشتیبان ممکن است." /> : null}
      </div>
      <footer>
        <Btn kind="primary" icon="upload" busy={busy} disabled={!canApply} testId="msp-apply" onClick={apply}>
          اعمال ورود
        </Btn>
        <Btn onClick={close}>انصراف</Btn>
        {blocked ? <span className="small" style={{ color: 'var(--bad)' }}>تا رفع مانع‌ها ورود ممکن نیست.</span> : null}
      </footer>
    </>
  );
}

function PreviewPanel({ p, mapping }: { p: MspPreviewDto; mapping: MappingChoice }) {
  const r = p.result;
  const f = p.file;
  const sch = r.schedule;
  return (
    <div className="stack" data-testid="msp-preview">
      {p.blockers.length > 0 ? (
        <Alert kind="bad">
          <strong>ورود ممکن نیست:</strong>
          <ul data-testid="msp-blockers">
            {p.blockers.map((b, i) => (
              <li key={i}>{b.message}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <Facts
        items={[
          { label: 'نام پروژه در فایل', value: f.name || '—' },
          { label: 'ردیف‌های فایل', value: `${faInt(f.counts.rows)} (${faInt(f.counts.tasks)} فعالیت، ${faInt(f.counts.summaries)} خلاصه، ${faInt(f.counts.milestones)} مایلستون)` },
          { label: 'خط مبنا در فایل', value: f.counts.baselines > 0 ? `${faInt(f.counts.baselines)} ردیف` : 'ندارد' },
          { label: 'تقویم', value: 'تقویم کاری و تعطیلات همین پروژه به کار می‌رود' },
          { label: 'شروع پروژه پس از ورود', value: <span className="num">{faDate(r.start)}</span> },
          { label: 'ساعت هر روز', value: `${faNum(f.hoursPerDay, 2)}` },
        ]}
      />

      <div className="grid cols-4" data-testid="msp-counts">
        <Kpi label="به‌روز می‌شود" value={faInt(r.matched)} />
        <Kpi label="جدید" value={faInt(r.added)} />
        <Kpi label="حذف می‌شود" value={faInt(r.removed.count)} tone={r.removed.count > 0 ? 'warn' : ''} />
        <Kpi label="تغییر نام" value={faInt(r.renamed.count)} />
      </div>

      {sch.ok ? (
        <p className="small" data-testid="msp-schedule">
          برنامه‌ی پس از ورود: شروع <strong className="num">{faDate(sch.start)}</strong>، پیش‌بینی پایان <strong className="num">{faDate(sch.finish)}</strong>، {faInt(sch.workingDays)} روز کاری، {faInt(sch.criticalCount)} فعالیت بحرانی.
        </p>
      ) : (
        <Alert kind="bad">وابستگی‌های فایل چرخه دارد (فعالیت‌های درگیر: {sch.cycleTaskNames.slice(0, 6).join('، ')}).</Alert>
      )}

      <details>
        <summary>جزئیات نگاشت ({MAPPING_SHORT[p.mapping.used]}{mapping === 'auto' ? '، خودکار' : ''})</summary>
        <div className="tbl-wrap" style={{ marginTop: 8 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>روش نگاشت</th>
                <th className="n">فعالیت هم‌جفت</th>
                <th className="n">با نام متفاوت</th>
              </tr>
            </thead>
            <tbody>
              {(['id', 'name', 'none'] as const).map((m) => (
                <tr key={m} className={m === p.mapping.used ? 'sel' : ''}>
                  <td>
                    {MAPPING_SHORT[m]} {m === p.mapping.suggested ? <Badge kind="brand">پیشنهادی</Badge> : null}
                  </td>
                  <td className="n">{faInt(p.mapping.stats[m].matched)}</td>
                  <td className="n">{faInt(p.mapping.stats[m].renamed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">{MAPPING_LABELS[p.mapping.used]}</p>
      </details>

      {r.removed.count > 0 ? (
        <div className="stack gap-s" data-testid="msp-removed">
          <strong>فعالیت‌های حذف‌شونده ({faInt(r.removed.count)})</strong>
          <div className="tbl-wrap" style={{ maxHeight: 220 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>نام</th>
                  <th className="n">ردیف هزینه</th>
                  <th className="n">مبلغ هزینه</th>
                  <th className="n">اسناد</th>
                  <th className="n">تخصیص</th>
                  <th>پیشرفت</th>
                </tr>
              </thead>
              <tbody>
                {r.removed.items.map((x) => (
                  <tr key={x.id} className={x.ledgerRows > 0 ? 'crit' : ''}>
                    <td>{x.name}</td>
                    <td className="n">{faInt(x.ledgerRows)}</td>
                    <td className="n">{x.ledgerRows > 0 ? faMoney(x.ledgerAmount, '') : '—'}</td>
                    <td className="n">{faInt(x.documents)}</td>
                    <td className="n">{faInt(x.assignments)}</td>
                    <td>{x.hasProgress ? <Badge kind="warn">دارد</Badge> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {r.removed.count > r.removed.items.length ? <span className="muted small">و {faInt(r.removed.count - r.removed.items.length)} فعالیت دیگر.</span> : null}
        </div>
      ) : null}

      {r.renamed.count > 0 ? (
        <details>
          <summary>{faInt(r.renamed.count)} فعالیت تغییر نام می‌دهد</summary>
          <ul className="plain-list small">
            {r.renamed.items.map((x) => (
              <li key={x.id}>
                «{x.from}» ← «{x.to}»
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {r.kindChanged.count > 0 ? (
        <Alert kind="warn">
          نوع {faInt(r.kindChanged.count)} فعالیت عوض می‌شود (مثلاً از فعالیت به خلاصه): {r.kindChanged.items.slice(0, 5).map((x) => x.name).join('، ')}
          {r.kindChanged.count > 5 ? '…' : ''}
        </Alert>
      ) : null}

      <div className="stack gap-s" data-testid="msp-effects">
        <strong>اثر ورود بر داده‌های پروژه</strong>
        <div className="tbl-wrap">
          <table className="tbl">
            <tbody>
              {p.effects.map((e, i) => (
                <tr key={i}>
                  <th scope="row" style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{e.area}</th>
                  <td>{e.text}</td>
                  <td className="c">{LEVEL_BADGE[e.level]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <WarningList warnings={p.warnings} testId="msp-warnings" />
    </div>
  );
}

