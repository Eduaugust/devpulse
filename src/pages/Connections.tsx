import { useState, useEffect, useCallback, useMemo } from "react";
import { useConnectionStore } from "@/stores/connectionStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { ConnectionCard } from "@/components/ConnectionCard";
import { SetupHelpModal } from "@/components/SetupHelpModal";
import { getCredentialStore, setCredential } from "@/lib/credentials";
import { authorizeCalendar, cancelCalendarAuth, setupKimaiMcp } from "@/lib/tauri";
import { Github, Gitlab, Cloud, Timer, Calendar, Bot, Terminal, Plus } from "lucide-react";

const standardConnections = [
  { key: "github", label: "GitHub CLI" },
  { key: "gitlab", label: "GitLab CLI" },
  { key: "azure", label: "Azure DevOps" },
  { key: "bitbucket", label: "Bitbucket" },
  { key: "kimai", label: "Kimai" },
  { key: "calendar", label: "Google Calendar" },
  { key: "claude_cli", label: "Claude CLI" },
] as const;

const betaConnections = [
  { key: "claude", label: "Claude API" },
] as const;

const allConnections = [...standardConnections, ...betaConnections] as const;

type ConnectionKey = (typeof allConnections)[number]["key"];

const betaRoutes = new Set(["/dashboard", "/history", "/claude-code", "/pr-review", "/commands"]);

