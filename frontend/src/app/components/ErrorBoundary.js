'use client';

import { Component } from 'react';
import BoundaryError from './BoundaryError';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback({
          error: this.state.error,
          errorInfo: this.state.errorInfo,
          retry: this.handleRetry,
        });
      }

      /* `inline` because this boundary wraps a SECTION, not a route. The
         full-height, radially-lit treatment belongs to a page that has failed
         outright; using it here would blow a broken card up into a
         viewport-filling apology. */
      return (
        <BoundaryError
          inline
          title="Something went wrong"
          /* Never interpolate error.message — a caught render exception is a
             technical/developer detail, not a crafted user-facing string, and
             could leak internals to the guest/organizer. */
          message="This section could not be displayed. The rest of the page is unaffected."
          details={process.env.NODE_ENV !== 'production' && this.state.errorInfo ? (
            <details className="fx-errstate-devdetails">
              <summary>Error details (dev only)</summary>
              <pre>
                {this.state.error?.message}
                {'\n'}
                {this.state.errorInfo.componentStack}
              </pre>
              {/* Global, not scoped: styled-jsx cannot reach markup rendered by
                  another function, and this block is handed to ErrorState as a
                  prop. Kept here beside the markup it styles. */}
              <style jsx global>{`
                .fx-errstate-devdetails {
                  text-align: left;
                  margin-top: 20px;
                  background: #F8F4EC;
                  border: 1px solid #E8E2D6;
                  border-radius: 10px;
                  padding: 12px 14px;
                }
                .fx-errstate-devdetails > summary {
                  cursor: pointer;
                  font-size: 12.5px;
                  font-weight: 600;
                  color: #191B1E;
                }
                .fx-errstate-devdetails > pre {
                  font-size: 11.5px;
                  line-height: 1.5;
                  color: #77736A;
                  white-space: pre-wrap;
                  word-break: break-word;
                  margin: 10px 0 0;
                  max-height: 200px;
                  overflow: auto;
                }
                @media (prefers-color-scheme: dark) {
                  .fx-errstate-devdetails { background: #17181A; border-color: #3D3A33; }
                  .fx-errstate-devdetails > summary { color: #F8F4EC; }
                  .fx-errstate-devdetails > pre { color: #A8A397; }
                }
              `}</style>
            </details>
          ) : null}
          actions={(
            <button type="button" onClick={this.handleRetry} className="fx-errstate-btn fx-errstate-btn--primary">
              Retry
            </button>
          )}
        />
      );
    }

    return this.props.children;
  }
}
