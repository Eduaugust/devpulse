use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DevEvent {
    pub id: Option<i64>,
    pub event_type: String,
    pub title: String,
    pub description: String,
    pub repo: String,
    pub url: String,
    pub created_at: String,
    pub read: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LocalRepo {
    pub id: Option<i64>,
    pub path: String,
    pub name: String,
    pub added_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MonitoredRepo {
    pub id: Option<i64>,
    pub owner: String,
    pub name: String,
    pub full_name: String,
    pub added_at: String,
    pub base_branch: String,
    pub provider: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Setting {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ClaudeSession {
    pub id: Option<i64>,
    pub prompt: String,
    pub working_directory: String,
    pub model: String,
    pub permission_mode: String,
    pub max_budget: Option<f64>,
    pub status: String,
    pub result_text: String,
    pub cost_usd: Option<f64>,
    pub duration_ms: Option<i64>,
    pub created_at: String,
    pub finished_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CommandDef {
    pub id: Option<i64>,
    pub slug: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub prompt_template: String,
    pub execution_method: String,
    pub parameters_json: String,
    pub is_builtin: bool,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CommandRun {
    pub id: Option<i64>,
    pub command_id: i64,
    pub parameters_json: String,
    pub status: String,
    pub result_text: String,
    pub error_text: String,
    pub duration_ms: Option<i64>,
    pub created_at: String,
    pub finished_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InvoiceProfile {
    pub id: Option<i64>,
    pub profile_type: String,
    pub name: String,
    pub tax_number: String,
    pub address_line1: String,
    pub address_line2: String,
    pub city: String,
    pub state: String,
    pub country: String,
    pub postal_code: String,
    pub bank_details_json: String,
    pub is_default: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Invoice {
    pub id: Option<i64>,
    pub invoice_number: String,
    pub sender_profile_id: i64,
    pub recipient_profile_id: i64,
    pub invoice_date: String,
    pub due_date: String,
    pub currency: String,
    pub line_items_json: String,
    pub subtotal: f64,
    pub tax_rate: f64,
    pub tax_amount: f64,
    pub total: f64,
    pub notes: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ActivityMapping {
    pub id: Option<i64>,
    pub name: String,
    pub description: String,
    pub pattern: String,
    pub pattern_type: String,
    pub kimai_project_id: Option<i64>,
    pub kimai_project_name: String,
    pub kimai_activity_id: Option<i64>,
    pub kimai_activity_name: String,
    pub kimai_tags: String,
    pub priority: i64,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AutofillRun {
    pub id: Option<i64>,
    pub target_date: String,
    pub status: String,
    pub result_text: String,
    pub error_text: String,
    pub entries_created: i64,
    pub duration_ms: Option<i64>,
    pub created_at: String,
    pub finished_at: Option<String>,
}

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn new(app_dir: PathBuf) -> Result<Self, Box<dyn std::error::Error>> {
        std::fs::create_dir_all(&app_dir)?;
        let db_path = app_dir.join("devpulse.db");
        let conn = Connection::open(db_path)?;
        conn.execute_batch("
            PRAGMA journal_mode=WAL;
            PRAGMA synchronous=NORMAL;
            PRAGMA cache_size=-8000;
            PRAGMA busy_timeout=5000;
            PRAGMA foreign_keys=ON;
        ")?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                repo TEXT NOT NULL DEFAULT '',
                url TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                read INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS local_repos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                added_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS monitored_repos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner TEXT NOT NULL,
                name TEXT NOT NULL,
                full_name TEXT NOT NULL UNIQUE,
                added_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS claude_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                prompt TEXT NOT NULL,
                working_directory TEXT NOT NULL DEFAULT '',
                model TEXT NOT NULL DEFAULT 'sonnet',
                permission_mode TEXT NOT NULL DEFAULT 'default',
                max_budget REAL,
                status TEXT NOT NULL DEFAULT 'running',
                result_text TEXT NOT NULL DEFAULT '',
                cost_usd REAL,
                duration_ms INTEGER,
                created_at TEXT NOT NULL,
                finished_at TEXT
            );

            CREATE TABLE IF NOT EXISTS commands (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                slug TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                category TEXT NOT NULL DEFAULT 'custom',
                prompt_template TEXT NOT NULL DEFAULT '',
                execution_method TEXT NOT NULL DEFAULT 'claude-cli',
                parameters_json TEXT NOT NULL DEFAULT '[]',
                is_builtin INTEGER NOT NULL DEFAULT 0,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS command_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                command_id INTEGER NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
                parameters_json TEXT NOT NULL DEFAULT '{}',
                status TEXT NOT NULL DEFAULT 'running',
                result_text TEXT NOT NULL DEFAULT '',
                error_text TEXT NOT NULL DEFAULT '',
                duration_ms INTEGER,
                created_at TEXT NOT NULL,
                finished_at TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
            CREATE INDEX IF NOT EXISTS idx_events_repo ON events(repo);
            CREATE INDEX IF NOT EXISTS idx_events_type_title_repo ON events(event_type, title, repo);
            CREATE INDEX IF NOT EXISTS idx_claude_sessions_created ON claude_sessions(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_commands_slug ON commands(slug);
            CREATE INDEX IF NOT EXISTS idx_command_runs_command ON command_runs(command_id);
            CREATE INDEX IF NOT EXISTS idx_command_runs_created ON command_runs(created_at DESC);

            CREATE TABLE IF NOT EXISTS invoice_profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                profile_type TEXT NOT NULL,
                name TEXT NOT NULL,
                tax_number TEXT NOT NULL DEFAULT '',
                address_line1 TEXT NOT NULL DEFAULT '',
                address_line2 TEXT NOT NULL DEFAULT '',
                city TEXT NOT NULL DEFAULT '',
                state TEXT NOT NULL DEFAULT '',
                country TEXT NOT NULL DEFAULT '',
                postal_code TEXT NOT NULL DEFAULT '',
                bank_details_json TEXT NOT NULL DEFAULT '{}',
                is_default INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS invoices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                invoice_number TEXT NOT NULL UNIQUE,
                sender_profile_id INTEGER NOT NULL REFERENCES invoice_profiles(id),
                recipient_profile_id INTEGER NOT NULL REFERENCES invoice_profiles(id),
                invoice_date TEXT NOT NULL,
                due_date TEXT NOT NULL,
                currency TEXT NOT NULL DEFAULT 'USD',
                line_items_json TEXT NOT NULL DEFAULT '[]',
                subtotal REAL NOT NULL DEFAULT 0,
                tax_rate REAL NOT NULL DEFAULT 0,
                tax_amount REAL NOT NULL DEFAULT 0,
                total REAL NOT NULL DEFAULT 0,
                notes TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'draft',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
            CREATE INDEX IF NOT EXISTS idx_invoices_created ON invoices(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_invoice_profiles_type ON invoice_profiles(profile_type);

            CREATE TABLE IF NOT EXISTS activity_mappings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                pattern TEXT NOT NULL,
                pattern_type TEXT NOT NULL DEFAULT 'contains',
                kimai_project_id INTEGER,
                kimai_project_name TEXT NOT NULL DEFAULT '',
                kimai_activity_id INTEGER,
                kimai_activity_name TEXT NOT NULL DEFAULT '',
                kimai_tags TEXT NOT NULL DEFAULT '',
                priority INTEGER NOT NULL DEFAULT 0,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS autofill_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                target_date TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'running',
                result_text TEXT NOT NULL DEFAULT '',
                error_text TEXT NOT NULL DEFAULT '',
                entries_created INTEGER NOT NULL DEFAULT 0,
                duration_ms INTEGER,
                created_at TEXT NOT NULL,
                finished_at TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_autofill_runs_date ON autofill_runs(target_date);
            CREATE INDEX IF NOT EXISTS idx_autofill_runs_created ON autofill_runs(created_at DESC);
            ",
        )?;

        // Migration: add base_branch column to monitored_repos
        let _ = conn.execute_batch(
            "ALTER TABLE monitored_repos ADD COLUMN base_branch TEXT NOT NULL DEFAULT 'development';"
        );

        // Migration: add provider column to monitored_repos
        let _ = conn.execute_batch(
            "ALTER TABLE monitored_repos ADD COLUMN provider TEXT NOT NULL DEFAULT 'github';"
        );

        // Migration: add description column to activity_mappings
        let _ = conn.execute_batch(
            "ALTER TABLE activity_mappings ADD COLUMN description TEXT NOT NULL DEFAULT '';"
        );

        // Insert default settings if they don't exist
        conn.execute_batch(
            "
            INSERT OR IGNORE INTO settings (key, value) VALUES ('polling_interval', '60');
            INSERT OR IGNORE INTO settings (key, value) VALUES ('notifications_enabled', 'true');
            INSERT OR IGNORE INTO settings (key, value) VALUES ('notify_prs', 'true');
            INSERT OR IGNORE INTO settings (key, value) VALUES ('notify_reviews', 'true');
            INSERT OR IGNORE INTO settings (key, value) VALUES ('notify_mentions', 'true');
            INSERT OR IGNORE INTO settings (key, value) VALUES ('theme', 'dark');
            INSERT OR IGNORE INTO settings (key, value) VALUES ('github_username', '');
            INSERT OR IGNORE INTO settings (key, value) VALUES ('auto_review_enabled', 'false');
            INSERT OR IGNORE INTO settings (key, value) VALUES ('auto_review_post', 'false');
            INSERT OR IGNORE INTO settings (key, value) VALUES ('auto_description_enabled', 'false');
            INSERT OR IGNORE INTO settings (key, value) VALUES ('auto_fixes_enabled', 'false');
            INSERT OR IGNORE INTO settings (key, value) VALUES ('timezone', '');
            INSERT OR IGNORE INTO settings (key, value) VALUES ('autofill_enabled', 'false');
            INSERT OR IGNORE INTO settings (key, value) VALUES ('autofill_time', '09:00');
            INSERT OR IGNORE INTO settings (key, value) VALUES ('autofill_context_days', '14');
            ",
        )?;

        drop(conn);
        // Seed builtin commands (also used by reset_builtin_commands)
        self.seed_builtin_commands()?;

        Ok(())
    }

    pub fn insert_event(&self, event: &DevEvent) -> Result<i64, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO events (event_type, title, description, repo, url, created_at, read) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![event.event_type, event.title, event.description, event.repo, event.url, event.created_at, event.read],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn get_events(
        &self,
        event_type: Option<&str>,
        repo: Option<&str>,
        search: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<DevEvent>, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let mut sql = String::from("SELECT id, event_type, title, description, repo, url, created_at, read FROM events WHERE 1=1");
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(t) = event_type {
            sql.push_str(" AND event_type = ?");
            param_values.push(Box::new(t.to_string()));
        }
        if let Some(r) = repo {
            sql.push_str(" AND repo = ?");
            param_values.push(Box::new(r.to_string()));
        }
        if let Some(s) = search {
            sql.push_str(" AND (title LIKE ? OR description LIKE ?)");
            let pattern = format!("%{}%", s);
            param_values.push(Box::new(pattern.clone()));
            param_values.push(Box::new(pattern));
        }

        sql.push_str(" ORDER BY created_at DESC LIMIT ? OFFSET ?");
        param_values.push(Box::new(limit));
        param_values.push(Box::new(offset));

        let params_refs: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();

        let mut stmt = conn.prepare(&sql)?;
        let events = stmt
            .query_map(params_refs.as_slice(), |row| {
                Ok(DevEvent {
                    id: Some(row.get(0)?),
                    event_type: row.get(1)?,
                    title: row.get(2)?,
                    description: row.get(3)?,
                    repo: row.get(4)?,
                    url: row.get(5)?,
                    created_at: row.get(6)?,
                    read: row.get(7)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(events)
    }

    pub fn get_recent_events(&self, limit: i64) -> Result<Vec<DevEvent>, Box<dyn std::error::Error>> {
        self.get_events(None, None, None, limit, 0)
    }

    pub fn event_exists(&self, event_type: &str, title: &str, repo: &str) -> Result<bool, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM events WHERE event_type = ?1 AND title = ?2 AND repo = ?3)",
            params![event_type, title, repo],
            |row| row.get(0),
        )?;
        Ok(exists)
    }

    pub fn get_generic_notifications(&self) -> Result<Vec<DevEvent>, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, event_type, title, description, repo, url, created_at, read FROM events WHERE event_type = 'notification' ORDER BY created_at DESC LIMIT 50"
        )?;
        let events = stmt
            .query_map([], |row| {
                Ok(DevEvent {
                    id: Some(row.get(0)?),
                    event_type: row.get(1)?,
                    title: row.get(2)?,
                    description: row.get(3)?,
                    repo: row.get(4)?,
                    url: row.get(5)?,
                    created_at: row.get(6)?,
                    read: row.get(7)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(events)
    }

    pub fn update_event_classification(&self, id: i64, event_type: &str, description: &str) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE events SET event_type = ?1, description = ?2 WHERE id = ?3",
            params![event_type, description, id],
        )?;
        Ok(())
    }

    pub fn get_local_repos(&self) -> Result<Vec<LocalRepo>, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, path, name, added_at FROM local_repos ORDER BY name")?;
        let repos = stmt
            .query_map([], |row| {
                Ok(LocalRepo {
                    id: Some(row.get(0)?),
                    path: row.get(1)?,
                    name: row.get(2)?,
                    added_at: row.get(3)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(repos)
    }

    pub fn add_local_repo(&self, path: &str, name: &str) -> Result<i64, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT OR IGNORE INTO local_repos (path, name, added_at) VALUES (?1, ?2, ?3)",
            params![path, name, now],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn remove_local_repo(&self, id: i64) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM local_repos WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get_monitored_repos(&self) -> Result<Vec<MonitoredRepo>, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT id, owner, name, full_name, added_at, base_branch, provider FROM monitored_repos ORDER BY full_name")?;
        let repos = stmt
            .query_map([], |row| {
                Ok(MonitoredRepo {
                    id: Some(row.get(0)?),
                    owner: row.get(1)?,
                    name: row.get(2)?,
                    full_name: row.get(3)?,
                    added_at: row.get(4)?,
                    base_branch: row.get(5)?,
                    provider: row.get(6)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(repos)
    }

    pub fn add_monitored_repo(&self, owner: &str, name: &str, provider: &str) -> Result<i64, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let full_name = format!("{}/{}", owner, name);
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT OR IGNORE INTO monitored_repos (owner, name, full_name, added_at, base_branch, provider) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![owner, name, full_name, now, "development", provider],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn remove_monitored_repo(&self, id: i64) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM monitored_repos WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn update_monitored_repo_base_branch(&self, id: i64, base_branch: &str) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE monitored_repos SET base_branch = ?1 WHERE id = ?2",
            params![base_branch, id],
        )?;
        Ok(())
    }

    pub fn get_settings(&self) -> Result<Vec<Setting>, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT key, value FROM settings ORDER BY key")?;
        let settings = stmt
            .query_map([], |row| {
                Ok(Setting {
                    key: row.get(0)?,
                    value: row.get(1)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(settings)
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        );
        match result {
            Ok(val) => Ok(Some(val)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(Box::new(e)),
        }
    }

    pub fn update_setting(&self, key: &str, value: &str) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
        Ok(())
    }


    pub fn insert_claude_session(&self, session: &ClaudeSession) -> Result<i64, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO claude_sessions (prompt, working_directory, model, permission_mode, max_budget, status, result_text, cost_usd, duration_ms, created_at, finished_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                session.prompt,
                session.working_directory,
                session.model,
                session.permission_mode,
                session.max_budget,
                session.status,
                session.result_text,
                session.cost_usd,
                session.duration_ms,
                session.created_at,
                session.finished_at,
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn update_claude_session_status(
        &self,
        id: i64,
        status: &str,
        result_text: &str,
        cost_usd: Option<f64>,
        duration_ms: Option<i64>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE claude_sessions SET status = ?1, result_text = ?2, cost_usd = ?3, duration_ms = ?4, finished_at = ?5 WHERE id = ?6",
            params![status, result_text, cost_usd, duration_ms, now, id],
        )?;
        Ok(())
    }

    pub fn get_claude_sessions(&self, limit: i64) -> Result<Vec<ClaudeSession>, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, prompt, working_directory, model, permission_mode, max_budget, status, result_text, cost_usd, duration_ms, created_at, finished_at
             FROM claude_sessions ORDER BY created_at DESC LIMIT ?1"
        )?;
        let sessions = stmt
            .query_map(params![limit], |row| {
                Ok(ClaudeSession {
                    id: Some(row.get(0)?),
                    prompt: row.get(1)?,
                    working_directory: row.get(2)?,
                    model: row.get(3)?,
                    permission_mode: row.get(4)?,
                    max_budget: row.get(5)?,
                    status: row.get(6)?,
                    result_text: row.get(7)?,
                    cost_usd: row.get(8)?,
                    duration_ms: row.get(9)?,
                    created_at: row.get(10)?,
                    finished_at: row.get(11)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(sessions)
    }

    pub fn delete_claude_session(&self, id: i64) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM claude_sessions WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ── Commands CRUD ──

    pub fn get_commands(&self) -> Result<Vec<CommandDef>, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, slug, name, description, category, prompt_template, execution_method, parameters_json, is_builtin, enabled, created_at, updated_at
             FROM commands ORDER BY is_builtin DESC, name"
        )?;
        let cmds = stmt
            .query_map([], |row| {
                Ok(CommandDef {
                    id: Some(row.get(0)?),
                    slug: row.get(1)?,
                    name: row.get(2)?,
                    description: row.get(3)?,
                    category: row.get(4)?,
                    prompt_template: row.get(5)?,
                    execution_method: row.get(6)?,
                    parameters_json: row.get(7)?,
                    is_builtin: row.get(8)?,
                    enabled: row.get(9)?,
                    created_at: row.get(10)?,
                    updated_at: row.get(11)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(cmds)
    }

    pub fn get_command_by_slug(&self, slug: &str) -> Result<Option<CommandDef>, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT id, slug, name, description, category, prompt_template, execution_method, parameters_json, is_builtin, enabled, created_at, updated_at
             FROM commands WHERE slug = ?1",
            params![slug],
            |row| {
                Ok(CommandDef {
                    id: Some(row.get(0)?),
                    slug: row.get(1)?,
                    name: row.get(2)?,
                    description: row.get(3)?,
                    category: row.get(4)?,
                    prompt_template: row.get(5)?,
                    execution_method: row.get(6)?,
                    parameters_json: row.get(7)?,
                    is_builtin: row.get(8)?,
                    enabled: row.get(9)?,
                    created_at: row.get(10)?,
                    updated_at: row.get(11)?,
                })
            },
        );
        match result {
            Ok(cmd) => Ok(Some(cmd)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(Box::new(e)),
        }
    }

    pub fn insert_command(&self, cmd: &CommandDef) -> Result<i64, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO commands (slug, name, description, category, prompt_template, execution_method, parameters_json, is_builtin, enabled, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                cmd.slug, cmd.name, cmd.description, cmd.category,
                cmd.prompt_template, cmd.execution_method, cmd.parameters_json,
                cmd.is_builtin, cmd.enabled, cmd.created_at, cmd.updated_at,
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn update_command(&self, cmd: &CommandDef) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE commands SET slug=?1, name=?2, description=?3, category=?4, prompt_template=?5, execution_method=?6, parameters_json=?7, enabled=?8, updated_at=?9 WHERE id=?10",
            params![
                cmd.slug, cmd.name, cmd.description, cmd.category,
                cmd.prompt_template, cmd.execution_method, cmd.parameters_json,
                cmd.enabled, now, cmd.id,
            ],
        )?;
        Ok(())
    }

    pub fn delete_command(&self, id: i64) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM commands WHERE id = ?1 AND is_builtin = 0", params![id])?;
        Ok(())
    }

    pub fn reset_builtin_commands(&self) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        // Delete existing builtins so we can re-insert with fresh defaults
        conn.execute("DELETE FROM commands WHERE is_builtin = 1", [])?;
        drop(conn);
        // Re-seed (reuses init_schema's INSERT OR IGNORE, but since we deleted them it will insert)
        self.seed_builtin_commands()?;
        Ok(())
    }

    fn seed_builtin_commands(&self) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();

        let builtins: &[(&str, &str, &str, &str, &str, &str, &str)] = &[
            (
                "pr-review",
                "PR Review",
                "Security-focused code review with categorized findings",
                "review",
                Self::pr_review_template(),
                "claude-cli",
                "[{\"key\":\"repo\",\"label\":\"Repository\",\"type\":\"select_monitored_repo\",\"required\":true},{\"key\":\"pr_number\",\"label\":\"Pull Request\",\"type\":\"select_pr\",\"required\":true,\"depends_on\":\"repo\"}]",
            ),
            (
                "post-review",
                "Post Review",
                "Post a code review to a GitHub pull request as inline comments (used programmatically by PR Review tab)",
                "review",
                Self::post_review_template(),
                "composite",
                "[]",
            ),
            (
                "generate-report",
                "Generate Report",
                "Gather dev activity and generate a timesheet report using AI",
                "report",
                Self::generate_report_template(),
                "claude-cli",
                "[{\"key\":\"date_from\",\"label\":\"From Date\",\"type\":\"date\",\"required\":true},{\"key\":\"date_to\",\"label\":\"To Date\",\"type\":\"date\",\"required\":true},{\"key\":\"include_git\",\"label\":\"Include Git\",\"type\":\"boolean\",\"required\":false,\"default\":\"true\"},{\"key\":\"include_github\",\"label\":\"Include GitHub\",\"type\":\"boolean\",\"required\":false,\"default\":\"true\"}]",
            ),
            (
                "fill-timesheet",
                "Fill Timesheet",
                "Propose Kimai timesheet entries from a generated report using Claude terminal",
                "report",
                Self::fill_timesheet_template(),
                "claude-terminal",
                "[]",
            ),
            (
                "pr-description",
                "PR Description",
                "Generate a rich PR description from diff, commits, and branch context",
                "pr",
                Self::pr_description_template(),
                "claude-cli",
                "[]",
            ),
        ];

        for &(slug, name, description, category, prompt_template, execution_method, parameters_json) in builtins {
            conn.execute(
                "INSERT OR IGNORE INTO commands (slug, name, description, category, prompt_template, execution_method, parameters_json, is_builtin, enabled, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, 1, ?8, ?8)",
                params![slug, name, description, category, prompt_template, execution_method, parameters_json, now],
            )?;
        }

        Ok(())
    }

    fn pr_review_template() -> &'static str {
        r#"# PR Review Command

## Role
You are a **Security-Focused Senior Code Reviewer**. Before reviewing, you MUST understand the project context.

## Step 1: Gather Project Context
Before analyzing the diff, examine the repository to understand its conventions:

1. **Read project docs** — Look for `CLAUDE.md`, `README.md`, `.claude/` config, `CONTRIBUTING.md`, or similar files at the root and in key subdirectories. These define coding standards, architecture decisions, and project-specific patterns.
2. **Identify the tech stack** — Check `package.json`, `Cargo.toml`, `requirements.txt`, `go.mod`, etc. Note the frameworks, libraries, and language versions in use.
3. **Understand the architecture** — Is it a monorepo? What are the packages/modules? What's the directory structure convention?
4. **Check for linting/formatting rules** — Look at `.eslintrc`, `tsconfig.json`, `biome.json`, `.prettierrc`, `rustfmt.toml`, etc.
5. **Note existing patterns** — How are imports organized? What's the error handling strategy? Is there i18n? What testing framework is used?

Use this context to calibrate your review — flag violations of THIS project's patterns, not generic best practices.

## Step 2: Analyze the Diff
With the project context in mind, review the diff for:
1. **Security vulnerabilities** — XSS, injection, auth issues, sensitive data exposure, OWASP Top 10
2. **Bugs and logic errors** — Off-by-one, race conditions, null handling, missing edge cases
3. **Pattern violations** — Deviations from the project's established conventions (found in Step 1)
4. **Type safety** — `any` types, unsafe casts, missing null checks
5. **Performance** — N+1 queries, missing memoization, unnecessary re-renders, bundle impact
6. **Error handling** — Swallowed errors, missing validation, inconsistent patterns
7. **Code organization** — Duplication, misplaced logic, prop drilling, separation of concerns

## Step 3: Output the Review
Use this exact markdown structure:

## Overview
**Files Changed**: [number] files
**Lines**: +[additions] / -[deletions]
**Stack**: [detected tech stack from Step 1]

---

## 🔴 Critical Issues
**These MUST be fixed before merging**

### 1. [Issue Title]
- **File**: `path/to/file.ts:123-145`
- **Severity**: Critical
- **Description**: [Clear explanation of the issue]
- **Impact**: [Security/functionality/data integrity impact]
- **Recommendation**: [Specific fix with code example if helpful]

[Repeat for each critical issue, or state "None found ✅"]

---

## ⚠️ Warnings
**Should be addressed before merge**

### 1. [Issue Title]
- **File**: `path/to/file.ts:67`
- **Type**: [Pattern violation / Style inconsistency / Missing documentation]
- **Description**: [Clear explanation]
- **Recommendation**: [How to fix]

[Repeat for each warning, or state "None found ✅"]

---

## 💡 Suggestions
**Nice to have improvements**

### 1. [Improvement Title]
- **File**: `path/to/file.ts:89`
- **Type**: [Optimization / Best practice / Refactoring opportunity]
- **Description**: [Explanation]
- **Benefit**: [What this would improve]

[Repeat for each suggestion, or state "None"]

---

## ✨ Positive Highlights
**Well-implemented patterns worth noting**

- ✅ [Something done well with file reference]
- ✅ [Good practice followed]

---

## Final Recommendation

**Status**: [✅ Ready to Merge | ⚠️ Needs Changes | 🔴 Major Revision Required]

**Summary**: [1-2 sentence overall assessment]

**Next Steps**:
- [Action item 1]
- [Action item 2]

## Instructions
- Be thorough but constructive
- Provide specific file paths and line numbers for ALL issues — these are used to post inline comments on GitHub
- Include code examples for complex recommendations
- Prioritize security and functionality over style preferences
- Only flag pattern violations that are specific to THIS project's conventions
- Don't add generic best-practice advice — be specific to the codebase
- Acknowledge good practices to reinforce positive patterns

## Diff

{{diff}}"#
    }

    fn post_review_template() -> &'static str {
        r#"# Post-Review Style Guide

This template defines how inline review comments should be written when posting to GitHub.

## Tone & Language

- **Direct and concise** — one or two sentences max per comment. No fluff.
- **Imperative mood**: "Use X instead of Y", "Remove this", "Add error handling", "Avoid using any"
- **Skip pleasantries** — go straight to the point
- **English for all code comments**
- When something is good, say it simply: "Good use of custom hook" or "Clean separation of concerns"

## Comment Format

Each comment should be SHORT. Examples:

**One-liner directives:**
- "Avoid using `any`."
- "Use constants for colors instead of hardcoded values."
- "Add error handling for the async call."
- "This import is unused — remove it."

**Bug/inconsistency callouts (2-3 sentences max):**
- "This value is hardcoded to English, defeating the purpose of localization. Should use the current locale from i18n context."
- "After successful save, the original state is not updated, so the dirty check remains true. Reset the state after save."

**Suggesting alternatives (brief):**
- "A utility for this already exists in the codebase. Consider reusing it instead of duplicating."
- "This logic belongs in the service layer, not the controller/component."

## Priority Focus (in order)

1. **Security** — injection, auth issues, exposed secrets, missing validation
2. **Bugs** — logic errors, race conditions, missing null checks
3. **Type safety** — `any` types, unsafe casts, missing type annotations
4. **Error handling** — swallowed errors, missing validation, inconsistent patterns
5. **Code organization** — duplication, misplaced logic, separation of concerns
6. **Performance** — missing caching, unnecessary computation, N+1 queries

## What NOT to comment on

- Don't comment on things that are fine. Only comment when there's an actual issue.
- Don't write long paragraphs. If you need more than 3 sentences, you're overexplaining.
- Don't add generic best-practice advice that isn't specific to THIS codebase.
- Don't suggest adding docs/comments unless logic is genuinely confusing.
- Don't mention Claude, AI, bots, or automation in comments.
- Don't sign comments or add footers.

## Line Number Rules

- The `line` field must reference the line as it appears in the **new version** of the file (right side of the diff).
- For deleted lines, use `"side": "LEFT"` and the old line number.
- If a comment can't be mapped to a diff line, skip it."#
    }

    fn pr_description_template() -> &'static str {
        r#"# PR Description Generator

## Role
You are a senior developer writing a clear, comprehensive pull request description.

## Context
- **Branch**: {{branch}} → {{base}}
- **Commits**:
{{commits}}

## Diff
{{diff}}

## Instructions
Analyze the diff and commits above. Generate a PR description in the following markdown format. Be accurate — only describe what actually changed.

Rules:
- For checkboxes: check `[x]` only when the diff clearly demonstrates that item. Leave unchecked `[ ]` otherwise.
- For Type of Change: use emoji bullets (🐛, 🚀, 💥, 🔨, 📝, ⚡, ✅, 🔧) and ONLY list the types that apply — do not list all options.
- For User Stories: write from the end-user perspective ("As a [role], I can [action] so that [benefit]").
- For What Changed: split into "Key Changes" (high-level bullets) and "Technical Details" (implementation specifics). Include a "Files Changed" list with each file and a short description.
- For Testing: include a "How to Test" section with numbered step-by-step instructions a reviewer can follow.
- For Additional Notes: explain any non-obvious design decisions or trade-offs. Omit this section entirely if there's nothing noteworthy.
- Omit any section that would be empty or not applicable (e.g., no Breaking Changes section if there are none, no Related Issues if none are referenced in commits).

## Output Format

### 🎯 Summary
[1-3 sentence high-level summary of what this PR does and why]

### 💡 User Stories
[Bullet list of user stories this PR addresses, from the end-user perspective]

### 📋 Type of Change
[Only list the applicable types with their emoji]

### 🔍 What Changed

**Key Changes**
[High-level bullet list of the main changes]

**Technical Details**
[Implementation-specific details: patterns used, architectural decisions, algorithms]

**Files Changed**
[List each changed file with a one-line description of what changed in it]

### 🧪 Testing

**Test Coverage**
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing performed
- [ ] No tests needed (explain why)

**How to Test**
[Numbered step-by-step instructions for manual verification]

### 💥 Breaking Changes
[Describe any breaking changes and migration steps — omit section if none]

### 📝 Additional Notes
[Design decisions, trade-offs, or context that isn't obvious from the code — omit section if nothing noteworthy]

### 🔗 Related Issues
[Reference any related issues, e.g. "Closes #123", "Related to #456" — omit section if none]

### ✅ Checklist
- [ ] Code follows project conventions
- [ ] Self-review performed
- [ ] No new warnings introduced
- [ ] Changes are backward compatible"#
    }

    fn generate_report_template() -> &'static str {
        r#"Generate a detailed daily development activity report for {{date_range}}.

Below is the raw data gathered from multiple sources. Analyze it and produce a structured report with:
- Key accomplishments
- Work in progress
- Time estimates per activity (based on commit timestamps)
- PRs and code reviews
- Meetings (if any)
- Blockers

{{gathered_data}}

---

Based on all the data above, generate a structured daily activity report for {{date_range}}. Group activities by project/repo. Use calendar events as the primary source for time allocation (meetings, focus blocks). Use commit timestamps to understand what was worked on and when. Format it as a clean, professional report suitable for timesheet entry. Do NOT invent activities or meetings that aren't in the data."#
    }

    fn fill_timesheet_template() -> &'static str {
        r#"I have a daily activity report for {{date_range}}. Based on this report, please propose Kimai timesheet entries using the Kimai MCP tools.

IMPORTANT: Before creating ANY entry, show me what you plan to create and ask for my explicit confirmation. Do NOT create entries without my approval.

Here is the report:
---
{{report_content}}
---
{{existing_entries}}

Steps:
1. Check the existing Kimai entries above — do NOT create duplicates
2. Propose timesheet entries with project, activity, start/end times, and descriptions
3. List them all first, then wait for my confirmation before creating each one"#
    }

    // ── Command Runs CRUD ──

    pub fn insert_command_run(&self, run: &CommandRun) -> Result<i64, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO command_runs (command_id, parameters_json, status, result_text, error_text, duration_ms, created_at, finished_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                run.command_id, run.parameters_json, run.status,
                run.result_text, run.error_text, run.duration_ms,
                run.created_at, run.finished_at,
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn update_command_run_status(
        &self,
        id: i64,
        status: &str,
        result_text: &str,
        error_text: &str,
        duration_ms: Option<i64>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE command_runs SET status=?1, result_text=?2, error_text=?3, duration_ms=?4, finished_at=?5 WHERE id=?6",
            params![status, result_text, error_text, duration_ms, now, id],
        )?;
        Ok(())
    }

    pub fn delete_command_run(&self, id: i64) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM command_runs WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ── Invoice Profiles CRUD ──

    pub fn get_invoice_profiles(&self, profile_type: Option<&str>) -> Result<Vec<InvoiceProfile>, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let (sql, param_values): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = if let Some(pt) = profile_type {
            (
                "SELECT id, profile_type, name, tax_number, address_line1, address_line2, city, state, country, postal_code, bank_details_json, is_default, created_at, updated_at
                 FROM invoice_profiles WHERE profile_type = ? ORDER BY is_default DESC, name".to_string(),
                vec![Box::new(pt.to_string())],
            )
        } else {
            (
                "SELECT id, profile_type, name, tax_number, address_line1, address_line2, city, state, country, postal_code, bank_details_json, is_default, created_at, updated_at
                 FROM invoice_profiles ORDER BY profile_type, is_default DESC, name".to_string(),
                vec![],
            )
        };
        let params_refs: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
        let mut stmt = conn.prepare(&sql)?;
        let profiles = stmt
            .query_map(params_refs.as_slice(), |row| {
                Ok(InvoiceProfile {
                    id: Some(row.get(0)?),
                    profile_type: row.get(1)?,
                    name: row.get(2)?,
                    tax_number: row.get(3)?,
                    address_line1: row.get(4)?,
                    address_line2: row.get(5)?,
                    city: row.get(6)?,
                    state: row.get(7)?,
                    country: row.get(8)?,
                    postal_code: row.get(9)?,
                    bank_details_json: row.get(10)?,
                    is_default: row.get(11)?,
                    created_at: row.get(12)?,
                    updated_at: row.get(13)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(profiles)
    }

    pub fn insert_invoice_profile(&self, profile: &InvoiceProfile) -> Result<i64, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        // If setting as default, clear other defaults of same type
        if profile.is_default {
            conn.execute(
                "UPDATE invoice_profiles SET is_default = 0 WHERE profile_type = ?1",
                params![profile.profile_type],
            )?;
        }
        conn.execute(
            "INSERT INTO invoice_profiles (profile_type, name, tax_number, address_line1, address_line2, city, state, country, postal_code, bank_details_json, is_default, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                profile.profile_type, profile.name, profile.tax_number,
                profile.address_line1, profile.address_line2, profile.city,
                profile.state, profile.country, profile.postal_code,
                profile.bank_details_json, profile.is_default, now, now,
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn update_invoice_profile(&self, profile: &InvoiceProfile) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        if profile.is_default {
            conn.execute(
                "UPDATE invoice_profiles SET is_default = 0 WHERE profile_type = ?1 AND id != ?2",
                params![profile.profile_type, profile.id],
            )?;
        }
        conn.execute(
            "UPDATE invoice_profiles SET name=?1, tax_number=?2, address_line1=?3, address_line2=?4, city=?5, state=?6, country=?7, postal_code=?8, bank_details_json=?9, is_default=?10, updated_at=?11 WHERE id=?12",
            params![
                profile.name, profile.tax_number, profile.address_line1,
                profile.address_line2, profile.city, profile.state,
                profile.country, profile.postal_code, profile.bank_details_json,
                profile.is_default, now, profile.id,
            ],
        )?;
        Ok(())
    }

    pub fn delete_invoice_profile(&self, id: i64) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM invoice_profiles WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ── Invoices CRUD ──

    pub fn get_invoices(&self, limit: i64) -> Result<Vec<Invoice>, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, invoice_number, sender_profile_id, recipient_profile_id, invoice_date, due_date, currency, line_items_json, subtotal, tax_rate, tax_amount, total, notes, status, created_at, updated_at
             FROM invoices ORDER BY created_at DESC LIMIT ?1"
        )?;
        let invoices = stmt
            .query_map(params![limit], |row| {
                Ok(Invoice {
                    id: Some(row.get(0)?),
                    invoice_number: row.get(1)?,
                    sender_profile_id: row.get(2)?,
                    recipient_profile_id: row.get(3)?,
                    invoice_date: row.get(4)?,
                    due_date: row.get(5)?,
                    currency: row.get(6)?,
                    line_items_json: row.get(7)?,
                    subtotal: row.get(8)?,
                    tax_rate: row.get(9)?,
                    tax_amount: row.get(10)?,
                    total: row.get(11)?,
                    notes: row.get(12)?,
                    status: row.get(13)?,
                    created_at: row.get(14)?,
                    updated_at: row.get(15)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(invoices)
    }

    pub fn get_invoice(&self, id: i64) -> Result<Option<Invoice>, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT id, invoice_number, sender_profile_id, recipient_profile_id, invoice_date, due_date, currency, line_items_json, subtotal, tax_rate, tax_amount, total, notes, status, created_at, updated_at
             FROM invoices WHERE id = ?1",
            params![id],
            |row| {
                Ok(Invoice {
                    id: Some(row.get(0)?),
                    invoice_number: row.get(1)?,
                    sender_profile_id: row.get(2)?,
                    recipient_profile_id: row.get(3)?,
                    invoice_date: row.get(4)?,
                    due_date: row.get(5)?,
                    currency: row.get(6)?,
                    line_items_json: row.get(7)?,
                    subtotal: row.get(8)?,
                    tax_rate: row.get(9)?,
                    tax_amount: row.get(10)?,
                    total: row.get(11)?,
                    notes: row.get(12)?,
                    status: row.get(13)?,
                    created_at: row.get(14)?,
                    updated_at: row.get(15)?,
                })
            },
        );
        match result {
            Ok(inv) => Ok(Some(inv)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(Box::new(e)),
        }
    }

    pub fn insert_invoice(&self, invoice: &Invoice) -> Result<i64, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO invoices (invoice_number, sender_profile_id, recipient_profile_id, invoice_date, due_date, currency, line_items_json, subtotal, tax_rate, tax_amount, total, notes, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                invoice.invoice_number, invoice.sender_profile_id, invoice.recipient_profile_id,
                invoice.invoice_date, invoice.due_date, invoice.currency,
                invoice.line_items_json, invoice.subtotal, invoice.tax_rate,
                invoice.tax_amount, invoice.total, invoice.notes,
                invoice.status, now, now,
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn update_invoice(&self, invoice: &Invoice) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE invoices SET invoice_number=?1, sender_profile_id=?2, recipient_profile_id=?3, invoice_date=?4, due_date=?5, currency=?6, line_items_json=?7, subtotal=?8, tax_rate=?9, tax_amount=?10, total=?11, notes=?12, status=?13, updated_at=?14 WHERE id=?15",
            params![
                invoice.invoice_number, invoice.sender_profile_id, invoice.recipient_profile_id,
                invoice.invoice_date, invoice.due_date, invoice.currency,
                invoice.line_items_json, invoice.subtotal, invoice.tax_rate,
                invoice.tax_amount, invoice.total, invoice.notes,
                invoice.status, now, invoice.id,
            ],
        )?;
        Ok(())
    }

    pub fn delete_invoice(&self, id: i64) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM invoices WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get_command_runs(&self, command_id: Option<i64>, limit: i64) -> Result<Vec<CommandRun>, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let (sql, param_values): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = if let Some(cid) = command_id {
            (
                "SELECT id, command_id, parameters_json, status, result_text, error_text, duration_ms, created_at, finished_at
                 FROM command_runs WHERE command_id = ? ORDER BY created_at DESC LIMIT ?".to_string(),
                vec![Box::new(cid), Box::new(limit)],
            )
        } else {
            (
                "SELECT id, command_id, parameters_json, status, result_text, error_text, duration_ms, created_at, finished_at
                 FROM command_runs ORDER BY created_at DESC LIMIT ?".to_string(),
                vec![Box::new(limit)],
            )
        };
        let params_refs: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
        let mut stmt = conn.prepare(&sql)?;
        let runs = stmt
            .query_map(params_refs.as_slice(), |row| {
                Ok(CommandRun {
                    id: Some(row.get(0)?),
                    command_id: row.get(1)?,
                    parameters_json: row.get(2)?,
                    status: row.get(3)?,
                    result_text: row.get(4)?,
                    error_text: row.get(5)?,
                    duration_ms: row.get(6)?,
                    created_at: row.get(7)?,
                    finished_at: row.get(8)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(runs)
    }

    // ── Activity Mappings CRUD ──

    pub fn get_activity_mappings(&self) -> Result<Vec<ActivityMapping>, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, description, pattern, pattern_type, kimai_project_id, kimai_project_name, kimai_activity_id, kimai_activity_name, kimai_tags, priority, enabled, created_at, updated_at
             FROM activity_mappings ORDER BY priority DESC, name"
        )?;
        let mappings = stmt
            .query_map([], |row| {
                Ok(ActivityMapping {
                    id: Some(row.get(0)?),
                    name: row.get(1)?,
                    description: row.get(2)?,
                    pattern: row.get(3)?,
                    pattern_type: row.get(4)?,
                    kimai_project_id: row.get(5)?,
                    kimai_project_name: row.get(6)?,
                    kimai_activity_id: row.get(7)?,
                    kimai_activity_name: row.get(8)?,
                    kimai_tags: row.get(9)?,
                    priority: row.get(10)?,
                    enabled: row.get(11)?,
                    created_at: row.get(12)?,
                    updated_at: row.get(13)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(mappings)
    }

    pub fn save_activity_mapping(&self, mapping: &ActivityMapping) -> Result<i64, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        if let Some(id) = mapping.id {
            conn.execute(
                "UPDATE activity_mappings SET name=?1, description=?2, pattern=?3, pattern_type=?4, kimai_project_id=?5, kimai_project_name=?6, kimai_activity_id=?7, kimai_activity_name=?8, kimai_tags=?9, priority=?10, enabled=?11, updated_at=?12 WHERE id=?13",
                params![
                    mapping.name, mapping.description, mapping.pattern, mapping.pattern_type,
                    mapping.kimai_project_id, mapping.kimai_project_name,
                    mapping.kimai_activity_id, mapping.kimai_activity_name,
                    mapping.kimai_tags, mapping.priority, mapping.enabled, now, id,
                ],
            )?;
            Ok(id)
        } else {
            conn.execute(
                "INSERT INTO activity_mappings (name, description, pattern, pattern_type, kimai_project_id, kimai_project_name, kimai_activity_id, kimai_activity_name, kimai_tags, priority, enabled, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                params![
                    mapping.name, mapping.description, mapping.pattern, mapping.pattern_type,
                    mapping.kimai_project_id, mapping.kimai_project_name,
                    mapping.kimai_activity_id, mapping.kimai_activity_name,
                    mapping.kimai_tags, mapping.priority, mapping.enabled, now, now,
                ],
            )?;
            Ok(conn.last_insert_rowid())
        }
    }

    pub fn delete_activity_mapping(&self, id: i64) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM activity_mappings WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ── Autofill Runs CRUD ──

    pub fn get_autofill_runs(&self, limit: i64) -> Result<Vec<AutofillRun>, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, target_date, status, result_text, error_text, entries_created, duration_ms, created_at, finished_at
             FROM autofill_runs ORDER BY created_at DESC LIMIT ?1"
        )?;
        let runs = stmt
            .query_map(params![limit], |row| {
                Ok(AutofillRun {
                    id: Some(row.get(0)?),
                    target_date: row.get(1)?,
                    status: row.get(2)?,
                    result_text: row.get(3)?,
                    error_text: row.get(4)?,
                    entries_created: row.get(5)?,
                    duration_ms: row.get(6)?,
                    created_at: row.get(7)?,
                    finished_at: row.get(8)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(runs)
    }

    pub fn create_autofill_run(&self, target_date: &str) -> Result<i64, Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO autofill_runs (target_date, status, created_at) VALUES (?1, 'running', ?2)",
            params![target_date, now],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn update_autofill_run(
        &self,
        id: i64,
        status: &str,
        result_text: &str,
        error_text: &str,
        entries_created: i64,
        duration_ms: Option<i64>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE autofill_runs SET status=?1, result_text=?2, error_text=?3, entries_created=?4, duration_ms=?5, finished_at=?6 WHERE id=?7",
            params![status, result_text, error_text, entries_created, duration_ms, now, id],
        )?;
        Ok(())
    }
}
