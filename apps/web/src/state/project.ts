/**
 * وضعیت پروژه‌ی جاری: بسته‌ی مدل از سرور + تحلیل (زمان‌بندی، پیشرفت، مالی، منحنی S) که با همان هسته‌ی مشترک محاسبه می‌شود.
 * هر تغییر موفق، مدل را دوباره از سرور می‌خواند تا رابط همیشه با پایگاه‌داده یکی باشد.
 */
import { analyzeProject, emptyCharter, emptyContract } from '@bistoon/core';
import type { Analysis, Capability, ModelBundle, ProjectModel, ScheduleFailure } from '@bistoon/core';
import { apiGet } from '../api/client.ts';
import { errorMessage } from '../api/client.ts';
import { createStore, useStore } from './store.ts';

export interface ProjectState {
  pid: number | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  bundle: ModelBundle | null;
  model: ProjectModel | null;
  /** تحلیل موفق؛ null اگر نقش اجازه‌ی دیدن فعالیت‌ها را ندارد یا برنامه محاسبه‌پذیر نیست */
  analysis: Analysis | null;
  /** خطای محاسبه‌ی برنامه (مثلاً دور در وابستگی‌ها) */
  scheduleFailure: ScheduleFailure | null;
  /** شمارنده‌ی بارگذاری؛ برای واکنش کامپوننت‌ها */
  rev: number;
  refreshing: boolean;
}

export const projectStore = createStore<ProjectState>({
  pid: null,
  status: 'idle',
  error: null,
  bundle: null,
  model: null,
  analysis: null,
  scheduleFailure: null,
  rev: 0,
  refreshing: false,
});

export function buildModel(b: ModelBundle): ProjectModel | null {
  if (!b.tasks || !b.calendar) return null;
  return {
    name: b.project.name,
    start: b.project.start,
    status: b.project.status,
    contractEnd: b.project.contractEnd,
    calendar: b.calendar,
    tasks: b.tasks,
    resources: b.resources ?? [],
    baseline: b.baseline?.items ?? {},
    baselineHistory: (b.baselineHistory ?? []).map((h) => ({ id: h.id, archivedOn: h.archivedOn, items: h.items })),
    snapshots: b.snapshots ?? [],
    costs: b.costs ?? [],
    finance: b.project.finance,
    charter: b.charter ?? emptyCharter(),
    contract: { ...emptyContract(), ...(b.contract ?? {}) },
    risks: b.risks ?? [],
    issues: b.issues ?? [],
    changes: b.changes ?? [],
    decisions: b.decisions ?? [],
    documents: b.documents ?? [],
  };
}

let seq = 0;

function apply(pid: number, bundle: ModelBundle): void {
  const model = buildModel(bundle);
  let analysis: Analysis | null = null;
  let failure: ScheduleFailure | null = null;
  if (model) {
    const r = analyzeProject(model);
    if ('schedule' in r) analysis = r;
    else failure = r;
  }
  projectStore.set((s) => ({ ...s, pid, status: 'ready', error: null, bundle, model, analysis, scheduleFailure: failure, rev: s.rev + 1, refreshing: false }));
}

/** بارگذاری پروژه (با تغییر پروژه یا ورود به آن) */
export async function openProject(pid: number): Promise<void> {
  const my = ++seq;
  projectStore.set((s) => ({ ...s, pid, status: 'loading', error: null, ...(s.pid !== pid ? { bundle: null, model: null, analysis: null, scheduleFailure: null } : {}) }));
  try {
    const bundle = await apiGet<ModelBundle>(`/projects/${pid}/model`);
    if (my === seq) apply(pid, bundle);
  } catch (e) {
    if (my === seq) projectStore.set((s) => ({ ...s, status: 'error', error: errorMessage(e), refreshing: false }));
  }
}

/** خواندن دوباره‌ی مدل پس از تغییر؛ حالت صفحه (پیمایش، فرم باز) را از بین نمی‌برد. */
export async function reloadProject(): Promise<void> {
  const pid = projectStore.get().pid;
  if (pid === null) return;
  const my = ++seq;
  projectStore.set((s) => ({ ...s, refreshing: true }));
  try {
    const bundle = await apiGet<ModelBundle>(`/projects/${pid}/model`);
    if (my === seq) apply(pid, bundle);
  } catch (e) {
    if (my === seq) projectStore.set((s) => ({ ...s, refreshing: false, error: errorMessage(e) }));
    throw e;
  }
}

export function closeProject(): void {
  seq++;
  projectStore.set({ pid: null, status: 'idle', error: null, bundle: null, model: null, analysis: null, scheduleFailure: null, rev: projectStore.get().rev + 1, refreshing: false });
}

// ───── hookها ─────

export const useProjectState = (): ProjectState => useStore(projectStore, (s) => s);

export function useCan(): (c: Capability) => boolean {
  const caps = useStore(projectStore, (s) => s.bundle?.me.capabilities ?? null);
  return (c) => (caps ? caps.includes(c) : false);
}
