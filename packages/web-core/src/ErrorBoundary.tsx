import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** What follows "Try reloading, or": a link back to the app's start. */
  wayBack: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
}

/** One page failing to render shows a way back, not a blank app. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("A page failed to render", error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="panel" role="alert">
        <h1>Something went wrong showing this page</h1>
        <p>Try reloading, or {this.props.wayBack}.</p>
      </div>
    );
  }
}
