import type { TabKey } from '../state/route.ts';
import { PageHead, Alert } from '../ui/controls.tsx';
import { CalendarTab } from './calendar/CalendarTab.tsx';
import { CharterTab } from './charter/CharterTab.tsx';
import { ChatTab } from './chat/ChatTab.tsx';
import { DocsTab } from './docs/DocsTab.tsx';
import { LogTab } from './log/LogTab.tsx';
import { DashboardTab } from './dashboard/DashboardTab.tsx';
import { FinanceTab } from './finance/FinanceTab.tsx';
import { GanttTab } from './gantt/GanttTab.tsx';
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
    case 'cal':
      return <CalendarTab />;
    case 'docs':
      return <DocsTab />;
    case 'chat':
      return <ChatTab />;
    case 'log':
      return <LogTab />;
    case 'gantt':
      return <GanttTab />;
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
