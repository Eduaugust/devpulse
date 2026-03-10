import { useState, useEffect, useCallback } from "react";
import { useConnectionStore } from "@/stores/connectionStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { ConnectionCard } from "@/components/ConnectionCard";
import { getCredentialStore, setCredential } from "@/lib/credentials";
import { authorizeCalendar, cancelCalendarAuth } from "@/lib/tauri";
import { Github, Gitlab, Cloud, Timer, Calendar, Bot, Terminal } from "lucide-react";

export function Connections() {
  const { github, gitlab, azure, bitbucket, kimai, calendar, claude, claudeCli, checkGitHub, checkGitLab, checkAzure, checkBitbucket, checkKimai, checkCalendar, checkClaude, checkClaudeCli } =
    useConnectionStore();
  const { getSetting, updateSetting, fetchSettings } = useSettingsStore();

  const isEnabled = (key: string) => getSetting(`conn_${key}`, "true") === "true";
  const toggleConn = (key: string) =>
    updateSetting(`conn_${key}`, isEnabled(key) ? "false" : "true");

  const [kimaiUrl, setKimaiUrl] = useState("");
  const [kimaiToken, setKimaiToken] = useState("");
  const [calendarCreds, setCalendarCreds] = useState("");
  const [calendarEmail, setCalendarEmail] = useState("");
  const [calendarCredsVisible, setCalendarCredsVisible] = useState(false);
  const [calendarAuthorizing, setCalendarAuthorizing] = useState(false);
  const [claudeKey, setClaudeKey] = useState("");
  const [bbUsername, setBbUsername] = useState("");
  const [bbAppPassword, setBbAppPassword] = useState("");
  const [bbWorkspace, setBbWorkspace] = useState("");

  const loadCredentials = useCallback(async () => {
    try {
      const store = await getCredentialStore();
      setKimaiUrl(((await store.get<string>("kimai_url")) as string) ?? "");
      setKimaiToken(((await store.get<string>("kimai_token")) as string) ?? "");
      setCalendarCreds(
        ((await store.get<string>("calendar_credentials")) as string) ?? "",
      );
      setClaudeKey(
        ((await store.get<string>("claude_api_key")) as string) ?? "",
      );
      setCalendarEmail(
        ((await store.get<string>("calendar_email")) as string) ?? "",
      );
      setBbUsername(((await store.get<string>("bb_username")) as string) ?? "");
      setBbAppPassword(((await store.get<string>("bb_app_password")) as string) ?? "");
      setBbWorkspace(((await store.get<string>("bb_workspace")) as string) ?? "");
    } catch {
      // Store might not exist yet
    }
  }, []);

  useEffect(() => {
    loadCredentials();
    fetchSettings();
  }, [loadCredentials, fetchSettings]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold mb-1">Connections</h2>
        <p className="text-sm text-muted-foreground">
          Configure and test your integrations
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ConnectionCard
          title="GitHub CLI"
          description="Uses gh CLI for authentication"
          icon={<Github className="h-4 w-4" />}
          status={github}
          enabled={isEnabled("github")}
          onToggle={() => toggleConn("github")}
          onTest={checkGitHub}
        >
          <p className="text-[10px] text-muted-foreground">
            Requires <code className="bg-secondary px-1 rounded">gh auth login</code> to be configured
          </p>
        </ConnectionCard>

        <ConnectionCard
          title="GitLab CLI"
          description="Uses glab CLI for authentication"
          icon={<Gitlab className="h-4 w-4" />}
          status={gitlab}
          enabled={isEnabled("gitlab")}
          onToggle={() => toggleConn("gitlab")}
          onTest={checkGitLab}
        >
          <p className="text-[10px] text-muted-foreground">
            Requires <code className="bg-secondary px-1 rounded">glab auth login</code> to be configured
          </p>
        </ConnectionCard>

        <ConnectionCard
          title="Azure DevOps"
          description="Uses az CLI with devops extension"
          icon={<Cloud className="h-4 w-4" />}
          status={azure}
          enabled={isEnabled("azure")}
          onToggle={() => toggleConn("azure")}
          onTest={checkAzure}
        >
          <p className="text-[10px] text-muted-foreground">
            Requires <code className="bg-secondary px-1 rounded">az devops login</code> to be configured
          </p>
        </ConnectionCard>

        <ConnectionCard
          title="Bitbucket"
          description="REST API with App Password"
          icon={<Github className="h-4 w-4" />}
          status={bitbucket}
          enabled={isEnabled("bitbucket")}
          onToggle={() => toggleConn("bitbucket")}
          onTest={async () => {
            await setCredential("bb_username", bbUsername);
            await setCredential("bb_app_password", bbAppPassword);
            await setCredential("bb_workspace", bbWorkspace || bbUsername);
            await checkBitbucket();
          }}
        >
          <input
            type="text"
            placeholder="Bitbucket username"
            value={bbUsername}
            onChange={(e) => setBbUsername(e.target.value)}
            className="w-full px-2 py-1 text-xs rounded border bg-background"
          />
          <input
            type="password"
            placeholder="App Password"
            value={bbAppPassword}
            onChange={(e) => setBbAppPassword(e.target.value)}
            className="w-full px-2 py-1 text-xs rounded border bg-background"
          />
          <input
            type="text"
            placeholder="Workspace (leave empty = username)"
            value={bbWorkspace}
            onChange={(e) => setBbWorkspace(e.target.value)}
            className="w-full px-2 py-1 text-xs rounded border bg-background"
          />
        </ConnectionCard>

        <ConnectionCard
          title="Kimai"
          description="Time tracking integration"
          icon={<Timer className="h-4 w-4" />}
          status={kimai}
          enabled={isEnabled("kimai")}
          onToggle={() => toggleConn("kimai")}
          onTest={async () => {
            await setCredential("kimai_url", kimaiUrl);
            await setCredential("kimai_token", kimaiToken);
            await checkKimai();
          }}
        >
          <input
            type="text"
            placeholder="Kimai URL (e.g., https://kimai.example.com)"
            value={kimaiUrl}
            onChange={(e) => setKimaiUrl(e.target.value)}
            className="w-full px-2 py-1 text-xs rounded border bg-background"
          />
          <input
            type="password"
            placeholder="API Token"
            value={kimaiToken}
            onChange={(e) => setKimaiToken(e.target.value)}
            className="w-full px-2 py-1 text-xs rounded border bg-background"
          />
        </ConnectionCard>

        <ConnectionCard
          title="Google Calendar"
          description="Calendar event integration"
          icon={<Calendar className="h-4 w-4" />}
          status={calendar}
          enabled={isEnabled("calendar")}
          onToggle={() => toggleConn("calendar")}
          onTest={async () => {
            await setCredential("calendar_credentials", calendarCreds);
            await setCredential("calendar_email", calendarEmail);
            setCalendarCredsVisible(false);
            await checkCalendar();
          }}
        >
          <input
            type="email"
            placeholder="Calendar email (leave empty for primary)"
            value={calendarEmail}
            onChange={(e) => setCalendarEmail(e.target.value)}
            className="w-full px-2 py-1 text-xs rounded border bg-background"
          />
          {calendarCreds && !calendarCredsVisible ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground flex-1 truncate font-mono">
                {"•".repeat(32)}
              </span>
              {calendarAuthorizing ? (
                <button
                  type="button"
                  onClick={async () => {
                    await cancelCalendarAuth();
                  }}
                  className="text-[10px] text-destructive hover:text-destructive/80 shrink-0 font-medium"
                >
                  Cancel
                </button>
              ) : calendar.message?.includes("OAuth client config") ? (
                <button
                  type="button"
                  onClick={async () => {
                    setCalendarAuthorizing(true);
                    try {
                      const authorizedCreds = await authorizeCalendar(calendarCreds);
                      setCalendarCreds(authorizedCreds);
                      await setCredential("calendar_credentials", authorizedCreds);
                      await checkCalendar();
                    } catch (e) {
                      useConnectionStore.setState({
                        calendar: { status: "disconnected", message: String(e) },
                      });
                    } finally {
                      setCalendarAuthorizing(false);
                    }
                  }}
                  className="text-[10px] text-blue-500 hover:text-blue-400 shrink-0 font-medium"
                >
                  Authorize
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setCalendarCredsVisible(true)}
                className="text-[10px] text-muted-foreground hover:text-foreground shrink-0"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={async () => {
                  setCalendarCreds("");
                  setCalendarCredsVisible(false);
                  await setCredential("calendar_credentials", "");
                  await checkCalendar();
                }}
                className="text-[10px] text-destructive hover:text-destructive/80 shrink-0"
              >
                Clear
              </button>
            </div>
          ) : (
            <textarea
              placeholder="Paste OAuth client JSON from Google Cloud Console..."
              value={calendarCreds}
              onChange={(e) => setCalendarCreds(e.target.value)}
              className="w-full px-2 py-1 text-xs rounded border bg-background h-16 resize-none font-mono"
            />
          )}
        </ConnectionCard>

        <ConnectionCard
          title="Claude API"
          description="AI-powered report generation"
          icon={<Bot className="h-4 w-4" />}
          status={claude}
          enabled={isEnabled("claude")}
          onToggle={() => toggleConn("claude")}
          onTest={async () => {
            await setCredential("claude_api_key", claudeKey);
            await checkClaude();
          }}
        >
          <input
            type="password"
            placeholder="Anthropic API Key (sk-ant-...)"
            value={claudeKey}
            onChange={(e) => setClaudeKey(e.target.value)}
            className="w-full px-2 py-1 text-xs rounded border bg-background"
          />
        </ConnectionCard>

        <ConnectionCard
          title="Claude CLI"
          description="Claude Code terminal integration"
          icon={<Terminal className="h-4 w-4" />}
          status={claudeCli}
          enabled={isEnabled("claude_cli")}
          onToggle={() => toggleConn("claude_cli")}
          onTest={checkClaudeCli}
        >
          <p className="text-[10px] text-muted-foreground">
            Requires <code className="bg-secondary px-1 rounded">claude</code> to be installed and in PATH
          </p>
        </ConnectionCard>
      </div>
    </div>
  );
}
