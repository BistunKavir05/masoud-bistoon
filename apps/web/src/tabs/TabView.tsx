import type { TabKey } from '../state/route.ts';
import { PageHead, Alert } from '../ui/controls.tsx';

/** نگاشت کلید تب به صفحه‌ی آن */
export function TabView({ tab }: { tab: TabKey }) {
  return (
    <>
      <PageHead title={tab} />
      <Alert kind="info">در حال ساخت…</Alert>
    </>
  );
}
