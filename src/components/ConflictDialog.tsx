import { useState } from "react";
import { resolveConflict, type ConflictInfo } from "../api/commands";

interface ConflictDialogProps {
  conflict: ConflictInfo;
  onResolved: (dataReplaced: boolean) => void;
  onDismiss: () => void;
}

function fmt(iso: string | null): string {
  if (!iso) return "Never synced";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export default function ConflictDialog({
  conflict,
  onResolved,
  onDismiss,
}: ConflictDialogProps) {
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAcceptNewest = async () => {
    setResolving(true);
    setError(null);
    try {
      const result = await resolveConflict("accept_newest");
      onResolved(result.data_replaced);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResolving(false);
    }
  };

  const handleKeepLocal = async () => {
    setResolving(true);
    setError(null);
    try {
      const result = await resolveConflict("keep_local");
      onResolved(result.data_replaced);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResolving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh]">
      <div className="absolute inset-0 bg-black/60" onClick={resolving ? undefined : onDismiss} />

      <div
        className="relative w-full max-w-sm bg-darcula-bg-light border border-darcula-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-darcula-border flex items-center gap-2">
          <span className="text-darcula-warning text-base">⚠</span>
          <div>
            <h2 className="text-sm font-mono font-semibold text-darcula-text-bright">
              Sync Conflict
            </h2>
            <p className="text-2xs font-mono text-darcula-text-muted mt-0.5">
              Google Drive has changes not in this copy
            </p>
          </div>
        </div>

        {/* Timestamps */}
        <div className="px-4 py-3 space-y-2 border-b border-darcula-border">
          <div className="flex justify-between items-center">
            <span className="text-2xs font-mono text-darcula-text-muted">Remote (Drive)</span>
            <span className="text-2xs font-mono text-darcula-accent-bright">
              {fmt(conflict.remote_modified)}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-2xs font-mono text-darcula-text-muted">Local (last sync)</span>
            <span className="text-2xs font-mono text-darcula-text">
              {fmt(conflict.local_last_sync)}
            </span>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 py-2 bg-darcula-error/10 border-b border-darcula-error/30">
            <p className="text-2xs font-mono text-darcula-error">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="px-4 py-3 space-y-2">
          <button
            className="w-full text-xs font-mono px-3 py-2 rounded-sm bg-darcula-accent text-white hover:bg-darcula-accent-bright transition-colors disabled:opacity-50"
            onClick={handleAcceptNewest}
            disabled={resolving}
          >
            {resolving ? "Resolving…" : "✓ Accept Newest"}
          </button>
          <p className="text-2xs font-mono text-darcula-text-muted text-center">
            Downloads Drive copy — your local data will be replaced
          </p>

          <div className="border-t border-darcula-border pt-2 flex justify-between items-center">
            <button
              className="text-2xs font-mono text-darcula-text-muted hover:text-darcula-text transition-colors disabled:opacity-50"
              onClick={handleKeepLocal}
              disabled={resolving}
            >
              Keep local, overwrite Drive
            </button>
            <button
              className="text-2xs font-mono text-darcula-text-muted hover:text-darcula-text transition-colors disabled:opacity-50"
              onClick={onDismiss}
              disabled={resolving}
            >
              Decide later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
