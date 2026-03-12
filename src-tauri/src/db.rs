use chrono::Utc;
use rusqlite::{params, Connection, Result};
use serde::Serialize;
use std::path::PathBuf;

/// Get the database file path in the user's app data directory
fn db_path() -> PathBuf {
    let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("PromptVault");
    std::fs::create_dir_all(&path).ok();
    path.push("prompt_vault.db");
    path
}

pub struct Database {
    conn: Connection,
    path: PathBuf,
}

// ─── Data Models ─────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
pub struct Category {
    pub id: i64,
    pub name: String,
    pub parent_id: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct Tag {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct Prompt {
    pub id: i64,
    pub title: String,
    pub content: String,
    pub category_id: Option<i64>,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct PromptVersion {
    pub id: i64,
    pub prompt_id: i64,
    pub content_text: String,
    pub version_number: i32,
    pub created_at: String,
}

// ─── Database Implementation ─────────────────────────────────────

impl Database {
    pub fn new() -> Result<Self> {
        let path = db_path();
        let conn = Connection::open(&path)?;

        // Enable WAL mode for better concurrent read performance
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        conn.execute_batch("PRAGMA foreign_keys=ON;")?;

        let db = Database { conn, path };
        db.initialize_schema()?;
        Ok(db)
    }

    /// Return the path to the database file (used for sync)
    pub fn get_db_path(&self) -> String {
        self.path.to_string_lossy().to_string()
    }

    /// Create all tables and FTS5 virtual table
    fn initialize_schema(&self) -> Result<()> {
        self.conn.execute_batch(
            "
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

            -- Prompt versions (content history)
            CREATE TABLE IF NOT EXISTS prompt_versions (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                prompt_id       INTEGER NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
                content_text    TEXT NOT NULL,
                version_number  INTEGER NOT NULL DEFAULT 1,
                embedding_vector BLOB,
                created_at      TEXT NOT NULL DEFAULT (datetime('now'))
            );

            -- Tags
            CREATE TABLE IF NOT EXISTS tags (
                id   INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE
            );

            -- Prompt-Tag junction
            CREATE TABLE IF NOT EXISTS prompt_tags (
                prompt_id INTEGER NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
                tag_id    INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                PRIMARY KEY (prompt_id, tag_id)
            );

            -- FTS5 full-text search index
            CREATE VIRTUAL TABLE IF NOT EXISTS prompts_fts USING fts5(
                title,
                content,
                content='',
                tokenize='porter unicode61'
            );

            -- Indexes
            CREATE INDEX IF NOT EXISTS idx_prompts_category ON prompts(category_id);
            CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt ON prompt_versions(prompt_id);
            CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);
            "
        )?;
        Ok(())
    }

    // ── Categories ───────────────────────────────────────────────

    pub fn get_categories(&self) -> Result<Vec<Category>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, parent_id, created_at FROM categories ORDER BY name"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Category {
                id: row.get(0)?,
                name: row.get(1)?,
                parent_id: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?;
        rows.collect()
    }

    pub fn create_category(&self, name: &str, parent_id: Option<i64>) -> Result<Category> {
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT INTO categories (name, parent_id, created_at) VALUES (?1, ?2, ?3)",
            params![name, parent_id, now],
        )?;
        let id = self.conn.last_insert_rowid();
        Ok(Category { id, name: name.to_string(), parent_id, created_at: now })
    }

    // ── Prompts ──────────────────────────────────────────────────

