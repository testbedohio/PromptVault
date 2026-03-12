interface Snippet {
  id: number;
  title: string;
  content: string;
  categoryId: number | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface StatusBarProps {
  snippetCount: number;
  activeSnippet: Snippet | null;
}

export default function StatusBar({
  snippetCount,
  activeSnippet,
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
        <span className="opacity-70">SQLite: Connected</span>
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-darcula-success" />
          Local
        </span>
      </div>
    </footer>
  );
}