export function Connections() {
  const { github, gitlab, azure, bitbucket, kimai, calendar, claude, claudeCli, checkGitHub, checkGitLab, checkAzure, checkBitbucket, checkKimai, checkCalendar, checkClaude, checkClaudeCli } =
    useConnectionStore();
  const { fetchSettings, getSetting, updateSetting } = useSettingsStore();

  const [helpKey, setHelpKey] = useState<string | null>(null);
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
  const [showAddMenu, setShowAddMenu] = useState(false);

  const betaEnabled = useMemo(
    () => Array.from(betaRoutes).some(
      (route) => getSetting(`sidebar_visible_${route}`, "true") === "true",
    ),
    [getSetting],
  );

  // Connections available in current mode (standard + beta if enabled)
  const availableConnections = useMemo(
    () => betaEnabled ? allConnections : standardConnections,
    [betaEnabled],
  );

  const visibleKeys = useMemo(() => {
    const keys = new Set<ConnectionKey>();
    for (const { key } of availableConnections) {
      if (getSetting(`connection_visible_${key}`, "true") === "true") {
        keys.add(key);
      }
    }
    return keys;
  }, [getSetting, availableConnections]);

  const hiddenConnections = useMemo(
    () => availableConnections.filter(({ key }) => !visibleKeys.has(key)),
    [visibleKeys, availableConnections],
  );

  const checkFnMap: Record<ConnectionKey, () => Promise<void>> = useMemo(() => ({
    github: checkGitHub,
    gitlab: checkGitLab,
    azure: checkAzure,
    bitbucket: checkBitbucket,
    kimai: checkKimai,
    calendar: checkCalendar,
    claude: checkClaude,
    claude_cli: checkClaudeCli,
  }), [checkGitHub, checkGitLab, checkAzure, checkBitbucket, checkKimai, checkCalendar, checkClaude, checkClaudeCli]);

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

  // Auto-check all visible connections on mount
  const [autoChecked, setAutoChecked] = useState(false);
  useEffect(() => {
    if (autoChecked) return;
    setAutoChecked(true);
    for (const key of visibleKeys) {
      checkFnMap[key]().catch(() => {});
    }
  }, [autoChecked, visibleKeys, checkFnMap]);

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
        {visibleKeys.has("github") && (
          <ConnectionCard
            title="GitHub CLI"
            description="Uses gh CLI for authentication"
            icon={<Github className="h-4 w-4" />}
            status={github}
            onTest={checkGitHub}
            onHelp={() => setHelpKey("github")}
          >
            <p className="text-[10px] text-muted-foreground">
              Requires <code className="bg-secondary px-1 rounded">gh auth login</code> to be configured
            </p>
          </ConnectionCard>
        )}

        {visibleKeys.has("gitlab") && (
          <ConnectionCard
            title="GitLab CLI"
            description="Uses glab CLI for authentication"
            icon={<Gitlab className="h-4 w-4" />}
            status={gitlab}
            onTest={checkGitLab}
            onHelp={() => setHelpKey("gitlab")}
          >
            <p className="text-[10px] text-muted-foreground">
              Requires <code className="bg-secondary px-1 rounded">glab auth login</code> to be configured
            </p>
          </ConnectionCard>
        )}

        {visibleKeys.has("azure") && (
          <ConnectionCard
            title="Azure DevOps"
            description="Uses az CLI with devops extension"
            icon={<Cloud className="h-4 w-4" />}
            status={azure}
            onTest={checkAzure}
            onHelp={() => setHelpKey("azure")}
          >
            <p className="text-[10px] text-muted-foreground">
              Requires <code className="bg-secondary px-1 rounded">az devops login</code> to be configured
            </p>
          </ConnectionCard>
        )}

        {visibleKeys.has("bitbucket") && (
          <ConnectionCard
            title="Bitbucket"
            description="REST API with App Password"
            icon={<Github className="h-4 w-4" />}
            status={bitbucket}
            onHelp={() => setHelpKey("bitbucket")}
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
        )}

        {visibleKeys.has("kimai") && (
          <ConnectionCard
            title="Kimai"
            description="Time tracking integration"
            icon={<Timer className="h-4 w-4" />}
            status={kimai}
            onHelp={() => setHelpKey("kimai")}
            onTest={async () => {
              await setCredential("kimai_url", kimaiUrl);
              await setCredential("kimai_token", kimaiToken);
              await checkKimai();
              // Setup Kimai MCP in background (non-blocking)
              if (kimaiUrl && kimaiToken) {
                setupKimaiMcp(kimaiUrl, kimaiToken).catch(() => {});
              }
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
        )}

        {visibleKeys.has("calendar") && (
          <ConnectionCard
            title="Google Calendar"
            description="Calendar event integration"
            icon={<Calendar className="h-4 w-4" />}
            status={calendar}
            onHelp={() => setHelpKey("calendar")}
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
                ) : calendar.message?.includes("OAuth client config") || calendar.message?.includes("Token expired") ? (
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
        )}

        {visibleKeys.has("claude") && (
          <ConnectionCard
            title="Claude API"
            description="AI-powered report generation"
            icon={<Bot className="h-4 w-4" />}
            status={claude}
            onHelp={() => setHelpKey("claude")}
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
        )}

        {visibleKeys.has("claude_cli") && (
          <ConnectionCard
            title="Claude CLI"
            description="Claude Code terminal integration"
            icon={<Terminal className="h-4 w-4" />}
            status={claudeCli}
            onTest={checkClaudeCli}
            onHelp={() => setHelpKey("claude_cli")}
          >
            <p className="text-[10px] text-muted-foreground">
              Requires <code className="bg-secondary px-1 rounded">claude</code> to be installed and in PATH
            </p>
          </ConnectionCard>
        )}
      </div>

      {/* Add connection button when some are hidden */}
      {hiddenConnections.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add connection
          </button>
          {showAddMenu && (
            <div className="absolute z-10 top-full left-0 mt-1 rounded-md border bg-popover shadow-md overflow-hidden min-w-[200px]">
              {hiddenConnections.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => {
                    updateSetting(`connection_visible_${key}`, "true");
                    setShowAddMenu(false);
                  }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-accent transition-colors"
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {helpKey && (
        <SetupHelpModal connectionKey={helpKey} onClose={() => setHelpKey(null)} />
      )}
    </div>
  );
}
