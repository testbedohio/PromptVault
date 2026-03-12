import type { Prompt } from "../types";

interface StatusBarProps {
  snippetCount: number;
  activeSnippet: Prompt | null;
  dbConnected: boolean;
  tauri: boolean;
}

export default function StatusBar({
  snippetCount,
  activeSnippet,
  dbConnected,
  tauri,
}: StatusBarProps) {
  const lineCount = activeSnippet
    ? activeSnippet.content.split("\n").length
    : 0;

  return (
    <footer className="flex items-center justify-between h-6 px-3 bg-darcula-accent text-white text-2xs font-mono flex-shrink-0 select-none">
      <div className="flex items-center gap-3">
        <span>⬡ PromptVault</span>
        <span className="opacity-70">{snippetCount} prompts</span>
        {activeSnippet && (
          <span className="opacity-70">{lineCount} lines</span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="opacity-70">
          SQLite: {dbConnected ? "Connected" : "Sample Data"}
        </span>
        <span className="flex items-center gap-1">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              dbConnected ? "bg-darcula-success" : "bg-darcula-warning"
            }`}
          />
          {tauri ? "Desktop" : "Browser"}
        </span>
      </div>
    </footer>
  );
}