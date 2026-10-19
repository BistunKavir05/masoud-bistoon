import { useEffect } from 'react';
import { bootSession, sessionStore } from './state/session.ts';
import { useStore } from './state/store.ts';
import { Loading } from './ui/controls.tsx';
import { DialogHost } from './ui/dialogs.tsx';
import { ForcePasswordChange, Login } from './shell/Login.tsx';
import { Shell } from './shell/Shell.tsx';

export function App() {
  const status = useStore(sessionStore, (s) => s.status);
  const user = useStore(sessionStore, (s) => s.user);
  useEffect(() => {
    void bootSession();
  }, []);
  return (
    <>
      {status === 'loading' ? <Loading text="در حال بررسی نشست…" /> : status === 'anon' || !user ? <Login /> : user.mustChangePassword ? <ForcePasswordChange username={user.username} /> : <Shell />}
      <DialogHost />
    </>
  );
}
