import { Link } from "react-router-dom";
import { Layout } from "../components/layout/Layout";
import { DisplaySettingsContent } from "../components/DisplaySettingsContent";

/**
 * Full-screen Settings page (homepage). Replaces the DisplaySettingsModal.
 */
export function SettingsPage() {
  return (
    <Layout>
      <div className="flex-1 min-h-0 overflow-y-auto" data-testid="settings-page">
        <div className="max-w-2xl mx-auto px-6 py-8">
          <div className="flex items-center gap-4 mb-6">
            <Link
              to="/"
              className="p-2 rounded-md text-theme-muted hover:text-theme-text hover:bg-theme-border-subtle transition-colors"
              aria-label="Back to home"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </Link>
            <h1 className="text-2xl font-semibold text-theme-text">Settings</h1>
          </div>
          <div className="bg-theme-surface rounded-xl border border-theme-border p-6">
            <DisplaySettingsContent />
          </div>
        </div>
      </div>
    </Layout>
  );
}
