import type { editor } from "monaco-editor";

/**
 * JetBrains Darcula theme for Monaco Editor.
 * Colors matched to the Tailwind darcula palette in tailwind.config.js.
 */
export const darculaTheme: editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    // General
    { token: "", foreground: "A9B7C6", background: "2B2B2B" },
    { token: "invalid", foreground: "FF6B68" },

    // Comments
    { token: "comment", foreground: "629755", fontStyle: "italic" },
    { token: "comment.doc", foreground: "629755", fontStyle: "italic" },

    // Strings
    { token: "string", foreground: "6A8759" },
    { token: "string.escape", foreground: "CC7832" },

    // Numbers
    { token: "number", foreground: "6897BB" },
    { token: "number.hex", foreground: "6897BB" },

    // Keywords
    { token: "keyword", foreground: "CC7832", fontStyle: "bold" },
    { token: "keyword.control", foreground: "CC7832" },
    { token: "keyword.operator", foreground: "CC7832" },

    // Types
    { token: "type", foreground: "A9B7C6" },
    { token: "type.identifier", foreground: "A9B7C6" },

    // Functions
    { token: "identifier", foreground: "A9B7C6" },
    { token: "function", foreground: "FFC66D" },
    { token: "function.declaration", foreground: "FFC66D" },

    // Variables
    { token: "variable", foreground: "A9B7C6" },
    { token: "variable.predefined", foreground: "9876AA" },

    // Constants
    { token: "constant", foreground: "9876AA" },
    { token: "constant.language", foreground: "CC7832" },

    // Operators
    { token: "operator", foreground: "A9B7C6" },

    // Delimiters
    { token: "delimiter", foreground: "A9B7C6" },
    { token: "delimiter.bracket", foreground: "A9B7C6" },

    // Tags (HTML/XML)
    { token: "tag", foreground: "E8BF6A" },
    { token: "tag.attribute.name", foreground: "BABABA" },
    { token: "tag.attribute.value", foreground: "A5C261" },

    // Markdown
    { token: "markup.heading", foreground: "FFC66D", fontStyle: "bold" },
    { token: "markup.bold", foreground: "A9B7C6", fontStyle: "bold" },
    { token: "markup.italic", foreground: "A9B7C6", fontStyle: "italic" },
    { token: "markup.underline", foreground: "A9B7C6", fontStyle: "underline" },
    { token: "markup.raw", foreground: "6A8759" },
    { token: "markup.list", foreground: "CC7832" },
    { token: "markup.quote", foreground: "629755" },

    // Regex
    { token: "regexp", foreground: "6A8759" },

    // Annotations / Decorators
    { token: "annotation", foreground: "BBB529" },
    { token: "metatag", foreground: "BBB529" },
  ],
  colors: {
    // Editor
    "editor.background": "#2B2B2B",
    "editor.foreground": "#A9B7C6",
    "editor.selectionBackground": "#214283",
    "editor.lineHighlightBackground": "#323232",
    "editor.lineHighlightBorder": "#323232",
    "editor.inactiveSelectionBackground": "#214283AA",

    // Cursor
    "editorCursor.foreground": "#A9B7C6",

    // Gutter
    "editorLineNumber.foreground": "#606366",
    "editorLineNumber.activeForeground": "#A4A3A6",
    "editorGutter.background": "#313335",

    // Indent guides
    "editorIndentGuide.background": "#3B3B3B",
    "editorIndentGuide.activeBackground": "#515151",

    // Whitespace
    "editorWhitespace.foreground": "#404040",

    // Minimap
    "minimap.background": "#2B2B2B",

    // Bracket matching
    "editorBracketMatch.background": "#3B514D",
    "editorBracketMatch.border": "#3B514D",

    // Scrollbar
    "scrollbar.shadow": "#00000000",
    "scrollbarSlider.background": "#51515150",
    "scrollbarSlider.hoverBackground": "#51515180",
    "scrollbarSlider.activeBackground": "#515151A0",

    // Errors / warnings
    "editorError.foreground": "#FF6B68",
    "editorWarning.foreground": "#D0A95C",
    "editorInfo.foreground": "#6897BB",

    // Overview ruler
    "editorOverviewRuler.border": "#2B2B2B",

    // Widget (autocomplete, find)
    "editorWidget.background": "#3C3F41",
    "editorWidget.border": "#515151",
    "editorSuggestWidget.background": "#3C3F41",
    "editorSuggestWidget.border": "#515151",
    "editorSuggestWidget.selectedBackground": "#4B6EAF",

    // Input
    "input.background": "#45494A",
    "input.border": "#515151",
    "input.foreground": "#A9B7C6",
    "inputOption.activeBorder": "#4B6EAF",

    // Peek view
    "peekView.border": "#4B6EAF",
    "peekViewEditor.background": "#2B2B2B",
    "peekViewResult.background": "#313335",
  },
};