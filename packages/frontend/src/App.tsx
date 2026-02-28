import { Routes, Route } from "react-router-dom";
import { Home } from "./pages/Home";
import { ProjectSetup } from "./pages/ProjectSetup";
import { CreateNewProjectPage } from "./pages/CreateNewProjectPage";
import { ProjectView } from "./pages/ProjectView";
import { SettingsPage } from "./pages/SettingsPage";
import { HelpPage } from "./pages/HelpPage";
import { ProjectSettingsPage } from "./pages/ProjectSettingsPage";
import { ProjectHelpPage } from "./pages/ProjectHelpPage";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/help" element={<HelpPage />} />
      <Route path="/projects/add-existing" element={<ProjectSetup />} />
      <Route path="/projects/create-new" element={<CreateNewProjectPage />} />
      <Route path="/projects/:projectId/settings" element={<ProjectSettingsPage />} />
      <Route path="/projects/:projectId/help" element={<ProjectHelpPage />} />
      <Route path="/projects/:projectId/:phase?" element={<ProjectView />} />
    </Routes>
  );
}