    pub fn get_prompts(&self) -> Result<Vec<Prompt>> {
        let mut stmt = self.conn.prepare(
            "SELECT p.id, p.title, p.category_id, p.created_at, p.updated_at,
                    COALESCE(pv.content_text, '') as content
             FROM prompts p
             LEFT JOIN prompt_versions pv ON pv.id = (
                 SELECT id FROM prompt_versions
                 WHERE prompt_id = p.id
                 ORDER BY version_number DESC LIMIT 1
             )
             ORDER BY p.updated_at DESC"
        )?;

        let prompts: Vec<(i64, String, Option<i64>, String, String, String)> = stmt
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            })?
            .collect::<Result<Vec<_>>>()?;

        let mut result = Vec::new();
        for (id, title, category_id, created_at, updated_at, content) in prompts {
            let tags = self.get_tags_for_prompt(id)?;
            result.push(Prompt {
                id, title, content, category_id, tags, created_at, updated_at,
            });
        }
        Ok(result)
    }

    pub fn get_prompt_by_id(&self, id: i64) -> Result<Prompt> {
        let mut stmt = self.conn.prepare(
            "SELECT p.id, p.title, p.category_id, p.created_at, p.updated_at,
                    COALESCE(pv.content_text, '') as content
             FROM prompts p
             LEFT JOIN prompt_versions pv ON pv.id = (
                 SELECT id FROM prompt_versions
                 WHERE prompt_id = p.id
                 ORDER BY version_number DESC LIMIT 1
             )
             WHERE p.id = ?1"
        )?;

        let prompt = stmt.query_row(params![id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<i64>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
            ))
        })?;

        let tags = self.get_tags_for_prompt(id)?;
        Ok(Prompt {
            id: prompt.0,
            title: prompt.1,
            content: prompt.5,
            category_id: prompt.2,
            tags,
            created_at: prompt.3,
            updated_at: prompt.4,
        })
    }

    pub fn create_prompt(
        &self,
        title: &str,
        content: &str,
        category_id: Option<i64>,
        tags: &[String],
    ) -> Result<Prompt> {
        let now = Utc::now().to_rfc3339();

        self.conn.execute(
            "INSERT INTO prompts (title, category_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![title, category_id, now, now],
        )?;
        let prompt_id = self.conn.last_insert_rowid();

        // Create initial version
        self.conn.execute(
            "INSERT INTO prompt_versions (prompt_id, content_text, version_number, created_at)
             VALUES (?1, ?2, 1, ?3)",
            params![prompt_id, content, now],
        )?;

        // Update FTS index
        self.conn.execute(
            "INSERT INTO prompts_fts (rowid, title, content) VALUES (?1, ?2, ?3)",
            params![prompt_id, title, content],
        )?;

        // Handle tags
        self.set_tags_for_prompt(prompt_id, tags)?;

        let tag_names = self.get_tags_for_prompt(prompt_id)?;
        Ok(Prompt {
            id: prompt_id,
            title: title.to_string(),
            content: content.to_string(),
            category_id,
            tags: tag_names,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn update_prompt(
        &self,
        id: i64,
        title: Option<&str>,
        content: Option<&str>,
        category_id: Option<i64>,
        tags: Option<&[String]>,
    ) -> Result<Prompt> {
        let now = Utc::now().to_rfc3339();

        if let Some(t) = title {
            self.conn.execute(
                "UPDATE prompts SET title = ?1, updated_at = ?2 WHERE id = ?3",
                params![t, now, id],
            )?;
        }

        if let Some(cat) = category_id {
            self.conn.execute(
                "UPDATE prompts SET category_id = ?1, updated_at = ?2 WHERE id = ?3",
                params![cat, now, id],
            )?;
        }

        if let Some(c) = content {
            // Get next version number
            let next_version: i32 = self.conn.query_row(
                "SELECT COALESCE(MAX(version_number), 0) + 1 FROM prompt_versions WHERE prompt_id = ?1",
                params![id],
                |row| row.get(0),
            )?;

            self.conn.execute(
                "INSERT INTO prompt_versions (prompt_id, content_text, version_number, created_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![id, c, next_version, now],
            )?;

            self.conn.execute(
                "UPDATE prompts SET updated_at = ?1 WHERE id = ?2",
                params![now, id],
            )?;

            // Rebuild FTS entry
            let current_title: String = self.conn.query_row(
                "SELECT title FROM prompts WHERE id = ?1", params![id], |row| row.get(0),
            )?;
            self.conn.execute("DELETE FROM prompts_fts WHERE rowid = ?1", params![id])?;
            self.conn.execute(
                "INSERT INTO prompts_fts (rowid, title, content) VALUES (?1, ?2, ?3)",
                params![id, current_title, c],
            )?;
        }

        if let Some(t) = tags {
            self.set_tags_for_prompt(id, t)?;
        }

        self.get_prompt_by_id(id)
    }

    pub fn delete_prompt(&self, id: i64) -> Result<()> {
        self.conn.execute("DELETE FROM prompts_fts WHERE rowid = ?1", params![id])?;
        self.conn.execute("DELETE FROM prompts WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ── Versions ─────────────────────────────────────────────────

    pub fn get_prompt_versions(&self, prompt_id: i64) -> Result<Vec<PromptVersion>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, prompt_id, content_text, version_number, created_at
             FROM prompt_versions
             WHERE prompt_id = ?1
             ORDER BY version_number DESC"
        )?;
        let rows = stmt.query_map(params![prompt_id], |row| {
            Ok(PromptVersion {
                id: row.get(0)?,
                prompt_id: row.get(1)?,
                content_text: row.get(2)?,
                version_number: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?;
        rows.collect()
    }

    // ── Tags ─────────────────────────────────────────────────────

    pub fn get_all_tags(&self) -> Result<Vec<Tag>> {
        let mut stmt = self.conn.prepare("SELECT id, name FROM tags ORDER BY name")?;
        let rows = stmt.query_map([], |row| {
            Ok(Tag { id: row.get(0)?, name: row.get(1)? })
        })?;
        rows.collect()
    }

    fn get_tags_for_prompt(&self, prompt_id: i64) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT t.name FROM tags t
             INNER JOIN prompt_tags pt ON pt.tag_id = t.id
             WHERE pt.prompt_id = ?1
             ORDER BY t.name"
        )?;
        let rows = stmt.query_map(params![prompt_id], |row| row.get(0))?;
        rows.collect()
    }

    fn set_tags_for_prompt(&self, prompt_id: i64, tags: &[String]) -> Result<()> {
        // Clear existing
        self.conn.execute(
            "DELETE FROM prompt_tags WHERE prompt_id = ?1",
            params![prompt_id],
        )?;

        for tag_name in tags {
            // Upsert tag
            self.conn.execute(
                "INSERT OR IGNORE INTO tags (name) VALUES (?1)",
                params![tag_name],
            )?;
            let tag_id: i64 = self.conn.query_row(
                "SELECT id FROM tags WHERE name = ?1",
                params![tag_name],
                |row| row.get(0),
            )?;
            self.conn.execute(
                "INSERT OR IGNORE INTO prompt_tags (prompt_id, tag_id) VALUES (?1, ?2)",
                params![prompt_id, tag_id],
            )?;
        }
        Ok(())
    }

    // ── Search ───────────────────────────────────────────────────

    pub fn search_prompts(&self, query: &str) -> Result<Vec<Prompt>> {
        // Use FTS5 for keyword search
        let fts_query = query
            .split_whitespace()
            .map(|w| format!("\"{}\"", w.replace('"', "")))
            .collect::<Vec<_>>()
            .join(" OR ");

        let mut stmt = self.conn.prepare(
            "SELECT p.id, p.title, p.category_id, p.created_at, p.updated_at,
                    COALESCE(pv.content_text, '') as content
             FROM prompts p
             INNER JOIN prompts_fts fts ON fts.rowid = p.id
             LEFT JOIN prompt_versions pv ON pv.id = (
                 SELECT id FROM prompt_versions
                 WHERE prompt_id = p.id
                 ORDER BY version_number DESC LIMIT 1
             )
             WHERE prompts_fts MATCH ?1
             ORDER BY rank"
        )?;

        let prompts: Vec<(i64, String, Option<i64>, String, String, String)> = stmt
            .query_map(params![fts_query], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            })?
            .collect::<Result<Vec<_>>>()?;

        let mut result = Vec::new();
        for (id, title, category_id, created_at, updated_at, content) in prompts {
            let tags = self.get_tags_for_prompt(id)?;
            result.push(Prompt {
                id, title, content, category_id, tags, created_at, updated_at,
            });
        }
        Ok(result)
    }
}