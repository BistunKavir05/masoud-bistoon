import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App.tsx';
import { initTheme } from './lib/theme.ts';

initTheme();
const root = document.getElementById('root');
if (!root) throw new Error('عنصر root پیدا نشد.');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
