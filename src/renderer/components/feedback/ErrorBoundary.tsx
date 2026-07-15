import { Component } from "react";
import type { ErrorInfo, PropsWithChildren, ReactNode } from "react";
import { StatePanel } from "./StatePanel";

interface ErrorBoundaryProps extends PropsWithChildren {
  /**
   * Optional override for the fallback panel title. Defaults to a generic
   * Spanish "something went wrong" message consistent with the rest of the
   * app's error/recovery UI language.
   */
  title?: string;
  /**
   * Optional override for the fallback panel message.
   */
  message?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * OIR-205: top-level render-error boundary.
 *
 * Without this, an uncaught render exception anywhere in the wrapped subtree
 * unmounts the entire React app, leaving the user with a blank white screen
 * and no recovery path (see docs/AUDITORIA_INTEGRAL.md §2.2, QA-1).
 *
 * This mirrors the visual/structural convention already used by App.tsx's
 * `bootstrapError` panel: a `StatePanel` with role="alert" and a single
 * "Reintentar" action. Retrying resets the boundary's internal error state,
 * which re-mounts the wrapped subtree and gives transient errors a chance to
 * recover without requiring a full app restart.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[ErrorBoundary] Uncaught render error:", error, errorInfo);
  }

  private handleRetry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;

    if (error) {
      return (
        <StatePanel
          role="alert"
          title={this.props.title ?? "Algo salió mal"}
          message={
            this.props.message ??
            "Se ha producido un error inesperado en la aplicación. Puedes intentar continuar o reintentar la operación."
          }
          action={
            <button
              type="button"
              onClick={this.handleRetry}
              className="focus-ring rounded-full bg-scs-blue px-5 py-3 text-sm font-semibold text-white transition hover:bg-scs-blueDark"
            >
              Reintentar
            </button>
          }
        />
      );
    }

    return this.props.children;
  }
}
