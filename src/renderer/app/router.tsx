import { createHashRouter } from "react-router-dom";
import { App } from "./App";
import { ContactFormPage } from "../pages/ContactFormPage";
import { DeduplicatePage } from "../pages/DeduplicatePage";
import { DirectoryPage } from "../pages/DirectoryPage";
import { ImportExportPage } from "../pages/ImportExportPage";
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
        element: <ContactFormPage />
      },
      {
        path: "contacts/:id/edit",
        element: <ContactFormPage />
      },
      {
        path: "import-export",
        element: <ImportExportPage />
      },
      {
        path: "settings",
        element: <SettingsPage />
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
