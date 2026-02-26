import { Routes, Route } from "react-router-dom";
import { Home } from "./pages/Home";
import { ProjectSetup } from "./pages/ProjectSetup";
import { CreateNewProjectPage } from "./pages/CreateNewProjectPage";
import { ProjectView } from "./pages/ProjectView";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/projects/add-existing" element={<ProjectSetup />} />
      <Route path="/projects/create-new" element={<CreateNewProjectPage />} />
      <Route path="/projects/:projectId/:phase?" element={<ProjectView />} />
    </Routes>
  );
}
