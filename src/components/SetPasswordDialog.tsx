import { useState } from "react";
import { setDbPassword, getDbLockStatus } from "../api/commands";

interface SetPasswordDialogProps {
  isEncrypted: boolean;
  onClose: () => void;
  onChanged: () => void;
}

type Mode = "set" | "change" | "remove";

export default function SetPasswordDialog({
  isEncrypted,
  onClose,
  onChanged,
}: SetPasswordDialogProps) {
  const mode: Mode = !isEncrypted ? "set" : "change";

  const [currentPw, setCurrentPw]   = useState("");
  const [newPw, setNewPw]           = useState("");
  const [confirmPw, setConfirmPw]   = useState("");
  const [removing, setRemoving]     = useState(false);
  const [show, setShow]             = useState(false);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const handleSave = async () => {
    setError(null);

    if (removing) {
      // Remove encryption
      if (!currentPw) { setError("Enter current password to confirm removal."); return; }
      setSaving(true);
      try {
        await setDbPassword(currentPw, null);
        onChanged();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setSaving(false);
      }
      return;
    }

    if (!newPw) { setError("New password cannot be empty."); return; }
    if (newPw !== confirmPw) { setError("Passwords do not match."); return; }
    if (newPw.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (isEncrypted && !currentPw) { setError("Enter current password to change it."); return; }

    setSaving(true);
    try {
      await setDbPassword(isEncrypted ? currentPw : null, newPw);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const title =
    mode === "set" ? "Enable Encryption" :
    removing       ? "Remove Encryption" : "Change Password";

  const subtitle =
    mode === "set"
      ? "Your database will be encrypted with AES-256 (SQLCipher + Argon2id key derivation)."
      : removing
      ? "The database will be decrypted and saved as plaintext."
      : "Enter your current password and choose a new one.";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />

      <div
        className="relative w-full max-w-sm bg-darcula-bg-light border border-darcula-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-darcula-border flex items-center justify-between">
          <div>
            <h2 className="text-sm font-mono font-semibold text-darcula-text-bright">
              🔒 {title}
            </h2>
            <p className="text-2xs font-mono text-darcula-text-muted mt-0.5">
              {subtitle}
            </p>
          </div>
          <button className="text-darcula-text-muted hover:text-darcula-text text-sm" onClick={onClose}>×</button>
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 py-2 bg-darcula-error/10 border-b border-darcula-error/30">
            <p className="text-2xs font-mono text-darcula-error">{error}</p>
          </div>
        )}

        {/* Fields */}
        <div className="px-4 py-3 space-y-3">
          {/* Current password — only when encrypted */}
          {isEncrypted && (
            <div>
              <label className="text-2xs font-mono text-darcula-text-muted uppercase tracking-wider block mb-1">
                Current Password
              </label>
              <input
                type={show ? "text" : "password"}
                className="w-full bg-darcula-bg text-darcula-text text-xs font-mono px-3 py-2 rounded-sm border border-darcula-border outline-none focus:border-darcula-accent"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                disabled={saving}
                autoComplete="current-password"
              />
            </div>
          )}

          {/* New / confirm — hidden when removing */}
          {!removing && (
            <>
              <div>
                <label className="text-2xs font-mono text-darcula-text-muted uppercase tracking-wider block mb-1">
                  New Password
                </label>
                <input
                  type={show ? "text" : "password"}
                  className="w-full bg-darcula-bg text-darcula-text text-xs font-mono px-3 py-2 rounded-sm border border-darcula-border outline-none focus:border-darcula-accent"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !saving && handleSave()}
                  disabled={saving}
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className="text-2xs font-mono text-darcula-text-muted uppercase tracking-wider block mb-1">
                  Confirm Password
                </label>
                <input
                  type={show ? "text" : "password"}
                  className="w-full bg-darcula-bg text-darcula-text text-xs font-mono px-3 py-2 rounded-sm border border-darcula-border outline-none focus:border-darcula-accent"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !saving && handleSave()}
                  disabled={saving}
                  autoComplete="new-password"
                />
              </div>
            </>
          )}

          <div className="flex items-center gap-2">
            <button
              className="text-2xs font-mono text-darcula-text-muted hover:text-darcula-text"
              onClick={() => setShow((s) => !s)}
            >
              {show ? "Hide passwords" : "Show passwords"}
            </button>
          </div>

          {/* Save button */}
          <button
            className="w-full text-xs font-mono px-3 py-2 rounded-sm bg-darcula-accent text-white hover:bg-darcula-accent-bright transition-colors disabled:opacity-50"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving…" : removing ? "Remove Encryption" : mode === "set" ? "Enable Encryption" : "Change Password"}
          </button>

          {/* Remove encryption link — only when encrypted */}
          {isEncrypted && (
            <div className="border-t border-darcula-border pt-2">
              <button
                className={`text-2xs font-mono transition-colors ${
                  removing
                    ? "text-darcula-error hover:underline"
                    : "text-darcula-text-muted hover:text-darcula-error"
                }`}
                onClick={() => { setRemoving((r) => !r); setError(null); }}
              >
                {removing ? "← Back to change password" : "Remove encryption…"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
