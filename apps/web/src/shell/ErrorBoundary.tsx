import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Alert } from '../ui/controls.tsx';

interface State {
  error: Error | null;
}

/** خطای نمایشی یک تب نباید کل برنامه را سفید کند. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  override state: State = { error: null };
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('خطای نمایش', error, info.componentStack);
  }
  override componentDidUpdate(prev: { resetKey?: string }): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <Alert kind="bad">
        <strong>این بخش به‌دلیل خطا نمایش داده نشد.</strong>
        <div className="small">{this.state.error.message}</div>
        <div className="small">داده‌ی شما تغییری نکرده است. صفحه را تازه کنید یا بخش دیگری را باز کنید.</div>
      </Alert>
    );
  }
}
