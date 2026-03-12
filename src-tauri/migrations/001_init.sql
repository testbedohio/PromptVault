-- PromptVault Schema v1.0
-- This migration is applied automatically by the Rust backend on first launch.
-- Kept here as a reference for the data model.

-- Categories (folders)
CREATE TABLE IF NOT EXISTS categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    parent_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Prompts (core metadata)
CREATE TABLE IF NOT EXISTS prompts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Prompt versions (content history — every save creates a new row)
CREATE TABLE IF NOT EXISTS prompt_versions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt_id       INTEGER NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
    content_text    TEXT NOT NULL,
    version_number  INTEGER NOT NULL DEFAULT 1,
    embedding_vector BLOB,           -- reserved for Phase 3 (sqlite-vec)
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tags (flat labels)
CREATE TABLE IF NOT EXISTS tags (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

-- Prompt ↔ Tag junction (many-to-many)
CREATE TABLE IF NOT EXISTS prompt_tags (
    prompt_id INTEGER NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
    tag_id    INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (prompt_id, tag_id)
);

-- FTS5 full-text search index (Phase 1: keyword search)
CREATE VIRTUAL TABLE IF NOT EXISTS prompts_fts USING fts5(
    title,
    content,
    content='',
    tokenize='porter unicode61'
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_prompts_category       ON prompts(category_id);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt  ON prompt_versions(prompt_id);
CREATE INDEX IF NOT EXISTS idx_categories_parent       ON categories(parent_id);