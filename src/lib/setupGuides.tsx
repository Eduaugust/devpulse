import type { ReactNode } from "react";

const URL_RE = /(https?:\/\/[^\s)]+)/g;

export function renderStep(text: string): ReactNode {
  const parts = text.split(URL_RE);
  return parts.map((part, i) =>
    URL_RE.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-500 hover:underline break-all"
      >
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export const setupGuides: Record<string, { title: string; steps: string[] }> = {
  github: {
    title: "GitHub CLI Setup",
    steps: [
      "Install the GitHub CLI: brew install gh (macOS) or visit https://cli.github.com",
      "Run gh auth login in your terminal",
      "Follow the prompts to authenticate via browser",
      "Verify with gh auth status",
    ],
  },
  gitlab: {
    title: "GitLab CLI Setup",
    steps: [
      "Install the GitLab CLI: brew install glab (macOS) or visit https://gitlab.com/gitlab-org/cli",
      "Run glab auth login in your terminal",
      "Choose your GitLab instance and authenticate",
      "Verify with glab auth status",
    ],
  },
  azure: {
    title: "Azure DevOps Setup",
    steps: [
      "Install Azure CLI: brew install azure-cli (macOS) or visit https://aka.ms/install-azure-cli",
      "Install the DevOps extension: az extension add --name azure-devops",
      "Login with az login",
      "Configure defaults: az devops configure --defaults organization=https://dev.azure.com/YOUR_ORG project=YOUR_PROJECT",
    ],
  },
  bitbucket: {
    title: "Bitbucket Setup",
    steps: [
      "Go to Bitbucket Settings → App passwords (https://bitbucket.org/account/settings/app-passwords/)",
      "Click Create app password",
      "Grant permissions: Repositories (Read), Pull requests (Read)",
      "Copy the generated password and paste it in the App Password field",
      "Enter your Bitbucket username",
    ],
  },
  kimai: {
    title: "Kimai Setup",
    steps: [
      "Open your Kimai instance in the browser",
      "Go to your profile settings (click your avatar → Settings)",
      "Navigate to the API section",
      "Copy the API token and your Kimai base URL",
      "Paste the URL (e.g., https://kimai.example.com) and token in the fields",
    ],
  },
  calendar: {
    title: "Google Calendar Setup",
    steps: [
      "Go to Google Cloud Console (https://console.cloud.google.com)",
      "Create a project or select an existing one",
      "Enable the Google Calendar API in APIs & Services → Library",
      "Go to APIs & Services → Credentials → Create Credentials → OAuth client ID",
      "Choose Desktop app as application type",
      "Download the JSON file and paste its contents in the field",
      "Click Test Connection, then Authorize to complete the OAuth flow",
    ],
  },
  claude: {
    title: "Claude API Setup",
    steps: [
      "Go to https://console.anthropic.com",
      "Sign in or create an account",
      "Navigate to API Keys and create a new key",
      "Copy the key (starts with sk-ant-...) and paste it in the field",
    ],
  },
  claude_cli: {
    title: "Claude CLI Setup",
    steps: [
      "Install Claude Code: npm install -g @anthropic-ai/claude-code",
      "Run claude in your terminal to verify the installation",
      "Follow the authentication prompts if needed",
      "Ensure claude is available in your PATH",
    ],
  },
};
