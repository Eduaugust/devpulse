import { useState, useEffect, useCallback } from "react";
import { useConnectionStore } from "@/stores/connectionStore";
import { ConnectionCard } from "@/components/ConnectionCard";
import { getCredentialStore, setCredential } from "@/lib/credentials";
import { authorizeCalendar, cancelCalendarAuth } from "@/lib/tauri";
import { Github, Timer, Calendar, Bot } from "lucide-react";

export function Connections() {
  const { github, kimai, calendar, claude, checkGitHub, checkKimai, checkCalendar, checkClaude } =
    useConnectionStore();

  const [kimaiUrl, setKimaiUrl] = useState("");
  const [kimaiToken, setKimaiToken] = useState("");
  const [calendarCreds, setCalendarCreds] = useState("");
  const [calendarCredsVisible, setCalendarCredsVisible] = useState(false);
  const [calendarAuthorizing, setCalendarAuthorizing] = useState(false);
  const [claudeKey, setClaudeKey] = useState("");

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
    } catch {
      // Store might not exist yet
    }
  }, []);

  useEffect(() => {
    loadCredentials();
  }, [loadCredentials]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold mb-1">Connections</h2>
        <p className="text-sm text-muted-foreground">
          Configure and test your integrations
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <ConnectionCard
          title="GitHub CLI"
          description="Uses gh CLI for authentication"
          icon={<Github className="h-4 w-4" />}
          status={github}
          onTest={checkGitHub}
        >
          <p className="text-[10px] text-muted-foreground">
            Requires <code className="bg-secondary px-1 rounded">gh auth login</code> to be configured
          </p>
        </ConnectionCard>

        <ConnectionCard
          title="Kimai"
          description="Time tracking integration"
          icon={<Timer className="h-4 w-4" />}
          status={kimai}
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
          onTest={async () => {
            await setCredential("calendar_credentials", calendarCreds);
            setCalendarCredsVisible(false);
            await checkCalendar();
          }}
        >
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
      </div>
    </div>
  );
}
