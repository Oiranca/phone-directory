import { Outlet } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";

export const App = () => (
  <AppShell>
    <Outlet />
  </AppShell>
);
