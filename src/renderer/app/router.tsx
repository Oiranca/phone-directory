import { lazy } from "react";
import { Navigate, createHashRouter } from "react-router-dom";
import { App } from "./App";
import { BuscasPage } from "../pages/BuscasPage";
import { RecordFormPage } from "../pages/RecordFormPage";
import { DirectoryPage } from "../pages/DirectoryPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { withLazyRouteBoundary } from "../components/feedback/LazyRouteBoundary";

// OIR-214 / ARQ-10 — code-splitting: previously every route (including
// SettingsPage, which pulls in the ~1000-line CsvImportPreviewPanel, and
// DeduplicatePage, which pulls in MergeLossPreview) was a static import, so
// all 7 pages shipped in the single initial bundle chunk regardless of
// whether the operator ever visits them. These two are the highest-leverage
// routes to split off since neither is the landing page and both pull in
// sizeable, only-conditionally-used UI. DirectoryPage stays a static/eager
// import since it's the index route and the first thing users see.
const SettingsPage = lazy(() => import("../pages/SettingsPage").then((mod) => ({ default: mod.SettingsPage })));
const DeduplicatePage = lazy(() =>
  import("../pages/DeduplicatePage").then((mod) => ({ default: mod.DeduplicatePage }))
);

// PR review follow-up — `withSuspense` originally only handled the pending
// state. `withLazyRouteBoundary` additionally catches a rejected dynamic
// import (missing/corrupt chunk file) and shows recoverable UI instead of
// crashing to a blank screen. See LazyRouteBoundary.tsx for details.
const withSuspense = withLazyRouteBoundary;

export const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    children: [
      {
        index: true,
        element: <DirectoryPage />
      },
      {
        path: "contacts/new",
        element: <RecordFormPage />
      },
      {
        path: "contacts/:id/edit",
        element: <RecordFormPage />
      },
      {
        // OIR-219: Importar/Exportar was folded into Configuración as a
        // section. Keep a redirect so old bookmarks/deep links still resolve.
        path: "import-export",
        element: <Navigate to="/settings" replace />
      },
      {
        path: "settings",
        element: withSuspense(<SettingsPage />)
      },
      {
        path: "buscas",
        element: <BuscasPage />
      },
      {
        path: "deduplicate",
        element: withSuspense(<DeduplicatePage />)
      },
      {
        path: "*",
        element: <NotFoundPage />
      }
    ]
  }
]);
