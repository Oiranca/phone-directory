import { Navigate, createHashRouter } from "react-router-dom";
import { App } from "./App";
import { BuscasPage } from "../pages/BuscasPage";
import { RecordFormPage } from "../pages/RecordFormPage";
import { DeduplicatePage } from "../pages/DeduplicatePage";
import { DirectoryPage } from "../pages/DirectoryPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { SettingsPage } from "../pages/SettingsPage";

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
        element: <SettingsPage />
      },
      {
        path: "buscas",
        element: <BuscasPage />
      },
      {
        path: "deduplicate",
        element: <DeduplicatePage />
      },
      {
        path: "*",
        element: <NotFoundPage />
      }
    ]
  }
]);
