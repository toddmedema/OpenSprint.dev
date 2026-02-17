import type { DeploymentMode } from "@opensprint/shared";

export interface DeploymentStepProps {
  mode: DeploymentMode;
  customCommand: string;
  customWebhook: string;
  onModeChange: (mode: DeploymentMode) => void;
  onCustomCommandChange: (value: string) => void;
  onCustomWebhookChange: (value: string) => void;
}

export function DeploymentStep({
  mode,
  customCommand,
  customWebhook,
  onModeChange,
  onCustomCommandChange,
  onCustomWebhookChange,
}: DeploymentStepProps) {
  return (
    <div className="space-y-4" data-testid="deployment-step">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">Deployment Mode</label>
        <div className="space-y-3">
          <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 hover:border-brand-300 cursor-pointer transition-colors">
            <input
              type="radio"
              name="deployment"
              value="expo"
              checked={mode === "expo"}
              onChange={() => onModeChange("expo")}
              className="mt-0.5"
            />
            <div>
              <p className="text-sm font-medium text-gray-900">Expo.dev</p>
              <p className="text-xs text-gray-500">Automatic deployment for React Native and web projects</p>
            </div>
          </label>
          <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 hover:border-brand-300 cursor-pointer transition-colors">
            <input
              type="radio"
              name="deployment"
              value="custom"
              checked={mode === "custom"}
              onChange={() => onModeChange("custom")}
              className="mt-0.5"
            />
            <div>
              <p className="text-sm font-medium text-gray-900">Custom Pipeline</p>
              <p className="text-xs text-gray-500">Command or webhook triggered after Build completion</p>
            </div>
          </label>
        </div>
      </div>
      {mode === "custom" && (
        <div className="space-y-3 pt-2 border-t border-gray-200">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Deployment command</label>
            <input
              type="text"
              className="input w-full font-mono text-sm"
              placeholder="e.g. ./deploy.sh or vercel deploy --prod"
              value={customCommand}
              onChange={(e) => onCustomCommandChange(e.target.value)}
            />
            <p className="mt-1 text-xs text-gray-500">
              Shell command run from project root after each task completion
            </p>
          </div>
          <div className="text-sm text-gray-500 text-center">— or —</div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Webhook URL</label>
            <input
              type="url"
              className="input w-full font-mono text-sm"
              placeholder="https://api.example.com/deploy"
              value={customWebhook}
              onChange={(e) => onCustomWebhookChange(e.target.value)}
            />
            <p className="mt-1 text-xs text-gray-500">
              HTTP POST sent after each task completion (GitHub Actions, Vercel, etc.)
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
