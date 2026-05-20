"use client";
import { Component, type ReactNode } from "react";
import { RaError } from "./ra-error";

interface State {
  error: Error | null;
}

export class RaErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    // hook PostHog/Sentry here in prod
    console.error("[rent-agreement] uncaught", error);
  }

  render() {
    if (this.state.error) {
      const code = this.state.error instanceof RaError ? this.state.error.code : "UNKNOWN";
      return (
        <div role="alert" className="p-4 border border-red-300 bg-red-50 rounded">
          <h2 className="font-semibold">Something went wrong</h2>
          <p className="text-sm text-red-700">{code}</p>
          <button onClick={() => this.setState({ error: null })} className="mt-2 underline text-sm">
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
