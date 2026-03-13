import { useState, useRef, useEffect } from "react";
import { unlockDatabase } from "../api/commands";

interface UnlockDialogProps {
  onUnlocked: () => void;
}

export default function UnlockDialog({ onUnlocked }: UnlockDialogProps) {
  const [password, setPassword]   = useState("");
  const [show, setShow]           = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Auto-focus the password field when the dialog mounts.
    inputRef.current?.focus();
  }, []);

  const handleUnlock = async () => {
    if (!password) return;
    setUnlocking(true);
    setError(null);
    try {
      await unlockDatabase(password);
      onUnlocked();
    } catch {
      setError("Incorrect password. Please try again.");
      setPassword("");
      setUnlocking(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-darcula-bg">
      {/* Logo */}
      <div className="mb-8 text-center select-none">
        <div className="text-5xl mb-2 text-darcula-accent-bright">⬡</div>
        <div className="font-mono font-bold text-darcula-text-bright text-lg">
          PromptVault
        </div>
        <div className="text-2xs font-mono text-darcula-text-muted mt-1">
          Encrypted database — enter your master password
        </div>
      </div>

      {/* Card */}
      <div className="w-full max-w-xs bg-darcula-bg-light border border-darcula-border rounded-lg overflow-hidden shadow-2xl">
        {/* Error banner */}
        {error && (
          <div className="px-4 py-2 bg-darcula-error/10 border-b border-darcula-error/30">
            <p className="text-2xs font-mono text-darcula-error">{error}</p>
          </div>
        )}

        <div className="px-4 py-4 space-y-3">
          <div>
            <label className="text-2xs font-mono text-darcula-text-muted uppercase tracking-wider block mb-1">
              Master Password
            </label>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type={show ? "text" : "password"}
                className="flex-1 bg-darcula-bg text-darcula-text text-xs font-mono px-3 py-2 rounded-sm border border-darcula-border outline-none focus:border-darcula-accent"
                placeholder="Enter password…"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !unlocking && handleUnlock()}
                disabled={unlocking}
                autoComplete="current-password"
              />
              <button
                className="text-2xs font-mono text-darcula-text-muted hover:text-darcula-text px-2 transition-colors"
                onClick={() => setShow((s) => !s)}
                tabIndex={-1}
              >
                {show ? "hide" : "show"}
              </button>
            </div>
          </div>

          <button
            className="w-full text-xs font-mono px-3 py-2 rounded-sm bg-darcula-accent text-white hover:bg-darcula-accent-bright transition-colors disabled:opacity-50"
            onClick={handleUnlock}
            disabled={unlocking || !password}
          >
            {unlocking ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Unlocking…
              </span>
            ) : (
              "Unlock"
            )}
          </button>
        </div>
      </div>

      <p className="mt-6 text-2xs font-mono text-darcula-text-muted opacity-50">
        v1.0.0
      </p>
    </div>
  );
}
