export type Theme = 'light' | 'dark';
const KEY = 'bistoon.theme';

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

export function currentTheme(): Theme {
  const a = document.documentElement.getAttribute('data-theme');
  return a === 'dark' ? 'dark' : 'light';
}

export function applyTheme(t: Theme): void {
  document.documentElement.setAttribute('data-theme', t);
}

/** ترجیح ذخیره‌شده؛ در نبود آن، ترجیح سیستم‌عامل */
export function initTheme(): void {
  const t = stored() ?? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(t);
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* حالت خصوصی مرورگر: فقط برای همین نشست اعمال می‌شود */
  }
  return next;
}
