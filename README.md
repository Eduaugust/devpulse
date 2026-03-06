<p align="center">
  <img src="src-tauri/icons/icon.png" alt="DevPulse" width="128" height="128" />
</p>

<h1 align="center">DevPulse</h1>

<p align="center">
  Developer activity dashboard — GitHub monitoring, AI-powered PR reviews, and automated timesheets.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-v2-blue?logo=tauri" alt="Tauri v2" />
  <img src="https://img.shields.io/badge/React-19-blue?logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/Rust-2021-orange?logo=rust" alt="Rust 2021" />
  <img src="https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript" alt="TypeScript" />
</p>

---

## Overview

DevPulse is a cross-platform desktop application built with [Tauri v2](https://v2.tauri.app/) that centralizes your developer workflow. It monitors GitHub activity in real-time, automates PR reviews with AI, tracks time via Kimai, syncs with Google Calendar, and generates daily reports — all from your system tray.

### Key Features

- **Real-time GitHub Monitoring** — Track PRs, reviews, mentions, and notifications across multiple repositories with desktop notifications
- **AI-Powered PR Reviews** — Automatic code review using Claude CLI or API with inline findings, auto-posting to GitHub, and one-click fix generation
- **Auto PR Descriptions** — Automatically generate PR descriptions when you create a PR with an empty body
- **Time Tracking Integration** — Connect to Kimai for seamless timesheet management
- **Google Calendar Sync** — View calendar events alongside your development activity
- **Report Generation** — Generate structured daily activity reports from Git commits, GitHub PRs, Kimai entries, and calendar events
- **Custom Commands** — Create and run custom Claude-powered workflows (e.g., changelog generation, release notes)
- **System Tray** — Quick-access panel with activity overview without leaving your workflow
- **Cross-Platform** — Runs on macOS, Windows, and Linux

---

## Tech Stack

| Layer    | Technology                                              |
| -------- | ------------------------------------------------------- |
| Frontend | React 19, TypeScript 5.8, Vite 7, Tailwind CSS 4       |
| Backend  | Rust (2021 edition), Tauri v2, Tokio, SQLite (rusqlite) |
| State    | Zustand                                                 |
| AI       | Claude CLI / Anthropic API                              |
| Icons    | Lucide React                                            |

---

## Prerequisites

Before installing DevPulse, make sure you have the following tools:

| Tool                                        | Version  | Purpose                    |
| ------------------------------------------- | -------- | -------------------------- |
| [Node.js](https://nodejs.org/)              | >= 18    | Frontend build             |
| [pnpm](https://pnpm.io/)                   | >= 9     | Package manager            |
| [Rust](https://rustup.rs/)                  | >= 1.77  | Backend compilation        |
| [GitHub CLI](https://cli.github.com/)       | >= 2.0   | GitHub integration         |
| [Claude CLI](https://claude.ai/claude-code) | optional | AI-powered features        |

### Platform-Specific Dependencies

<details>
<summary><strong>macOS</strong></summary>

Xcode Command Line Tools (usually already installed):

```bash
xcode-select --install
```

</details>

<details>
<summary><strong>Windows</strong></summary>

- [Microsoft Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (pre-installed on Windows 10/11)

Install via winget:

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools"
```

</details>

<details>
<summary><strong>Linux</strong></summary>

Debian/Ubuntu:

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

Fedora:

```bash
sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file \
  libxdo-devel libappindicator-gtk3-devel librsvg2-devel
sudo dnf group install "C Development Tools and Libraries"
```

Arch:

```bash
sudo pacman -S webkit2gtk-4.1 base-devel curl wget file openssl \
  appmenu-gtk-module libappindicator-gtk3 librsvg
```

</details>

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/Eduaugust/devpulse.git
cd devpulse
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Run in development mode

```bash
pnpm tauri dev
```

### 4. Build for production

```bash
pnpm tauri build
```

The compiled binary will be in `src-tauri/target/release/bundle/`.

| Platform | Output                                        |
| -------- | --------------------------------------------- |
| macOS    | `.dmg` and `.app` in `bundle/dmg/`            |
| Windows  | `.msi` and `.exe` in `bundle/msi/` and `nsis/`|
| Linux    | `.deb` and `.AppImage` in `bundle/deb/`        |

---

## Configuration

After launching DevPulse, go to the **Connections** page to configure your integrations.

### GitHub CLI

DevPulse uses the [GitHub CLI](https://cli.github.com/) (`gh`) for all GitHub interactions.

1. Install the GitHub CLI:

   ```bash
   # macOS
   brew install gh

   # Windows
   winget install GitHub.cli

   # Linux (Debian/Ubuntu)
   sudo apt install gh
   ```

2. Authenticate:

   ```bash
   gh auth login
   ```

3. In DevPulse, go to **Connections** and click **Test** on the GitHub card — it should show "Connected".

4. Go to **Settings** and add the repositories you want to monitor.

---

### Kimai (Time Tracking)

[Kimai](https://www.kimai.org/) is an open-source time tracking application.

1. Log in to your Kimai instance.
2. Go to your profile (top-right menu) → **API Access** (or navigate to `/en/profile/<username>/api-token`).
3. Create a new API token.
4. In DevPulse **Connections**, fill in:
   - **Kimai URL** — Your instance URL (e.g., `https://kimai.example.com`)
   - **API Token** — The token you just created
5. Click **Test** to verify.

---

### Google Calendar

DevPulse connects to Google Calendar via OAuth 2.0. You need to create credentials in Google Cloud Console.

#### Step 1 — Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click the project selector (top-left) → **New Project**
3. Name it (e.g., "DevPulse") and click **Create**

#### Step 2 — Enable the Calendar API

1. In your project, go to **APIs & Services** → **Library**
2. Search for **"Google Calendar API"**
3. Click on it and press **Enable**

#### Step 3 — Configure OAuth Consent Screen

1. Go to **APIs & Services** → **OAuth consent screen**
2. Select **External** user type (or Internal if using Google Workspace)
3. Fill in the required fields (App name, User support email, Developer contact)
4. On the **Scopes** step, add:
   - `https://www.googleapis.com/auth/calendar.readonly`
5. On **Test users**, add your own Google email
6. Click **Save and Continue** through the remaining steps

#### Step 4 — Create OAuth Credentials

1. Go to **APIs & Services** → **Credentials**
2. Click **+ Create Credentials** → **OAuth client ID**
3. Application type: **Desktop app**
4. Name it (e.g., "DevPulse Desktop")
5. Click **Create**
6. **Download the JSON** file (click the download icon)

#### Step 5 — Add to DevPulse

1. Open the downloaded JSON file in a text editor
2. Copy the entire JSON content
3. In DevPulse **Connections**, paste it into the Google Calendar textarea
4. Click **Test** — you'll see a message about OAuth client config
5. Click **Authorize** — a browser window will open for Google sign-in
6. Sign in and grant calendar access
7. The status should change to "Connected"

> **Note:** The OAuth tokens are stored locally and refresh automatically. You only need to authorize once.

---

### Claude API

DevPulse supports two AI modes:

#### Option A — Claude CLI (Recommended)

If you have [Claude CLI](https://claude.ai/claude-code) installed and authenticated, DevPulse will use it automatically. No additional configuration needed.

```bash
# Install Claude CLI
npm install -g @anthropic-ai/claude-code

# Authenticate
claude
```

#### Option B — Anthropic API Key

For direct API access (used as fallback or when Claude CLI is unavailable):

1. Go to [Anthropic Console](https://console.anthropic.com/) → **API Keys**
2. Create a new API key
3. In DevPulse **Connections**, paste the key (starts with `sk-ant-...`)
4. Click **Test** to verify

You can choose the default AI provider in **Settings** → **AI Provider**.

---

## Project Structure

```
devpulse/
├── src/                          # React frontend
│   ├── components/               # Reusable UI components
│   ├── pages/                    # Route pages
│   │   ├── Dashboard.tsx         # Activity overview
│   │   ├── History.tsx           # Event history with filters
│   │   ├── ClaudeCode.tsx        # Claude terminal launcher
│   │   ├── PrReview.tsx          # AI-powered PR reviews
│   │   ├── Commands.tsx          # Custom command runner
│   │   ├── Connections.tsx       # Integration setup
│   │   ├── Settings.tsx          # App configuration
│   │   └── ReportGenerator.tsx   # Daily report builder
│   ├── stores/                   # Zustand state stores
│   ├── hooks/                    # React hooks
│   ├── lib/                      # Utilities and helpers
│   └── main.tsx                  # App entry point
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── commands/             # Tauri command handlers
│   │   │   ├── github.rs         # GitHub CLI integration
│   │   │   ├── kimai.rs          # Kimai API
│   │   │   ├── calendar.rs       # Google Calendar OAuth
│   │   │   ├── claude.rs         # Claude AI integration
│   │   │   ├── db.rs             # Database operations
│   │   │   └── system.rs         # System utilities
│   │   ├── lib.rs                # App setup and plugin init
│   │   ├── monitor.rs            # Background activity monitor
│   │   ├── db.rs                 # SQLite schema and queries
│   │   ├── tray.rs               # System tray management
│   │   └── terminal.rs           # Terminal launcher
│   ├── icons/                    # App icons (all platforms)
│   ├── capabilities/             # Tauri permission definitions
│   ├── Cargo.toml                # Rust dependencies
│   └── tauri.conf.json           # Tauri configuration
├── package.json
├── vite.config.ts
├── tsconfig.json
└── tailwind.config.ts
```

---

## Development

### Running

```bash
# Start dev server with hot-reload
pnpm tauri dev
```

### Type Checking

```bash
# Frontend
npx tsc --noEmit

# Backend
cargo check --manifest-path src-tauri/Cargo.toml
```

### Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) with:
  - [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) — Tauri commands and debugging
  - [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer) — Rust language support

---

## Git Workflow

This project uses a branch-based workflow:

| Branch                | Purpose                                 |
| --------------------- | --------------------------------------- |
| `main`                | Stable releases                         |
| `development`         | Integration branch for active work      |
| `feat/<description>`  | New features                            |
| `fix/<description>`   | Bug fixes                               |
| `refactor/<description>` | Code refactoring                     |
| `hotfix/<description>` | Urgent production fixes                |

### Commit Convention

Commits use [Gitmoji](https://gitmoji.dev/) followed by a type and description:

```
:emoji: type: description
```

Examples:

```
:sparkles: feat: add auto-review toggle to settings
:bug: fix: resolve race condition in monitor polling
:recycle: refactor: extract credential helpers to shared module
:memo: docs: add Google Calendar setup instructions
:white_check_mark: test: add unit tests for PR review parser
:art: style: improve sidebar layout consistency
```

---

## License

Private — All rights reserved.
