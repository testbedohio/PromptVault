import { useState } from "react";

interface SyncPanelProps {
  isConnected: boolean;
  lastSync: string | null;
  syncStatus: string;
  onSetCredentials: (clientId: string, clientSecret: string) => void;
  onStartAuth: () => void;
  onSyncNow: () => void;
  onDisconnect: () => void;
  onClose: () => void;
}

export default function SyncPanel({
  isConnected,
  lastSync,
  syncStatus,
  onSetCredentials,
  onStartAuth,
  onSyncNow,
  onDisconnect,
  onClose,
}: SyncPanelProps) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showSecrets, setShowSecrets] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50" />

      <div
        className="relative w-full max-w-md bg-darcula-bg-light border border-darcula-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-darcula-border flex items-center justify-between">
          <div>
            <h2 className="text-sm font-mono font-semibold text-darcula-text-bright">
              ☁️ Google Drive Sync
            </h2>
            <p className="text-2xs font-mono text-darcula-text-muted mt-0.5">
              Automatically back up your prompts to Google Drive
            </p>
          </div>
          <button
            className="text-darcula-text-muted hover:text-darcula-text text-sm"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {/* Status */}
        <div className="px-4 py-3 border-b border-darcula-border">
          <div className="flex items-center gap-2 mb-2">
            <span
              className={`w-2 h-2 rounded-full ${
                isConnected ? "bg-darcula-success" : "bg-darcula-text-muted"
              }`}
            />
            <span className="text-xs font-mono text-darcula-text">
              {isConnected ? "Connected" : "Disconnected"}
            </span>
            <span className="text-2xs font-mono text-darcula-text-muted ml-auto">
              {syncStatus}
            </span>
          </div>
          {lastSync && (
            <div className="text-2xs font-mono text-darcula-text-muted">
              Last synced: {new Date(lastSync).toLocaleString()}
            </div>
          )}
        </div>

        {isConnected ? (
          /* Connected State — Sync Controls */
          <div className="px-4 py-3 space-y-3">
            <button
              className="w-full text-xs font-mono px-3 py-2 rounded-sm bg-darcula-accent text-white hover:bg-darcula-accent-bright transition-colors"
              onClick={onSyncNow}
            >
              Sync Now
            </button>

            <div className="text-2xs font-mono text-darcula-text-muted">
              Your prompt database is synced to Google Drive's hidden app
              data folder. Only PromptVault can access this data — it
              won't appear in your regular Drive files.
            </div>

            <button
              className="text-2xs font-mono text-darcula-error hover:underline"
              onClick={onDisconnect}
            >
              Disconnect Google Drive
            </button>
          </div>
        ) : (
          /* Disconnected State — Setup */
          <div className="px-4 py-3 space-y-3">
            <div className="text-2xs font-mono text-darcula-text-muted mb-2">
              To enable sync, you'll need a Google Cloud OAuth 2.0 Client
              ID. Create one at{" "}
              <span className="text-darcula-accent-bright">
                console.cloud.google.com
              </span>{" "}
              with the Drive API scope.
            </div>

            <div>
              <label className="text-2xs font-mono text-darcula-text-muted uppercase tracking-wider block mb-1">
                Client ID
              </label>
              <input
                type={showSecrets ? "text" : "password"}
                placeholder="xxx.apps.googleusercontent.com"
                className="w-full bg-darcula-bg text-darcula-text text-xs font-mono px-3 py-2 rounded-sm border border-darcula-border outline-none focus:border-darcula-accent"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              />
            </div>

            <div>
              <label className="text-2xs font-mono text-darcula-text-muted uppercase tracking-wider block mb-1">
                Client Secret
              </label>
              <div className="flex gap-2">
                <input
                  type={showSecrets ? "text" : "password"}
                  placeholder="GOCSPX-..."
                  className="flex-1 bg-darcula-bg text-darcula-text text-xs font-mono px-3 py-2 rounded-sm border border-darcula-border outline-none focus:border-darcula-accent"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                />
                <button
                  className="text-2xs font-mono text-darcula-text-muted hover:text-darcula-text px-2"
                  onClick={() => setShowSecrets(!showSecrets)}
                >
                  {showSecrets ? "hide" : "show"}
                </button>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                className="flex-1 text-xs font-mono px-3 py-2 rounded-sm bg-darcula-bg text-darcula-text-muted hover:text-darcula-text transition-colors border border-darcula-border"
                onClick={() => {
                  if (clientId.trim() && clientSecret.trim()) {
                    onSetCredentials(clientId.trim(), clientSecret.trim());
                  }
                }}
                disabled={!clientId.trim() || !clientSecret.trim()}
              >
                Save Credentials
              </button>
              <button
                className="flex-1 text-xs font-mono px-3 py-2 rounded-sm bg-darcula-accent text-white hover:bg-darcula-accent-bright transition-colors disabled:opacity-50"
                onClick={onStartAuth}
                disabled={!clientId.trim() || !clientSecret.trim()}
              >
                Sign in with Google
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}