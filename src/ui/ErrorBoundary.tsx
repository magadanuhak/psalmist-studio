import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '../i18n/ro';

interface State { error: Error | null }

/** Last line of defence: a crash shows a friendly message instead of a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('[psalmist] UI crash', error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h1>{t.crash.title}</h1>
        <p>{t.crash.body}</p>
        <div className="big-actions">
          <button className="btn btn-primary" onClick={() => location.reload()}>{t.crash.reload}</button>
          <a className="btn btn-ghost" href="#/" onClick={() => { this.setState({ error: null }); }}>{t.crash.home}</a>
        </div>
        <p className="hint crash-detail">{this.state.error.message}</p>
      </div>
    );
  }
}
