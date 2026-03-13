import { useState, useEffect, useRef, useCallback } from "react";
import {
  startOAuthFlow,
  getSyncConfig,
  syncToDrive,
  updateSyncConfig,
  setAutoSync,
  isSyncConnected,
  isSyncError,
  getSyncStatusLabel,
  type SyncConfig,
} from "../api/commands";

// Open a URL in the system browser.
// Uses the Tauri shell plugin when available, falls back to window.open.
async function openUrl(url: string) {
  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

interface SyncPanelProps {
  onClose: () => void;
}

type AuthPhase =
  | "idle"       // haven't started
  | "waiting"    // browser open, polling for callback
  | "connected"  // successfully authenticated
  | "syncing"    // upload in progress
  | "error";     // something went wrong

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS  = 200_000; // slightly longer than the Rust 3-min window

const INTERVAL_OPTIONS: { label: string; value: number }[] = [
  { label: "Every 5 minutes",  value: 5  },
  { label: "Every 15 minutes", value: 15 },
  { label: "Every 30 minutes", value: 30 },
  { label: "Every hour",       value: 60 },
];

export default function SyncPanel({ onClose }: SyncPanelProps) {
  const [clientId, setClientId]         = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showSecrets, setShowSecrets]   = useState(false);
  const [phase, setPhase]               = useState<AuthPhase>("idle");
  const [config, setConfig]             = useState<SyncConfig | null>(null);
  const [errorMsg, setErrorMsg]         = useState<string | null>(null);
  const [syncing, setSyncing]           = useState(false);
  const [savingAutoSync, setSavingAutoSync] = useState(false);

  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load current config on mount ────────────────────────────────

  useEffect(() => {
    getSyncConfig()
      .then((cfg) => {
        setConfig(cfg);
        if (isSyncConnected(cfg)) setPhase("connected");
        if (cfg.client_id) setClientId(cfg.client_id);
        if (cfg.client_secret) setClientSecret(cfg.client_secret);
      })
      .catch(() => {
        // Browser mode — Tauri not available
      });
  }, []);

  // ── Polling ─────────────────────────────────────────────────────

  const stopPolling = useCallback(() => {
    if (pollRef.current)    clearInterval(pollRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    pollRef.current    = null;
    timeoutRef.current = null;
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();

    pollRef.current = setInterval(async () => {
      try {
        const cfg = await getSyncConfig();
        setConfig(cfg);

        if (isSyncConnected(cfg)) {
          setPhase("connected");
          stopPolling();
        } else if (isSyncError(cfg)) {
          setPhase("error");
          setErrorMsg(getSyncStatusLabel(cfg));
          stopPolling();
        }
      } catch {
        // Transient error; keep polling
      }
    }, POLL_INTERVAL_MS);

    timeoutRef.current = setTimeout(() => {
      stopPolling();
      if (phase === "waiting") {
        setPhase("error");
        setErrorMsg("Sign-in timed out. Please try again.");
      }
    }, POLL_TIMEOUT_MS);
  }, [stopPolling, phase]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // ── Actions ──────────────────────────────────────────────────────

  const handleSignIn = async () => {
    const id = clientId.trim();
    const secret = clientSecret.trim();
    if (!id || !secret) return;

    setPhase("waiting");
    setErrorMsg(null);

    try {
      const authUrl = await startOAuthFlow(id, secret);
      await openUrl(authUrl);
      startPolling();
    } catch (e) {
      setPhase("error");
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      await syncToDrive();
      const cfg = await getSyncConfig();
      setConfig(cfg);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    if (!config) return;
    const reset: SyncConfig = {
      ...config,
      enabled: false,
      access_token: null,
      refresh_token: null,
      token_expiry: null,
      remote_file_id: null,
      sync_status: "Disconnected",
      auto_sync_enabled: false,
    };
    try {
      await updateSyncConfig(reset);
      // Also stop the background worker
      await setAutoSync(false, config.auto_sync_interval_mins ?? 5);
      setConfig(reset);
      setPhase("idle");
      setErrorMsg(null);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const handleAutoSyncToggle = async () => {
    if (!config) return;
    const next = !config.auto_sync_enabled;
    setSavingAutoSync(true);
    try {
      await setAutoSync(next, config.auto_sync_interval_mins ?? 5);
      setConfig({ ...config, auto_sync_enabled: next });
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingAutoSync(false);
    }
  };

  const handleIntervalChange = async (mins: number) => {
    if (!config) return;
    setSavingAutoSync(true);
    try {
      await setAutoSync(config.auto_sync_enabled, mins);
      setConfig({ ...config, auto_sync_interval_mins: mins });
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingAutoSync(false);
    }
  };

  const isConnected = phase === "connected" ||
    (config !== null && isSyncConnected(config));

  const canSignIn = clientId.trim().length > 0 && clientSecret.trim().length > 0;

  // ── Render ───────────────────────────────────────────────────────

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
              Back up your prompt database to Google Drive
            </p>
          </div>
          <button
            className="text-darcula-text-muted hover:text-darcula-text text-sm"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {/* Status bar */}
        <div className="px-4 py-2.5 border-b border-darcula-border flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              isConnected
                ? "bg-darcula-success"
                : phase === "waiting"
                ? "bg-darcula-warning animate-pulse"
                : "bg-darcula-text-muted"
            }`}
          />
          <span className="text-xs font-mono text-darcula-text">
            {phase === "waiting"
              ? "Waiting for Google sign-in…"
              : isConnected
              ? "Connected"
              : "Disconnected"}
          </span>
          {config?.last_sync && isConnected && (
            <span className="text-2xs font-mono text-darcula-text-muted ml-auto">
              Last sync: {new Date(config.last_sync).toLocaleString()}
            </span>
          )}
        </div>

        {/* Error banner */}
        {errorMsg && (
          <div className="px-4 py-2 bg-darcula-error/10 border-b border-darcula-error/30">
            <p className="text-2xs font-mono text-darcula-error">{errorMsg}</p>
          </div>
        )}

        {/* Body */}
        <div className="px-4 py-3">
          {isConnected ? (
            /* ── Connected state ── */
            <div className="space-y-3">
              <p className="text-2xs font-mono text-darcula-text-muted">
                Your prompt database is synced to Google Drive's hidden app data
                folder. Only PromptVault can access this data — it won't appear
                in your regular Drive files.
              </p>

              {/* Manual sync button */}
              <button
                className="w-full text-xs font-mono px-3 py-2 rounded-sm bg-darcula-accent text-white hover:bg-darcula-accent-bright transition-colors disabled:opacity-50"
                onClick={handleSyncNow}
                disabled={syncing}
              >
                {syncing ? "Syncing…" : "Sync Now"}
              </button>

              {/* ── Auto-sync settings ── */}
              <div className="border border-darcula-border rounded-sm p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-darcula-text">
                    Auto-sync
                  </span>

                  {/* Toggle */}
                  <button
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:opacity-40 ${
                      config?.auto_sync_enabled
                        ? "bg-darcula-accent"
                        : "bg-darcula-border"
                    }`}
                    onClick={handleAutoSyncToggle}
                    disabled={savingAutoSync}
                    title={config?.auto_sync_enabled ? "Disable auto-sync" : "Enable auto-sync"}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                        config?.auto_sync_enabled ? "translate-x-4" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </div>

                {/* Interval selector — only shown when auto-sync is on */}
                {config?.auto_sync_enabled && (
                  <div>
                    <label className="text-2xs font-mono text-darcula-text-muted uppercase tracking-wider block mb-1">
                      Sync interval
                    </label>
                    <div className="flex gap-1.5 flex-wrap">
                      {INTERVAL_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          className={`text-2xs font-mono px-2.5 py-1 rounded-sm border transition-colors disabled:opacity-40 ${
                            config.auto_sync_interval_mins === opt.value
                              ? "border-darcula-accent bg-darcula-accent/20 text-darcula-accent-bright"
                              : "border-darcula-border text-darcula-text-muted hover:border-darcula-accent/60 hover:text-darcula-text"
                          }`}
                          onClick={() => handleIntervalChange(opt.value)}
                          disabled={savingAutoSync}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {config?.auto_sync_enabled && (
                  <p className="text-2xs font-mono text-darcula-text-muted">
                    PromptVault will silently upload your database in the background.
                    Syncs only occur when Google Drive is connected.
                  </p>
                )}
              </div>

              <button
                className="block text-2xs font-mono text-darcula-error hover:underline"
                onClick={handleDisconnect}
              >
                Disconnect Google Drive
              </button>
            </div>
          ) : phase === "waiting" ? (
            /* ── Waiting for callback ── */
            <div className="space-y-3 py-2">
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 border-2 border-darcula-accent border-t-transparent rounded-full animate-spin flex-shrink-0" />
                <p className="text-xs font-mono text-darcula-text">
                  Complete sign-in in your browser…
                </p>
              </div>
              <p className="text-2xs font-mono text-darcula-text-muted">
                A browser tab should have opened to Google's sign-in page.
                After you approve access, this panel will update automatically.
                The window closes in 3 minutes.
              </p>
              <button
                className="text-2xs font-mono text-darcula-text-muted hover:text-darcula-text transition-colors"
                onClick={() => {
                  stopPolling();
                  setPhase("idle");
                  setErrorMsg(null);
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            /* ── Setup / disconnected state ── */
            <div className="space-y-3">
              <p className="text-2xs font-mono text-darcula-text-muted">
                You need a Google Cloud OAuth 2.0 Client ID. Create one at{" "}
                <span className="text-darcula-accent-bright">
                  console.cloud.google.com
                </span>{" "}
                with the Drive API scope and{" "}
                <span className="text-darcula-accent-bright">
                  http://localhost:8741/callback
                </span>{" "}
                as an authorized redirect URI.
              </p>

              {/* Client ID */}
              <div>
                <label className="text-2xs font-mono text-darcula-text-muted uppercase tracking-wider block mb-1">
                  Client ID
                </label>
                <input
                  type={showSecrets ? "text" : "password"}
                  placeholder="xxxxxxxxx.apps.googleusercontent.com"
                  className="w-full bg-darcula-bg text-darcula-text text-xs font-mono px-3 py-2 rounded-sm border border-darcula-border outline-none focus:border-darcula-accent"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && canSignIn && handleSignIn()}
                />
              </div>

              {/* Client Secret */}
              <div>
                <label className="text-2xs font-mono text-darcula-text-muted uppercase tracking-wider block mb-1">
                  Client Secret
                </label>
                <div className="flex gap-2">
                  <input
                    type={showSecrets ? "text" : "password"}
                    placeholder="GOCSPX-…"
                    className="flex-1 bg-darcula-bg text-darcula-text text-xs font-mono px-3 py-2 rounded-sm border border-darcula-border outline-none focus:border-darcula-accent"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && canSignIn && handleSignIn()}
                  />
                  <button
                    className="text-2xs font-mono text-darcula-text-muted hover:text-darcula-text px-2"
                    onClick={() => setShowSecrets(!showSecrets)}
                  >
                    {showSecrets ? "hide" : "show"}
                  </button>
                </div>
              </div>

              <button
                className="w-full text-xs font-mono px-3 py-2 rounded-sm bg-darcula-accent text-white hover:bg-darcula-accent-bright transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={handleSignIn}
                disabled={!canSignIn}
              >
                Sign in with Google
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}