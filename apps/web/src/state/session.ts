import type { ProjectListItem } from '@bistoon/core';
import { apiGet, apiPost, setCsrfToken, setSessionExpiredHandler } from '../api/client.ts';
import { createStore } from './store.ts';

export interface SessionUser {
  id: number;
  username: string;
  displayName: string;
  isSystemAdmin: boolean;
  mustChangePassword: boolean;
}

export interface SessionState {
  status: 'loading' | 'anon' | 'authed';
  user: SessionUser | null;
  projects: ProjectListItem[];
  /** پیام «نشست تمام شد» برای نمایش در صفحه‌ی ورود */
  notice: string | null;
}

interface SessionResponse {
  user: SessionUser;
  csrfToken: string;
  projects: ProjectListItem[];
}

export const sessionStore = createStore<SessionState>({ status: 'loading', user: null, projects: [], notice: null });

function applySession(r: SessionResponse): void {
  setCsrfToken(r.csrfToken);
  sessionStore.set({ status: 'authed', user: r.user, projects: r.projects, notice: null });
}

function clearSession(notice: string | null): void {
  setCsrfToken(null);
  sessionStore.set({ status: 'anon', user: null, projects: [], notice });
}

setSessionExpiredHandler(() => {
  if (sessionStore.get().status === 'authed') clearSession('نشست شما به پایان رسیده است؛ دوباره وارد شوید.');
});

/** در شروع برنامه: اگر کوکی نشست معتبر باشد وارد می‌شود. */
export async function bootSession(): Promise<void> {
  try {
    applySession(await apiGet<SessionResponse>('/auth/me'));
  } catch {
    clearSession(null);
  }
}

export async function login(username: string, password: string): Promise<void> {
  applySession(await apiPost<SessionResponse>('/auth/login', { username, password }));
}

export async function logout(): Promise<void> {
  try {
    await apiPost('/auth/logout');
  } finally {
    clearSession(null);
  }
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiPost('/auth/change-password', { currentPassword, newPassword });
  await bootSession();
}

export async function refreshProjects(): Promise<void> {
  const r = await apiGet<{ projects: ProjectListItem[] }>('/projects');
  sessionStore.set((s) => ({ ...s, projects: r.projects }));
}
