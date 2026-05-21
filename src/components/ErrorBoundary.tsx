// S-ER-012: top-level React error boundary.
//
// Catches render-phase errors so a single bad component (a plugin's
// custom view, a parser misbehaving) doesn't take down the whole app.
// The boundary records the failure to the local crash log and renders
// a small recovery surface that lets the user reset just the failed
// subtree without restarting the app.
//
// Effect-phase and async errors don't reach here; for those we rely on
// the unhandled-rejection listener installed at boot, which routes
// through the same makeError pipeline and surfaces a toast.

import { invoke } from "@tauri-apps/api/core";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { i18n } from "../lib/i18n-init";

interface Props {
  /** Stable identifier for the boundary; helps support tickets pinpoint where the failure landed. */
  boundaryId: string;
  children: ReactNode;
  fallback?: (reset: () => void, error: Error) => ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    void invoke("error_record_crash", {
      boundaryId: this.props.boundaryId,
      message: error.message,
      /* v8 ignore next 2 -- thrown errors always carry a stack and React always supplies componentStack in production; ?? null is defensive for non-Error throws */
      stack: error.stack ?? null,
      componentStack: info.componentStack ?? null,
      ts: Date.now(),
    }).catch(() => {});
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.reset, this.state.error);
    return (
      <div role="alert" className="error-boundary">
        <h2>{i18n.t("error_boundary.headline", "Something went wrong in this view.")}</h2>
        <p>{this.state.error.message}</p>
        <button type="button" onClick={this.reset}>
          {i18n.t("error_boundary.retry", "Try again")}
        </button>
      </div>
    );
  }
}
