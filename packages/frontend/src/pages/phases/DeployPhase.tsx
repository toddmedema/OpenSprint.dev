/** Deploy phase placeholder — full UI in Task 5 (60k.6) */
interface DeployPhaseProps {
  projectId: string;
}

export function DeployPhase({ projectId }: DeployPhaseProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-4 bg-gray-50">
      <h2 className="text-xl font-semibold text-gray-900">Deploy</h2>
      <p className="mt-2 text-gray-500 text-sm">
        Deploy phase UI coming in Task 5. Project: {projectId}
      </p>
    </div>
  );
}
