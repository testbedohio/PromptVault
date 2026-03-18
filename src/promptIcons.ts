/** Icon choices for prompts, stored as a short string key in the DB. */

export interface IconEntry {
  key: string;
  char: string;
  label: string;
}

export const PROMPT_ICONS: IconEntry[] = [
  { key: "file",       char: "\u25C7", label: "File" },
  { key: "document",   char: "\uD83D\uDCC4", label: "Document" },
  { key: "note",       char: "\uD83D\uDCDD", label: "Note" },
  { key: "book",       char: "\uD83D\uDCD6", label: "Book" },
  { key: "scroll",     char: "\uD83D\uDCDC", label: "Scroll" },
  { key: "lightbulb",  char: "\uD83D\uDCA1", label: "Idea" },
  { key: "bolt",       char: "\u26A1",       label: "Bolt" },
  { key: "star",       char: "\u2B50",       label: "Star" },
  { key: "fire",       char: "\uD83D\uDD25", label: "Fire" },
  { key: "rocket",     char: "\uD83D\uDE80", label: "Rocket" },
  { key: "robot",      char: "\uD83E\uDD16", label: "Robot" },
  { key: "brain",      char: "\uD83E\uDDE0", label: "Brain" },
  { key: "gear",       char: "\u2699\uFE0F", label: "Gear" },
  { key: "wrench",     char: "\uD83D\uDD27", label: "Wrench" },
  { key: "shield",     char: "\uD83D\uDEE1\uFE0F", label: "Shield" },
  { key: "lock",       char: "\uD83D\uDD12", label: "Lock" },
  { key: "key",        char: "\uD83D\uDD11", label: "Key" },
  { key: "database",   char: "\uD83D\uDDC4\uFE0F", label: "Database" },
  { key: "globe",      char: "\uD83C\uDF10", label: "Globe" },
  { key: "chat",       char: "\uD83D\uDCAC", label: "Chat" },
  { key: "code",       char: "\u{1F4BB}",    label: "Code" },
  { key: "bug",        char: "\uD83D\uDC1B", label: "Bug" },
  { key: "test",       char: "\u2705",       label: "Test" },
  { key: "flag",       char: "\uD83D\uDEA9", label: "Flag" },
];

const DEFAULT_ICON = PROMPT_ICONS[0]; // file diamond

const iconMap = new Map(PROMPT_ICONS.map((e) => [e.key, e]));

export function getIconEntry(key: string | null | undefined): IconEntry {
  if (!key) return DEFAULT_ICON;
  return iconMap.get(key) ?? DEFAULT_ICON;
}
