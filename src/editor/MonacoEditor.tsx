import { useRef, useEffect, useCallback } from "react";
import Editor, { OnMount, BeforeMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { darculaTheme } from "./darculaTheme";

interface MonacoEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  readOnly?: boolean;
  /** File title used for language detection */
  fileName?: string;
  /** Show alternating line background colors */
  stripedLines?: boolean;
  /** Show minimap code overview */
  minimap?: boolean;
}

/** Detect language from file extension */
function detectLanguage(fileName?: string): string {
  if (!fileName) return "markdown";
  const ext = fileName.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    md: "markdown",
    py: "python",
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    rs: "rust",
    sql: "sql",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "ini",
    html: "html",
    css: "css",
    sh: "shell",
    bash: "shell",
    txt: "plaintext",
  };
  return map[ext ?? ""] ?? "markdown";
}

export default function MonacoEditorWrapper({
  value,
  onChange,
  language,
  readOnly = false,
  fileName,
  stripedLines = false,
  minimap: minimapEnabled = true,
}: MonacoEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null);

  const resolvedLanguage = language ?? detectLanguage(fileName);

  const handleBeforeMount: BeforeMount = (monaco) => {
    // Register Darcula theme
    monaco.editor.defineTheme("darcula", darculaTheme);
  };

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    // Set theme
    monaco.editor.setTheme("darcula");

    // Focus the editor
    editor.focus();

    // Add Ctrl+S save action (auto-save handles this, but users expect the shortcut to feel responsive)
    editor.addAction({
      id: "promptvault-save",
      label: "Save",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => {
        // Trigger change immediately (bypasses debounce)
        const currentValue = editor.getValue();
        onChange(currentValue);
      },
    });

    // Markdown-specific settings
    if (resolvedLanguage === "markdown") {
      editor.updateOptions({
        wordWrap: "on",
        wordWrapColumn: 100,
        wrappingStrategy: "advanced",
      });
    }
  };

  const handleChange = useCallback(
    (newValue: string | undefined) => {
      if (newValue !== undefined) {
        onChange(newValue);
      }
    },
    [onChange]
  );

  // Toggle minimap reactively
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.updateOptions({ minimap: { enabled: minimapEnabled, maxColumn: 80 } });
    }
  }, [minimapEnabled]);

  // Apply alternating line stripes
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;

    if (!stripedLines) {
      decorationsRef.current?.clear();
      return;
    }

    const applyStripes = () => {
      const model = ed.getModel();
      if (!model) return;
      const lineCount = model.getLineCount();
      const newDecorations: editor.IModelDeltaDecoration[] = [];
      for (let i = 2; i <= lineCount; i += 2) {
        newDecorations.push({
          range: { startLineNumber: i, startColumn: 1, endLineNumber: i, endColumn: 1 },
          options: { isWholeLine: true, className: "pv-stripe-line" },
        });
      }
      if (decorationsRef.current) {
        decorationsRef.current.clear();
      }
      decorationsRef.current = ed.createDecorationsCollection(newDecorations);
    };

    applyStripes();
    const disposable = ed.onDidChangeModelContent(() => applyStripes());
    return () => disposable.dispose();
  }, [stripedLines, value]);

  // Update language when fileName changes
  useEffect(() => {
    if (editorRef.current) {
      const model = editorRef.current.getModel();
      if (model) {
        // Monaco types expect a specific import; we access via the global
        const monacoModule = (window as any).monaco;
        if (monacoModule) {
          monacoModule.editor.setModelLanguage(model, resolvedLanguage);
        }
      }
    }
  }, [resolvedLanguage]);

  return (
    <Editor
      height="100%"
      language={resolvedLanguage}
      value={value}
      onChange={handleChange}
      beforeMount={handleBeforeMount}
      onMount={handleMount}
      theme="darcula"
      loading={
        <div className="flex items-center justify-center h-full bg-darcula-bg">
          <span className="text-darcula-text-muted font-mono text-sm animate-pulse">
            Loading editor...
          </span>
        </div>
      }
      options={{
        // Typography
        fontFamily: '"JetBrains Mono", "Fira Code", Consolas, Monaco, monospace',
        fontSize: 14,
        fontLigatures: true,
        lineHeight: 22,

        // Editor behavior
        readOnly,
        minimap: { enabled: minimapEnabled, maxColumn: 80 },
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        cursorBlinking: "smooth",
        cursorSmoothCaretAnimation: "on",
        renderLineHighlight: "all",

        // Gutter
        lineNumbers: "on",
        glyphMargin: false,
        folding: true,
        foldingHighlight: true,
        lineDecorationsWidth: 8,

        // Brackets
        bracketPairColorization: { enabled: true },
        matchBrackets: "always",
        autoClosingBrackets: "always",
        autoClosingQuotes: "always",
        autoSurround: "languageDefined",

        // Formatting
        formatOnPaste: false,
        formatOnType: false,
        tabSize: 2,
        insertSpaces: true,
        trimAutoWhitespace: true,

        // Suggestions
        suggestOnTriggerCharacters: true,
        quickSuggestions: {
          other: true,
          comments: false,
          strings: false,
        },

        // Scrollbar
        scrollbar: {
          verticalScrollbarSize: 8,
          horizontalScrollbarSize: 8,
          verticalSliderSize: 8,
        },

        // Misc
        contextmenu: true,
        links: true,
        overviewRulerBorder: false,
        padding: { top: 4, bottom: 12 },
      }}
    />
  );
}