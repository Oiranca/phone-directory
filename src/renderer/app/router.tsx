import { createBrowserRouter } from "react-router-dom";
import { App } from "./App";
import { ContactFormPage } from "../pages/ContactFormPage";
import { DirectoryPage } from "../pages/DirectoryPage";
import { ImportExportPage } from "../pages/ImportExportPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { SettingsPage } from "../pages/SettingsPage";

export const router = createBrowserRouter([
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
        path: "*",
        element: <NotFoundPage />
      }
    ]
  }
]);
