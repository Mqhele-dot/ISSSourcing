import React from 'react';
import { Link } from 'react-router-dom';
import { ApiErrorEntry, getApiErrors } from './state/apiErrors';

type Props = { children: JSX.Element };
type State = { error: Error | null; showDebug: boolean; apiErrors: ApiErrorEntry[] };

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, showDebug: false, apiErrors: getApiErrors() };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch() {
    this.setState({ apiErrors: getApiErrors() });
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <section style={{ border: '2px solid #b91c1c', padding: 12, margin: 12, background: '#fee2e2' }}>
        <h2>UI render error</h2>
        <p>{this.state.error.message}</p>
        {import.meta.env.DEV ? <pre style={{ whiteSpace: 'pre-wrap' }}>{this.state.error.stack}</pre> : null}
        <p><Link to="/login">Go to login</Link></p>
        <button onClick={() => this.setState((prev) => ({ showDebug: !prev.showDebug }))}>
          {this.state.showDebug ? 'Hide Debug Panel' : 'Show Debug Panel'}
        </button>
        {this.state.showDebug ? (
          <div>
            <h4>Recent API errors</h4>
            {this.state.apiErrors.length === 0 ? <p>No API errors recorded.</p> : null}
            {this.state.apiErrors.map((entry, idx) => (
              <div key={idx}><small>{entry.time} | {entry.route} | {entry.status ?? 'network'} | {entry.message}</small></div>
            ))}
          </div>
        ) : null}
      </section>
    );
  }
}
