use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Google Drive sync configuration and state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncConfig {
    pub enabled: bool,
    pub client_id: String,
    pub client_secret: String,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub token_expiry: Option<i64>,
    pub remote_file_id: Option<String>,
    pub last_sync: Option<String>,
    pub sync_status: SyncStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SyncStatus {
    Disconnected,
    Connected,
    Syncing,
    Synced,
    Conflict,
    Error(String),
}

impl Default for SyncConfig {
    fn default() -> Self {
        SyncConfig {
            enabled: false,
            client_id: String::new(),
            client_secret: String::new(),
            access_token: None,
            refresh_token: None,
            token_expiry: None,
            remote_file_id: None,
            last_sync: None,
            sync_status: SyncStatus::Disconnected,
        }
    }
}

impl SyncConfig {
    /// Path for storing sync config
    fn config_path() -> PathBuf {
        let mut path = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
        path.push("PromptVault");
        fs::create_dir_all(&path).ok();
        path.push("sync_config.json");
        path
    }

    /// Load config from disk
    pub fn load() -> Self {
        let path = Self::config_path();
        if path.exists() {
            match fs::read_to_string(&path) {
                Ok(data) => serde_json::from_str(&data).unwrap_or_default(),
                Err(_) => Self::default(),
            }
        } else {
            Self::default()
        }
    }

    /// Persist config to disk
    pub fn save(&self) -> Result<(), String> {
        let path = Self::config_path();
        let data = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(&path, data).map_err(|e| e.to_string())
    }
}

/// Google Drive API client
pub struct DriveSync {
    config: SyncConfig,
}

impl DriveSync {
    pub fn new() -> Self {
        DriveSync {
            config: SyncConfig::load(),
        }
    }

    pub fn get_config(&self) -> &SyncConfig {
        &self.config
    }

    pub fn update_config(&mut self, config: SyncConfig) -> Result<(), String> {
        config.save()?;
        self.config = config;
        Ok(())
    }

    /// Build the Google OAuth 2.0 authorization URL
    pub fn get_auth_url(&self) -> Result<String, String> {
        if self.config.client_id.is_empty() {
            return Err("Client ID not configured".to_string());
        }

        let scopes = "https://www.googleapis.com/auth/drive.appdata";
        let redirect = "http://localhost:8741/callback";

        Ok(format!(
            "https://accounts.google.com/o/oauth2/v2/auth?\
            client_id={}&\
            redirect_uri={}&\
            response_type=code&\
            scope={}&\
            access_type=offline&\
            prompt=consent",
            self.config.client_id,
            urlencoding::encode(redirect),
            urlencoding::encode(scopes)
        ))
    }

    /// Exchange authorization code for tokens
    pub async fn exchange_code(&mut self, code: &str) -> Result<(), String> {
        let client = reqwest::Client::new();
        let response = client
            .post("https://oauth2.googleapis.com/token")
            .form(&[
                ("code", code),
                ("client_id", &self.config.client_id),
                ("client_secret", &self.config.client_secret),
                ("redirect_uri", "http://localhost:8741/callback"),
                ("grant_type", "authorization_code"),
            ])
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            let err = response.text().await.unwrap_or_default();
            return Err(format!("Token exchange failed: {}", err));
        }

        #[derive(Deserialize)]
        struct TokenResponse {
            access_token: String,
            refresh_token: Option<String>,
            expires_in: i64,
        }

        let tokens: TokenResponse = response.json().await.map_err(|e| e.to_string())?;

        self.config.access_token = Some(tokens.access_token);
        if let Some(rt) = tokens.refresh_token {
            self.config.refresh_token = Some(rt);
        }
        self.config.token_expiry =
            Some(chrono::Utc::now().timestamp() + tokens.expires_in);
        self.config.sync_status = SyncStatus::Connected;
        self.config.enabled = true;
        self.config.save()?;

        Ok(())
    }

    /// Upload database to Google Drive appDataFolder
    pub async fn upload_db(&mut self, db_path: &str) -> Result<(), String> {
        let token = self
            .config
            .access_token
            .as_ref()
            .ok_or("Not authenticated")?;

        let db_bytes = fs::read(db_path).map_err(|e| e.to_string())?;
        let client = reqwest::Client::new();

        self.config.sync_status = SyncStatus::Syncing;

        let url = if let Some(ref file_id) = self.config.remote_file_id {
            // Update existing file
            format!(
                "https://www.googleapis.com/upload/drive/v3/files/{}?uploadType=media",
                file_id
            )
        } else {
            // Create new file in appDataFolder
            "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart"
                .to_string()
        };

        if self.config.remote_file_id.is_some() {
            // Simple update
            let response = client
                .patch(&url)
                .bearer_auth(token)
                .header("Content-Type", "application/x-sqlite3")
                .body(db_bytes)
                .send()
                .await
                .map_err(|e| e.to_string())?;

            if !response.status().is_success() {
                let err = response.text().await.unwrap_or_default();
                self.config.sync_status =
                    SyncStatus::Error(format!("Upload failed: {}", err));
                self.config.save().ok();
                return Err(format!("Upload failed: {}", err));
            }
        } else {
            // Create with metadata
            let metadata = serde_json::json!({
                "name": "prompt_vault.db",
                "parents": ["appDataFolder"]
            });

            let boundary = "prompt_vault_boundary";
            let body = format!(
                "--{boundary}\r\n\
                Content-Type: application/json; charset=UTF-8\r\n\r\n\
                {}\r\n\
                --{boundary}\r\n\
                Content-Type: application/x-sqlite3\r\n\r\n",
                metadata
            );

            let mut full_body = body.into_bytes();
            full_body.extend_from_slice(&db_bytes);
            full_body.extend_from_slice(format!("\r\n--{boundary}--").as_bytes());

            let response = client
                .post(&url)
                .bearer_auth(token)
                .header(
                    "Content-Type",
                    format!("multipart/related; boundary={}", boundary),
                )
                .body(full_body)
                .send()
                .await
                .map_err(|e| e.to_string())?;

            if !response.status().is_success() {
                let err = response.text().await.unwrap_or_default();
                self.config.sync_status =
                    SyncStatus::Error(format!("Create failed: {}", err));
                self.config.save().ok();
                return Err(format!("Create failed: {}", err));
            }

            #[derive(Deserialize)]
            struct FileResponse {
                id: String,
            }

            let file: FileResponse =
                response.json().await.map_err(|e| e.to_string())?;
            self.config.remote_file_id = Some(file.id);
        }

        self.config.last_sync = Some(chrono::Utc::now().to_rfc3339());
        self.config.sync_status = SyncStatus::Synced;
        self.config.save()?;
        Ok(())
    }

    /// Check if remote file is newer than local
    pub async fn check_remote_status(&self) -> Result<Option<String>, String> {
        let token = self
            .config
            .access_token
            .as_ref()
            .ok_or("Not authenticated")?;

        let file_id = self
            .config
            .remote_file_id
            .as_ref()
            .ok_or("No remote file")?;

        let client = reqwest::Client::new();
        let url = format!(
            "https://www.googleapis.com/drive/v3/files/{}?fields=modifiedTime",
            file_id
        );

        let response = client
            .get(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            return Err("Failed to check remote status".to_string());
        }

        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct FileInfo {
            modified_time: String,
        }

        let info: FileInfo = response.json().await.map_err(|e| e.to_string())?;
        Ok(Some(info.modified_time))
    }
}

/// URL encoding helper (minimal)
mod urlencoding {
    pub fn encode(s: &str) -> String {
        s.chars()
            .map(|c| match c {
                'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => {
                    c.to_string()
                }
                _ => format!("%{:02X}", c as u8),
            })
            .collect()
    }
}