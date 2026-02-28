import { useParams } from "react-router-dom";
import { HelpPage } from "./HelpPage";

/**
 * Full-screen Help page for project view. Wraps HelpPage with project context from route.
 */
export function ProjectHelpPage() {
  return <HelpPage />;
}
