import { useState } from "react";
import { exportPrompts } from "../api/commands";
import type { Prompt } from "../types";

interface ExportDialogProps {
  prompts: Prompt[];
  /** IDs of currently selected / open prompts. null = export all */
  selectedIds?: number[] | null;
  onClose: () => void;
}

type Format = "json" | "markdown";
type Scope  = "all" | "selected";

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function ExportDialog({ prompts, selectedIds, onClose }: ExportDialogProps) {
  const [format, setFormat]     = useState<Format>("json");
  const [scope, setScope]       = useState<Scope>("all");
  const [exporting, setExporting] = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const hasSelection = selectedIds && selectedIds.length > 0;
  const exportCount  = scope === "selected" && hasSelection
    ? selectedIds!.length
    : prompts.length;

  const handleExport = async () => {
    setExporting(true);
    setError(null);

    try {
      const ids = scope === "selected" && hasSelection ? selectedIds! : null;
      const content = await exportPrompts({ format, ids });

      const date = new Date().toISOString().split("T")[0];
      if (format === "json") {
        downloadBlob(content, `promptvault-export-${date}.json`, "application/json");
      } else {
        downloadBlob(content, `promptvault-export-${date}.md`, "text/markdown");
      }

      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh]"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50" />

      <div
        className="relative w-full max-w-sm bg-darcula-bg-light border border-darcula-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-darcula-border flex items-center justify-between">
          <div>
            <h2 className="text-sm font-mono font-semibold text-darcula-text-bright">
              ↗ Export Prompts
            </h2>
            <p className="text-2xs font-mono text-darcula-text-muted mt-0.5">
              Download your prompts as a file
            </p>
          </div>
          <button
            className="text-darcula-text-muted hover:text-darcula-text text-sm"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="px-4 py-4 space-y-4">
          {/* Format selector */}
          <div>
            <label className="text-2xs font-mono text-darcula-text-muted uppercase tracking-wider block mb-2">
              Format
            </label>
            <div className="flex gap-2">
              {(["json", "markdown"] as Format[]).map((f) => (
                <button
                  key={f}
                  className={`flex-1 text-xs font-mono px-3 py-2 rounded-sm border transition-colors ${
                    format === f
                      ? "border-darcula-accent bg-darcula-accent/20 text-darcula-accent-bright"
                      : "border-darcula-border text-darcula-text-muted hover:border-darcula-accent/50 hover:text-darcula-text"
                  }`}
                  onClick={() => setFormat(f)}
                >
                  {f === "json" ? "📋 JSON" : "📄 Markdown"}
                </button>
              ))}
            </div>
            <p className="text-2xs font-mono text-darcula-text-muted mt-1.5">
              {format === "json"
                ? "Structured JSON with full metadata and version history. Ideal for re-importing or programmatic use."
                : "Human-readable Markdown document. One section per prompt with YAML-style metadata."}
            </p>
          </div>

          {/* Scope selector */}
          <div>
            <label className="text-2xs font-mono text-darcula-text-muted uppercase tracking-wider block mb-2">
              Scope
            </label>
            <div className="flex gap-2">
              <button
                className={`flex-1 text-xs font-mono px-3 py-2 rounded-sm border transition-colors ${
                  scope === "all"
                    ? "border-darcula-accent bg-darcula-accent/20 text-darcula-accent-bright"
                    : "border-darcula-border text-darcula-text-muted hover:border-darcula-accent/50"
                }`}
                onClick={() => setScope("all")}
              >
                All ({prompts.length})
              </button>
              <button
                className={`flex-1 text-xs font-mono px-3 py-2 rounded-sm border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  scope === "selected"
                    ? "border-darcula-accent bg-darcula-accent/20 text-darcula-accent-bright"
                    : "border-darcula-border text-darcula-text-muted hover:border-darcula-accent/50"
                }`}
                onClick={() => setScope("selected")}
                disabled={!hasSelection}
                title={!hasSelection ? "No prompts selected" : undefined}
              >
                Selected ({hasSelection ? selectedIds!.length : 0})
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="px-3 py-2 bg-darcula-error/10 border border-darcula-error/30 rounded-sm">
              <p className="text-2xs font-mono text-darcula-error">{error}</p>
            </div>
          )}

          {/* Export button */}
          <button
            className="w-full text-xs font-mono px-3 py-2.5 rounded-sm bg-darcula-accent text-white hover:bg-darcula-accent-bright transition-colors disabled:opacity-50"
            onClick={handleExport}
            disabled={exporting || exportCount === 0}
          >
            {exporting
              ? "Exporting…"
              : `Export ${exportCount} prompt${exportCount !== 1 ? "s" : ""} as .${format === "json" ? "json" : "md"}`}
          </button>
        </div>
      </div>
    </div>
  );
}