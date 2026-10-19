import type { TabKey } from '../state/route.ts';
import { PageHead, Alert } from '../ui/controls.tsx';
import { DashboardTab } from './dashboard/DashboardTab.tsx';
import { TasksTab } from './tasks/TasksTab.tsx';

/** نگاشت کلید تب به صفحه‌ی آن */
export function TabView({ tab }: { tab: TabKey }) {
  switch (tab) {
    case 'dash':
      return <DashboardTab />;
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
