import { Component, Suspense } from "react";
import type { ErrorInfo, ReactElement, ReactNode } from "react";
import { StatePanel } from "./StatePanel";
import { LoadingStatus } from "./LoadingStatus";

interface LazyRouteBoundaryProps {
  children: ReactNode;
}

interface LazyRouteBoundaryState {
  error: Error | null;
}

/**
 * OIR-214 review follow-up — a rejected `React.lazy()` dynamic import throws
 * synchronously during render (React re-throws the promise rejection), and
 * `Suspense` only handles the *pending* state, not a rejection — an
 * uncaught error there unmounts the whole app to a blank white screen.
 *
 * This app is distributed as a local USB install with manual updates, so a
 * missing/corrupt chunk file (stale cached `index.html` referencing a chunk
 * hash from a prior build, or an incomplete copy to the USB drive) is a
 * real, not hypothetical, failure mode for the lazy-loaded routes below.
 *
 * This is a small, self-contained class error boundary scoped to the lazy
 * routes so this PR doesn't depend on the top-level `ErrorBoundary` being
 * added in a separate, not-yet-merged PR (OIR-205). If/when that top-level
 * boundary lands, this one simply catches the error first — no conflict,
 * since React error boundaries can be nested.
 */
class LazyRouteErrorBoundary extends Component<LazyRouteBoundaryProps, LazyRouteBoundaryState> {
  state: LazyRouteBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): LazyRouteBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[LazyRouteErrorBoundary] Failed to load a route chunk:", error, errorInfo);
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
          title="No se pudo cargar esta sección"
          message="Ha ocurrido un error al cargar esta parte de la aplicación. Esto puede deberse a una actualización incompleta. Intenta de nuevo o reinicia la aplicación."
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

/**
 * Wraps a lazily-loaded route element with both a pending-state fallback
 * (`Suspense`) and a rejection fallback (`LazyRouteErrorBoundary`).
 */
export const withLazyRouteBoundary = (element: ReactElement): ReactElement => (
  <LazyRouteErrorBoundary>
    <Suspense fallback={<LoadingStatus message="Cargando…" />}>{element}</Suspense>
  </LazyRouteErrorBoundary>
);
