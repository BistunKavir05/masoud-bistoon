import type { TabKey } from '../state/route.ts';
import { PageHead, Alert } from '../ui/controls.tsx';
import { CharterTab } from './charter/CharterTab.tsx';
import { DashboardTab } from './dashboard/DashboardTab.tsx';
import { FinanceTab } from './finance/FinanceTab.tsx';
import { ChangesTab, DecisionsTab, RisksTab } from './records/RisksTab.tsx';
import { ResourcesTab } from './resources/ResourcesTab.tsx';
import { ScurveTab } from './scurve/ScurveTab.tsx';
import { TasksTab } from './tasks/TasksTab.tsx';

/** نگاشت کلید تب به صفحه‌ی آن */
export function TabView({ tab }: { tab: TabKey }) {
  switch (tab) {
    case 'dash':
      return <DashboardTab />;
    case 'fin':
      return <FinanceTab />;
    case 'chr':
      return <CharterTab />;
    case 'res':
      return <ResourcesTab />;
    case 'ri':
      return <RisksTab />;
    case 'chg':
      return <ChangesTab />;
    case 'dec':
      return <DecisionsTab />;
    case 'scurve':
      return <ScurveTab />;
    case 'tasks':
      return <TasksTab />;
    default:
      return (
        <>
          <PageHead title={tab} />
          <Alert kind="info">در حال ساخت…</Alert>
        </>
      );
  }
}
