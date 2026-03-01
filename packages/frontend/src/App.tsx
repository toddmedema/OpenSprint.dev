import { Routes, Route, Navigate } from "react-router-dom";
import { Home } from "./pages/Home";
import { ProjectSetup } from "./pages/ProjectSetup";
import { CreateNewProjectPage } from "./pages/CreateNewProjectPage";
import { ProjectShell } from "./pages/ProjectShell";
import { ProjectView } from "./pages/ProjectView";
import { SettingsPage } from "./pages/SettingsPage";
import { HelpPage } from "./pages/HelpPage";
import { ProjectSettingsContent } from "./pages/ProjectSettingsContent";
import { ProjectHelpContent } from "./pages/ProjectHelpContent";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/help" element={<HelpPage />} />
      <Route path="/projects/add-existing" element={<ProjectSetup />} />
      <Route path="/projects/create-new" element={<CreateNewProjectPage />} />
      <Route path="/projects/:projectId" element={<ProjectShell />}>
        <Route index element={<Navigate to="sketch" replace />} />
        <Route path="help" element={<ProjectHelpContent />} />
        <Route path="settings" element={<ProjectSettingsContent />} />
        <Route path=":phase" element={<ProjectView />} />
      </Route>
    </Routes>
  );
}
