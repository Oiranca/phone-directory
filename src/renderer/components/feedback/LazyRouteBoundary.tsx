import { Component, Suspense, lazy } from "react";
import type { ComponentType, ErrorInfo, ReactElement, ReactNode } from "react";
import { StatePanel } from "./StatePanel";
import { LoadingStatus } from "./LoadingStatus";

/**
 * Factory passed straight through to `React.lazy()`. Callers must pass the
 * factory itself (e.g. `() => import("../pages/SettingsPage")`), not an
 * already-constructed lazy element — see the boundary's doc comment below
 * for why that distinction matters for retry.
 */
type LazyComponentFactory = () => Promise<{ default: ComponentType }>;

interface LazyRouteBoundaryProps {
  factory: LazyComponentFactory;
}

interface LazyRouteBoundaryState {
  error: Error | null;
  LazyComponent: ComponentType;
}

/**
 * A rejected `React.lazy()` dynamic import throws
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
 * routes. It catches chunk-load failures before the top-level
 * `ErrorBoundary`; nested React error boundaries are safe.
 *
 * Retry handling: `React.lazy(factory)` memoizes the promise
 * returned by `factory` per call: once that promise has rejected, every
 * subsequent render of the *same* lazy component reference just re-throws
 * the same cached rejection, it never re-invokes `factory`. A naive retry
 * that only cleared the error state and re-rendered the same lazy component
 * therefore did nothing useful — the user landed right back here.
 *
 * To make retry actually re-attempt the dynamic import, this boundary owns
 * the current lazy component in its own state (`LazyComponent`) instead of
 * receiving an already-built lazy element as a prop. Retrying calls
 * `React.lazy(this.props.factory)` again — a brand new call, so a fresh
 * promise and a fresh invocation of `factory` (and therefore a fresh
 * `import()`) — and swaps that new lazy component into state alongside
 * clearing the error, so the next render attempts the import from scratch.
 */
class LazyRouteErrorBoundary extends Component<LazyRouteBoundaryProps, LazyRouteBoundaryState> {
  constructor(props: LazyRouteBoundaryProps) {
    super(props);
    this.state = { error: null, LazyComponent: lazy(props.factory) };
  }

  static getDerivedStateFromError(error: Error): Pick<LazyRouteBoundaryState, "error"> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[LazyRouteErrorBoundary] Failed to load a route chunk:", error, errorInfo);
  }

  private handleRetry = (): void => {
    this.setState({ error: null, LazyComponent: lazy(this.props.factory) });
  };

  render(): ReactNode {
    const { error, LazyComponent } = this.state;

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

    return (
      <Suspense fallback={<LoadingStatus message="Cargando…" />}>
        <LazyComponent />
      </Suspense>
    );
  }
}

/**
 * Wraps a route's dynamic-import factory with both a pending-state fallback
 * (`Suspense`) and a rejection fallback (`LazyRouteErrorBoundary`) that can
 * genuinely retry the import. Takes the factory itself (not a pre-built
 * `React.lazy()` element) so the boundary can re-invoke `React.lazy()` on
 * retry — see the class doc comment above.
 */
export const withLazyRouteBoundary = (factory: LazyComponentFactory): ReactElement => (
  <LazyRouteErrorBoundary factory={factory} />
);
