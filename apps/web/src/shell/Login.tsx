import { useState } from 'react';
import { errorMessage } from '../api/client.ts';
import { sessionStore, changePassword, login } from '../state/session.ts';
import { useStore } from '../state/store.ts';
import { Alert, Btn, TextField } from '../ui/controls.tsx';
import { BrandGlyph } from '../ui/icons.tsx';

export function Login() {
  const notice = useStore(sessionStore, (s) => s.notice);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-wrap">
      <form className="login-card stack" onSubmit={(e) => void submit(e)} aria-labelledby="login-title">
        <span className="brand-mark">
          <BrandGlyph />
          بیستون
        </span>
        <h1 id="login-title">ورود به سامانه</h1>
        {notice ? <Alert kind="warn">{notice}</Alert> : null}
        {error ? <Alert kind="bad">{error}</Alert> : null}
        <TextField label="نام کاربری" value={username} onChange={setUsername} ltr autoComplete="username" autoFocus testId="login-user" />
        <TextField label="گذرواژه" type="password" value={password} onChange={setPassword} ltr autoComplete="current-password" testId="login-pass" />
        <Btn type="submit" kind="primary" busy={busy} disabled={!username.trim() || !password} testId="login-submit">
          ورود
        </Btn>
        <p className="muted small">دسترسی‌ها بر اساس نقش شما در هر پروژه تعیین می‌شود. اگر گذرواژه‌ را فراموش کرده‌اید، با ادمین سیستم تماس بگیرید.</p>
      </form>
    </div>
  );
}

export function ForcePasswordChange({ username }: { username: string }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mismatch = again !== '' && next !== again ? 'تکرار گذرواژه با گذرواژه‌ی جدید یکی نیست.' : null;
  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (next !== again) return;
    setBusy(true);
    setError(null);
    try {
      await changePassword(cur, next);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-wrap">
      <form className="login-card stack" onSubmit={(e) => void submit(e)} aria-labelledby="pw-title">
        <span className="brand-mark">
          <BrandGlyph />
          بیستون
        </span>
        <h1 id="pw-title">تغییر گذرواژه</h1>
        <Alert kind="info">برای ادامه باید گذرواژه‌ی موقت را عوض کنید. گذرواژه‌ی جدید دست‌کم ۱۰ نویسه باشد و شامل نام کاربری ({username}) نباشد.</Alert>
        {error ? <Alert kind="bad">{error}</Alert> : null}
        <TextField label="گذرواژه‌ی فعلی" type="password" value={cur} onChange={setCur} ltr autoComplete="current-password" autoFocus testId="pw-cur" />
        <TextField label="گذرواژه‌ی جدید" type="password" value={next} onChange={setNext} ltr autoComplete="new-password" testId="pw-new" />
        <TextField label="تکرار گذرواژه‌ی جدید" type="password" value={again} onChange={setAgain} ltr autoComplete="new-password" error={mismatch} testId="pw-again" />
        <Btn type="submit" kind="primary" busy={busy} disabled={!cur || next.length < 10 || next !== again} testId="pw-submit">
          ذخیره و ادامه
        </Btn>
      </form>
    </div>
  );
}
