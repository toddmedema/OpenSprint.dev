import { Layout } from "../components/layout/Layout";
import { GlobalSettingsContent } from "../components/GlobalSettingsContent";

/**
 * Full-screen Settings page (homepage). Replaces the DisplaySettingsModal.
 */
export function SettingsPage() {
  return (
    <Layout>
      <div className="flex-1 min-h-0 overflow-y-auto" data-testid="settings-page">
        <div className="max-w-2xl mx-auto px-6 py-8">
          <h1 className="text-2xl font-semibold text-theme-text mb-6">Settings</h1>
          <div className="bg-theme-surface rounded-xl border border-theme-border p-6">
            <GlobalSettingsContent />
          </div>
        </div>
      </div>
    </Layout>
  );
}
