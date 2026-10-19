import { describe, expect, it } from 'vitest';
import type { ChangeRequest, Decision, Issue, Risk } from '../src/records.ts';
import { isOverdue, reportLists } from '../src/statusReport.ts';

const risk = (id: number, p: number, i: number, status: Risk['status'] = 'open'): Risk => ({ id, title: `r${id}`, category: null, probability: p, impact: i, owner: '', strategy: null, response: '', due: null, status });
const issue = (id: number, priority: Issue['priority'], due: string | null, status: Issue['status'] = 'open'): Issue => ({ id, title: `i${id}`, owner: '', priority, due: due as Issue['due'], impact: '', action: '', needsDecision: false, status });
const decision = (id: number, date: string | null, status: Decision['status'] = 'pending'): Decision => ({ id, topic: `d${id}`, text: '', maker: '', date: date as Decision['date'], status });
const change = (id: number, date: string | null, status: ChangeRequest['status'] = 'pending'): ChangeRequest => ({ id, title: `c${id}`, requester: '', date: date as ChangeRequest['date'], reason: '', impact: '', previousFinish: null, newFinish: null, status, approvedBy: '', approvedOn: null });

describe('فهرست‌های گزارش وضعیت', () => {
  it('ریسک‌های مهم: فقط باز و معتبر، به ترتیب امتیاز، با سقف', () => {
    const l = reportLists({ risks: [risk(1, 2, 2), risk(2, 5, 5), risk(3, 4, 4, 'closed'), risk(4, 3, 5), risk(5, 0, 3)], issues: [], decisions: [], changes: [] }, { maxRisks: 2 });
    expect(l.topRisks.map((r) => r.id)).toEqual([2, 4]);
  });

  it('مسائل: حل‌شده حذف؛ اولویت بالا اول؛ سررسید نزدیک‌تر؛ بدون سررسید آخر', () => {
    const l = reportLists({ risks: [], issues: [issue(1, 'low', '2026-10-01'), issue(2, 'high', null), issue(3, 'high', '2026-11-01'), issue(4, 'medium', '2026-09-01'), issue(5, 'high', '2026-10-01', 'resolved')], decisions: [], changes: [] });
    expect(l.openIssues.map((i) => i.id)).toEqual([3, 2, 4, 1]);
  });

  it('تصمیم‌ها و تغییرهای در انتظار: قدیمی‌تر اول، بدون تاریخ آخر', () => {
    const l = reportLists({ risks: [], issues: [], decisions: [decision(1, '2026-10-05'), decision(2, null), decision(3, '2026-09-01'), decision(4, '2026-01-01', 'decided')], changes: [change(1, '2026-10-05'), change(2, '2026-08-01'), change(3, null, 'approved')] });
    expect(l.pendingDecisions.map((d) => d.id)).toEqual([3, 1, 2]);
    expect(l.pendingChanges.map((c) => c.id)).toEqual([2, 1]);
  });

  it('همه‌چیز خالی → همه‌ی فهرست‌ها خالی', () => {
    const l = reportLists({ risks: [], issues: [], decisions: [], changes: [] });
    expect(l.topRisks.length + l.openIssues.length + l.pendingDecisions.length + l.pendingChanges.length).toBe(0);
  });

  it('سررسیدگذشته', () => {
    expect(isOverdue('2026-10-01' as never, '2026-10-19' as never)).toBe(true);
    expect(isOverdue('2026-10-19' as never, '2026-10-19' as never)).toBe(false);
    expect(isOverdue(null, '2026-10-19' as never)).toBe(false);
  });
});
