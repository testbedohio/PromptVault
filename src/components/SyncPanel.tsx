import { useState, useEffect, useRef, useCallback } from "react";
import {
  startOAuthFlow,
  startTeamOAuthFlow,
  connectTeamVault,
  initSyncSession,
  getSyncConfig,
  syncToDrive,
  resolveConflict,
  updateSyncConfig,
  setAutoSync,
  isSyncConnected,
  isSyncError,
  getSyncStatusLabel,
  type SyncConfig,
  type SyncSessionInfo,
} from "../api/commands";

// Open a URL in the system browser.
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
  | "idle"
  | "waiting"
  | "connected"
  | "syncing"
  | "error";

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS  = 200_000;

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

  // Multi-device: remote vault discovered banner
  const [sessionInfo, setSessionInfo]   = useState<SyncSessionInfo | null>(null);
  const [pullingRemote, setPullingRemote] = useState(false);

  // Team vault state
  const [teamVaultInput, setTeamVaultInput]   = useState("");
  const [connectingTeam, setConnectingTeam]   = useState(false);
  const [teamSection, setTeamSection]         = useState(false);
  const [teamAuthWaiting, setTeamAuthWaiting] = useState(false);

  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load config on mount ─────────────────────────────────────────

  useEffect(() => {
    getSyncConfig()
      .then((cfg) => {
        setConfig(cfg);
        if (isSyncConnected(cfg)) setPhase("connected");
        if (cfg.client_id) setClientId(cfg.client_id);
        if (cfg.client_secret) setClientSecret(cfg.client_secret);
        if (cfg.team_mode) setTeamSection(true);
        if (cfg.team_file_id) setTeamVaultInput(cfg.team_file_id);
      })
      .catch(() => {});
  }, []);

  // ── Polling ──────────────────────────────────────────────────────

  const stopPolling = useCallback(() => {
    if (pollRef.current)    clearInterval(pollRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    pollRef.current    = null;
    timeoutRef.current = null;
  }, []);

  /**
   * Poll getSyncConfig until Connected or Error.
   * When Connected, run initSyncSession to discover/claim any existing remote
   * file — the core multi-device fix.
   */
  const startPolling = useCallback((isTeamAuth = false) => {
    stopPolling();

    pollRef.current = setInterval(async () => {
      try {
        const cfg = await getSyncConfig();
        setConfig(cfg);

        if (isSyncConnected(cfg)) {
          setPhase("connected");
          setTeamAuthWaiting(false);
          stopPolling();

          // ── Multi-device: discover existing remote file ──────────
          try {
            const session = await initSyncSession();
            if (session.found_remote && session.remote_is_newer) {
              setSessionInfo(session);
            }
          } catch {
            // Non-fatal — user can still sync manually
          }

        } else if (isSyncError(cfg)) {
          setPhase("error");
          setErrorMsg(getSyncStatusLabel(cfg));
          setTeamAuthWaiting(false);
          stopPolling();
        }
      } catch {
        // Keep polling
      }
    }, POLL_INTERVAL_MS);

    timeoutRef.current = setTimeout(() => {
      stopPolling();
      if (phase === "waiting" || isTeamAuth) {
        setPhase("error");
        setTeamAuthWaiting(false);
        setErrorMsg("Sign-in timed out. Please try again.");
      }
    }, POLL_TIMEOUT_MS);
  }, [stopPolling, phase]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // ── Pull remote DB (multi-device) ────────────────────────────────

  /**
   * Accept the remote DB from another device — same last-write-wins flow
   * used by ConflictDialog, but triggered from the session banner.
   */
  const handlePullRemote = async () => {
    setPullingRemote(true);
    try {
      const result = await resolveConflict("accept_newest");
      if (result.data_replaced) {
        // Remote was pulled in — reload to flush stale React state
        window.location.reload();
      } else {
        setSessionInfo(null);
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to pull remote database");
    } finally {
      setPullingRemote(false);
    }
  };

  // ── Personal Auth ────────────────────────────────────────────────

  const handleSignIn = async () => {
    const id = clientId.trim();
    const secret = clientSecret.trim();
    if (!id || !secret) return;

    setPhase("waiting");
    setErrorMsg(null);
    setSessionInfo(null);

    try {
      const authUrl = await startOAuthFlow(id, secret);
      await openUrl(authUrl);
      startPolling(false);
    } catch (e) {
      setPhase("error");
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  };

  // ── Team Auth ─────────────────────────────────────────────────────

  const handleTeamSignIn = async () => {
    const id = clientId.trim();
    const secret = clientSecret.trim();
    if (!id || !secret) return;

    setTeamAuthWaiting(true);
    setErrorMsg(null);

    try {
      const authUrl = await startTeamOAuthFlow(id, secret);
      await openUrl(authUrl);
      startPolling(true);
    } catch (e) {
      setTeamAuthWaiting(false);
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const handleConnectTeamVault = async () => {
    const fileId = teamVaultInput.trim();
    if (!fileId) return;

    setConnectingTeam(true);
    setErrorMsg(null);

    try {
      await connectTeamVault(fileId);
      const cfg = await getSyncConfig();
      setConfig(cfg);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setConnectingTeam(false);
    }
  };

  const copyTeamFileId = () => {
    if (config?.team_file_id) {
      navigator.clipboard.writeText(config.team_file_id).catch(() => {});
    }
  };

  // ── Manual Sync ──────────────────────────────────────────────────

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
      team_mode: false,
      team_file_id: null,
    };
    try {
      await updateSyncConfig(reset);
      await setAutoSync(false, config.auto_sync_interval_mins ?? 5);
      setConfig(reset);
      setPhase("idle");
      setTeamSection(false);
      setSessionInfo(null);
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

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh]"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50" />

      <div
        className="relative w-full max-w-md bg-darcula-bg-light border border-darcula-border rounded-lg shadow-2xl overflow-hidden max-h-[84vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-darcula-border flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-sm font-mono font-semibold text-darcula-text-bright">
              ☁️ Google Drive Sync
            </h2>
            <p className="text-2xs font-mono text-darcula-text-muted mt-0.5">
              Back up and sync your prompt database
            </p>
          </div>
          <button className="text-darcula-text-muted hover:text-darcula-text text-sm" onClick={onClose}>
            ×
          </button>
        </div>

        {/* Status bar */}
        <div className="px-4 py-2.5 border-b border-darcula-border flex items-center gap-2 flex-shrink-0">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
            isConnected
              ? "bg-darcula-success"
              : phase === "waiting" || teamAuthWaiting
              ? "bg-darcula-warning animate-pulse"
              : "bg-darcula-text-muted"
          }`} />
          <span className="text-xs font-mono text-darcula-text">
            {phase === "waiting" || teamAuthWaiting
              ? "Waiting for Google sign-in…"
              : isConnected
              ? `Connected${config?.team_mode ? " (Team Mode)" : ""}`
              : "Disconnected"}
          </span>
          {config?.last_sync && isConnected && (
            <span className="text-2xs font-mono text-darcula-text-muted ml-auto">
              Last sync: {new Date(config.last_sync).toLocaleString()}
            </span>
          )}
        </div>

        {/* Multi-device: remote vault banner */}
        {sessionInfo?.found_remote && sessionInfo.remote_is_newer && (
          <div className="px-4 py-3 bg-darcula-accent/10 border-b border-darcula-accent/30 flex-shrink-0">
            <p className="text-xs font-mono text-darcula-accent-bright mb-1.5">
              📱 Existing vault found from another device
            </p>
            <p className="text-2xs font-mono text-darcula-text-muted mb-2.5">
              Another device has already uploaded a prompt database to this Google
              account. Pull it down to sync your prompts across devices.
              {sessionInfo.remote_modified && (
                <> Last modified: {new Date(sessionInfo.remote_modified).toLocaleString()}.</>
              )}
            </p>
            <div className="flex gap-2">
              <button
                className="text-2xs font-mono px-3 py-1.5 rounded-sm bg-darcula-accent text-white hover:bg-darcula-accent-bright transition-colors disabled:opacity-40"
                onClick={handlePullRemote}
                disabled={pullingRemote}
              >
                {pullingRemote ? "Pulling…" : "Pull & merge (recommended)"}
              </button>
              <button
                className="text-2xs font-mono px-3 py-1.5 rounded-sm bg-darcula-bg text-darcula-text-muted hover:text-darcula-text border border-darcula-border transition-colors"
                onClick={() => setSessionInfo(null)}
                disabled={pullingRemote}
              >
                Keep local
              </button>
            </div>
          </div>
        )}

        {/* Error banner */}
        {errorMsg && (
          <div className="px-4 py-2 bg-darcula-error/10 border-b border-darcula-error/30 flex-shrink-0">
            <p className="text-2xs font-mono text-darcula-error">{errorMsg}</p>
          </div>
        )}

        {/* Scrollable body */}
        <div className="px-4 py-3 overflow-y-auto flex-1">
          {isConnected ? (
            /* ── Connected ─────────────────────────────────────── */
            <div className="space-y-3">
              <p className="text-2xs font-mono text-darcula-text-muted">
                {config?.team_mode
                  ? "Team mode is active. Your vault syncs to a shared Drive file that teammates can access."
                  : "Your prompt database syncs to Google Drive. Sign into the same Google account on any device to access it."}
              </p>

              <button
                className="w-full text-xs font-mono px-3 py-2 rounded-sm bg-darcula-accent text-white hover:bg-darcula-accent-bright transition-colors disabled:opacity-50"
                onClick={handleSyncNow}
                disabled={syncing}
              >
                {syncing ? "Syncing…" : "Sync Now"}
              </button>

              {/* Auto-sync */}
              <div className="border border-darcula-border rounded-sm p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-darcula-text">Auto-sync</span>
                  <button
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-40 ${
                      config?.auto_sync_enabled ? "bg-darcula-accent" : "bg-darcula-border"
                    }`}
                    onClick={handleAutoSyncToggle}
                    disabled={savingAutoSync}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      config?.auto_sync_enabled ? "translate-x-4" : "translate-x-0.5"
                    }`} />
                  </button>
                </div>

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
                              : "border-darcula-border text-darcula-text-muted hover:border-darcula-accent/60"
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
              </div>

              {/* Team Vault section (connected state) */}
              {config?.team_mode && config.team_file_id && (
                <div className="border border-darcula-accent/30 rounded-sm p-3 bg-darcula-accent/5 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-2xs font-mono font-semibold text-darcula-accent-bright uppercase tracking-wider">
                      Team Vault
                    </span>
                    <span className="text-2xs font-mono px-1.5 py-0.5 bg-darcula-accent/20 text-darcula-accent-bright rounded-sm">
                      Active
                    </span>
                  </div>
                  <p className="text-2xs font-mono text-darcula-text-muted">
                    Share this File ID with teammates. They paste it into their own
                    PromptVault to connect to this shared vault.
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-2xs font-mono bg-darcula-bg px-2 py-1 rounded-sm text-darcula-string truncate">
                      {config.team_file_id}
                    </code>
                    <button
                      className="text-2xs font-mono px-2 py-1 rounded-sm bg-darcula-bg border border-darcula-border text-darcula-text-muted hover:text-darcula-text transition-colors flex-shrink-0"
                      onClick={copyTeamFileId}
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}

              <button
                className="block text-2xs font-mono text-darcula-error hover:underline"
                onClick={handleDisconnect}
              >
                Disconnect Google Drive
              </button>
            </div>
          ) : phase === "waiting" || teamAuthWaiting ? (
            /* ── Waiting for OAuth callback ─────────────────────── */
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
              </p>
              <button
                className="text-2xs font-mono text-darcula-text-muted hover:text-darcula-text transition-colors"
                onClick={() => { stopPolling(); setPhase("idle"); setTeamAuthWaiting(false); setErrorMsg(null); }}
              >
                Cancel
              </button>
            </div>
          ) : (
            /* ── Setup / Disconnected ────────────────────────────── */
            <div className="space-y-4">
              {/* Credentials */}
              <div className="space-y-3">
                <p className="text-2xs font-mono text-darcula-text-muted">
                  Create an OAuth 2.0 Client ID at{" "}
                  <span className="text-darcula-accent-bright">console.cloud.google.com</span>
                  {" "}with{" "}
                  <span className="text-darcula-accent-bright">http://localhost:8741/callback</span>
                  {" "}as a redirect URI.
                </p>

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
                  />
                </div>

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
                    />
                    <button
                      className="text-2xs font-mono text-darcula-text-muted hover:text-darcula-text px-2"
                      onClick={() => setShowSecrets(!showSecrets)}
                    >
                      {showSecrets ? "hide" : "show"}
                    </button>
                  </div>
                </div>
              </div>

              {/* Personal sync button */}
              <div className="space-y-2">
                <button
                  className="w-full text-xs font-mono px-3 py-2 rounded-sm bg-darcula-accent text-white hover:bg-darcula-accent-bright transition-colors disabled:opacity-40"
                  onClick={handleSignIn}
                  disabled={!canSignIn}
                >
                  Sign in with Google
                </button>
                <p className="text-2xs font-mono text-darcula-text-muted text-center">
                  Sign into the same Google account on any device to access your prompts everywhere.
                </p>
              </div>

              {/* Team mode toggle */}
              <div className="border border-darcula-border rounded-sm overflow-hidden">
                <button
                  className="w-full flex items-center justify-between px-3 py-2.5 bg-darcula-bg-lighter hover:bg-darcula-bg transition-colors"
                  onClick={() => setTeamSection(!teamSection)}
                >
                  <span className="text-xs font-mono text-darcula-text-bright flex items-center gap-2">
                    👥 Team / Shared Vault
                  </span>
                  <span className="text-darcula-text-muted text-xs">{teamSection ? "▲" : "▼"}</span>
                </button>

                {teamSection && (
                  <div className="px-3 py-3 space-y-3 border-t border-darcula-border">
                    <p className="text-2xs font-mono text-darcula-text-muted">
                      Team mode creates a Drive file shareable with others.
                      Requires re-authorising with expanded permissions.
                    </p>

                    {/* Create new team vault */}
                    <div className="space-y-1.5">
                      <label className="text-2xs font-mono text-darcula-text-muted uppercase tracking-wider block">
                        Create New Shared Vault
                      </label>
                      <button
                        className="w-full text-xs font-mono px-3 py-2 rounded-sm border border-darcula-accent text-darcula-accent-bright hover:bg-darcula-accent/10 transition-colors disabled:opacity-40"
                        onClick={handleTeamSignIn}
                        disabled={!canSignIn}
                      >
                        Sign in with Google (Team Mode)
                      </button>
                    </div>

                    <div className="flex items-center gap-2 text-2xs font-mono text-darcula-text-muted">
                      <div className="flex-1 h-px bg-darcula-border" />
                      <span>or join existing</span>
                      <div className="flex-1 h-px bg-darcula-border" />
                    </div>

                    {/* Join existing team vault */}
                    <div className="space-y-1.5">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="Paste File ID from teammate…"
                          className="flex-1 bg-darcula-bg text-darcula-text text-xs font-mono px-3 py-2 rounded-sm border border-darcula-border outline-none focus:border-darcula-accent"
                          value={teamVaultInput}
                          onChange={(e) => setTeamVaultInput(e.target.value)}
                        />
                        <button
                          className="text-xs font-mono px-3 py-2 rounded-sm bg-darcula-accent text-white hover:bg-darcula-accent-bright transition-colors disabled:opacity-40"
                          onClick={handleConnectTeamVault}
                          disabled={!teamVaultInput.trim() || connectingTeam || !isConnected}
                          title={!isConnected ? "Sign in first" : ""}
                        >
                          {connectingTeam ? "…" : "Join"}
                        </button>
                      </div>
                      {!isConnected && (
                        <p className="text-2xs font-mono text-darcula-warning">
                          Sign in with Google first, then enter the team vault ID.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}