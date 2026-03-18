import { useMemo } from "react";

interface DiffViewerProps {
  oldText: string;
  newText: string;
  oldLabel: string;
  newLabel: string;
  onClose: () => void;
}

interface DiffLine {
  type: "unchanged" | "added" | "removed";
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

/**
 * Simple line-based diff algorithm.
 * Uses longest common subsequence for accurate diffs.
 */
function computeDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  // Build LCS table
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build diff
  let i = m,
    j = n;

  const temp: DiffLine[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      temp.push({
        type: "unchanged",
        content: oldLines[i - 1],
        oldLineNo: i,
        newLineNo: j,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      temp.push({
        type: "added",
        content: newLines[j - 1],
        newLineNo: j,
      });
      j--;
    } else {
      temp.push({
        type: "removed",
        content: oldLines[i - 1],
        oldLineNo: i,
      });
      i--;
    }
  }

  return temp.reverse();
}

export default function DiffViewer({
  oldText,
  newText,
  oldLabel,
  newLabel,
  onClose,
}: DiffViewerProps) {
  const diff = useMemo(() => {
    return computeDiff(oldText.split("\n"), newText.split("\n"));
  }, [oldText, newText]);

  const stats = useMemo(() => {
    const added = diff.filter((d) => d.type === "added").length;
    const removed = diff.filter((d) => d.type === "removed").length;
    return { added, removed };
  }, [diff]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-darcula-bg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-darcula-bg-light border-b border-darcula-border flex-shrink-0">
        <div className="flex items-center gap-4">
          <span className="text-sm font-mono font-semibold text-darcula-text-bright">
            Visual Diff
          </span>
          <span className="text-2xs font-mono text-darcula-success">
            +{stats.added} added
          </span>
          <span className="text-2xs font-mono text-darcula-error">
            -{stats.removed} removed
          </span>
        </div>
        <button
          className="text-xs font-mono px-3 py-1 rounded-sm bg-darcula-bg text-darcula-text-muted hover:text-darcula-text transition-colors"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      {/* Column Headers */}
      <div className="flex border-b border-darcula-border flex-shrink-0">
        <div className="flex-1 px-4 py-1 text-2xs font-mono text-darcula-text-muted bg-darcula-bg-light border-r border-darcula-border">
          {oldLabel}
        </div>
        <div className="flex-1 px-4 py-1 text-2xs font-mono text-darcula-text-muted bg-darcula-bg-light">
          {newLabel}
        </div>
      </div>

      {/* Diff Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex">
          {/* Old (left) */}
          <div className="flex-1 border-r border-darcula-border">
            {diff.map((line, i) => {
              if (line.type === "added") {
                return (
                  <div key={i} className="flex h-[22px] bg-darcula-bg-light">
                    <div className="w-10 text-right pr-2 text-2xs font-mono text-darcula-gutter leading-[22px]" />
                    <div className="flex-1" />
                  </div>
                );
              }
              return (
                <div
                  key={i}
                  className={`flex h-[22px] ${
                    line.type === "removed"
                      ? "bg-red-900/30"
                      : ""
                  }`}
                >
                  <div className="w-10 text-right pr-2 text-2xs font-mono text-darcula-gutter leading-[22px]">
                    {line.oldLineNo}
                  </div>
                  <div
                    className={`flex-1 px-2 text-sm font-mono leading-[22px] whitespace-pre ${
                      line.type === "removed"
                        ? "text-darcula-error"
                        : "text-darcula-text"
                    }`}
                  >
                    {line.type === "removed" && (
                      <span className="text-darcula-error mr-1">-</span>
                    )}
                    {line.content}
                  </div>
                </div>
              );
            })}
          </div>

          {/* New (right) */}
          <div className="flex-1">
            {diff.map((line, i) => {
              if (line.type === "removed") {
                return (
                  <div key={i} className="flex h-[22px] bg-darcula-bg-light">
                    <div className="w-10 text-right pr-2 text-2xs font-mono text-darcula-gutter leading-[22px]" />
                    <div className="flex-1" />
                  </div>
                );
              }
              return (
                <div
                  key={i}
                  className={`flex h-[22px] ${
                    line.type === "added"
                      ? "bg-green-900/30"
                      : ""
                  }`}
                >
                  <div className="w-10 text-right pr-2 text-2xs font-mono text-darcula-gutter leading-[22px]">
                    {line.newLineNo}
                  </div>
                  <div
                    className={`flex-1 px-2 text-sm font-mono leading-[22px] whitespace-pre ${
                      line.type === "added"
                        ? "text-darcula-success"
                        : "text-darcula-text"
                    }`}
                  >
                    {line.type === "added" && (
                      <span className="text-darcula-success mr-1">+</span>
                    )}
                    {line.content}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}