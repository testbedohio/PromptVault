/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // JetBrains Darcula palette
        darcula: {
          bg: "#2B2B2B",
          "bg-light": "#313335",
          "bg-lighter": "#3C3F41",
          "bg-hover": "#4B6EAF33",
          border: "#515151",
          "border-light": "#646464",
          text: "#A9B7C6",
          "text-muted": "#808080",
          "text-bright": "#D4D4D4",
          keyword: "#CC7832",
          string: "#6A8759",
          number: "#6897BB",
          comment: "#629755",
          function: "#FFC66D",
          type: "#A9B7C6",
          error: "#FF6B68",
          warning: "#D0A95C",
          success: "#499C54",
          accent: "#4B6EAF",
          "accent-bright": "#5C8ED6",
          selection: "#214283",
          gutter: "#606366",
        },
      },
      fontFamily: {
        mono: [
          '"JetBrains Mono"',
          "Fira Code",
          "Consolas",
          "Monaco",
          "monospace",
        ],
        sans: [
          '"Inter"',
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
      },
      fontSize: {
        "2xs": "0.65rem",
      },
    },
  },
  plugins: [],
};