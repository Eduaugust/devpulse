import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useConnectionStore } from "@/stores/connectionStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { setCredential } from "@/lib/credentials";
import { authorizeCalendar, cancelCalendarAuth, setupKimaiMcp } from "@/lib/tauri";
import { setupGuides, renderStep } from "@/lib/setupGuides";
import { StatusPill } from "@/components/StatusPill";
import type { ConnectionStatus } from "@/lib/types";
import {
  Github,
  Gitlab,
  Cloud,
  Timer,
  Calendar,
  Bot,
  Terminal,
  ChevronRight,
  ChevronLeft,
  SkipForward,
  Check,
  Loader2,
  Rocket,
  Clock,
} from "lucide-react";

const integrations = [
  { key: "github", label: "GitHub", description: "Pull requests & activity", icon: Github },
  { key: "gitlab", label: "GitLab", description: "Merge requests & pipelines", icon: Gitlab },
  { key: "azure", label: "Azure DevOps", description: "Boards, repos & pipelines", icon: Cloud },
  { key: "bitbucket", label: "Bitbucket", description: "Pull requests & repos", icon: Github },
  { key: "kimai", label: "Kimai", description: "Time tracking & timesheets", icon: Timer },
  { key: "calendar", label: "Google Calendar", description: "Calendar events", icon: Calendar },
  { key: "claude_cli", label: "Claude CLI", description: "Terminal AI assistant", icon: Terminal },
] as const;

// Connections only visible in beta mode
const betaIntegrations = [
  { key: "claude", label: "Claude API", description: "AI-powered reports", icon: Bot },
] as const;

const allIntegrations = [...integrations, ...betaIntegrations] as const;

type IntegrationKey = (typeof allIntegrations)[number]["key"];

const storeKeyMap: Record<IntegrationKey, keyof ReturnType<typeof useConnectionStore.getState>> = {
  github: "github",
  gitlab: "gitlab",
  azure: "azure",
  bitbucket: "bitbucket",
  kimai: "kimai",
  calendar: "calendar",
  claude: "claude",
  claude_cli: "claudeCli",
};

const checkFnMap: Record<IntegrationKey, keyof ReturnType<typeof useConnectionStore.getState>> = {
  github: "checkGitHub",
  gitlab: "checkGitLab",
  azure: "checkAzure",
  bitbucket: "checkBitbucket",
  kimai: "checkKimai",
  calendar: "checkCalendar",
  claude: "checkClaude",
  claude_cli: "checkClaudeCli",
};

const betaRoutes = ["/dashboard", "/history", "/claude-code", "/pr-review", "/commands"];

function WelcomeStep({
  selected,
  onToggle,
  onContinue,
}: {
  selected: Set<IntegrationKey>;
  onToggle: (key: IntegrationKey) => void;
  onContinue: () => void;
}) {
  return (
    <div className="flex flex-col items-center">
      <img src="/app-icon.png" alt="" className="h-16 w-16 rounded-xl mb-4" />
      <h1 className="text-2xl font-bold mb-1">Welcome to DevPulse</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Select the integrations you'd like to set up
      </p>

      <div className="grid grid-cols-2 gap-3 w-full max-w-lg mb-8">
        {integrations.map(({ key, label, description, icon: Icon }) => {
          const isSelected = selected.has(key);
          return (
            <button
              key={key}
              onClick={() => onToggle(key)}
              className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/30"
              }`}
            >
              <div className={`p-2 rounded-md shrink-0 ${isSelected ? "bg-primary/10" : "bg-secondary"}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{label}</p>
                <p className="text-[10px] text-muted-foreground truncate">{description}</p>
              </div>
              {isSelected && (
                <Check className="h-4 w-4 text-primary shrink-0" />
              )}
            </button>
          );
        })}
      </div>

      <button
        onClick={onContinue}
        className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors"
      >
        {selected.size > 0 ? "Continue" : "Skip Setup"}
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function IntegrationStep({
  integrationKey,
  onBack,
  onSkip,
  onNext,
}: {
  integrationKey: IntegrationKey;
  onBack: () => void;
  onSkip: () => void;
  onNext: () => void;
}) {
  const guide = setupGuides[integrationKey];
  const status = useConnectionStore(
    (s) => s[storeKeyMap[integrationKey]] as ConnectionStatus,
  );
  const checkFn = useConnectionStore(
    (s) => s[checkFnMap[integrationKey]] as () => Promise<void>,
  );

  const [testing, setTesting] = useState(false);

  // Credential state for integrations that need inline inputs
  const [kimaiUrl, setKimaiUrl] = useState("");
  const [kimaiToken, setKimaiToken] = useState("");
  const [bbUsername, setBbUsername] = useState("");
  const [bbAppPassword, setBbAppPassword] = useState("");
  const [bbWorkspace, setBbWorkspace] = useState("");
  const [calendarEmail, setCalendarEmail] = useState("");
  const [calendarCreds, setCalendarCreds] = useState("");
  const [calendarAuthorizing, setCalendarAuthorizing] = useState(false);
  const [claudeKey, setClaudeKey] = useState("");

  const handleTest = useCallback(async () => {
    setTesting(true);
    try {
      // Save credentials before testing
      if (integrationKey === "kimai") {
        await setCredential("kimai_url", kimaiUrl);
        await setCredential("kimai_token", kimaiToken);
      } else if (integrationKey === "bitbucket") {
        await setCredential("bb_username", bbUsername);
        await setCredential("bb_app_password", bbAppPassword);
        await setCredential("bb_workspace", bbWorkspace || bbUsername);
      } else if (integrationKey === "calendar") {
        await setCredential("calendar_credentials", calendarCreds);
        await setCredential("calendar_email", calendarEmail);
      } else if (integrationKey === "claude") {
        await setCredential("claude_api_key", claudeKey);
      }
      await checkFn();
      // Setup Kimai MCP in background after successful test
      if (integrationKey === "kimai" && kimaiUrl && kimaiToken) {
        setupKimaiMcp(kimaiUrl, kimaiToken).catch(() => {});
      }
    } finally {
      setTesting(false);
    }
  }, [integrationKey, checkFn, kimaiUrl, kimaiToken, bbUsername, bbAppPassword, bbWorkspace, calendarEmail, calendarCreds, claudeKey]);

  const handleAuthorize = useCallback(async () => {
    setCalendarAuthorizing(true);
    try {
      await setCredential("calendar_credentials", calendarCreds);
      const authorizedCreds = await authorizeCalendar(calendarCreds);
      setCalendarCreds(authorizedCreds);
      await setCredential("calendar_credentials", authorizedCreds);
      await checkFn();
    } catch (e) {
      useConnectionStore.setState({
        calendar: { status: "disconnected", message: String(e) },
      });
    } finally {
      setCalendarAuthorizing(false);
    }
  }, [calendarCreds, checkFn]);

  const integration = integrations.find((i) => i.key === integrationKey)!;
  const Icon = integration.icon;

  return (
    <div className="w-full max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2.5 rounded-lg bg-secondary">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">{guide?.title ?? integration.label}</h2>
          <p className="text-xs text-muted-foreground">{integration.description}</p>
        </div>
      </div>

      {/* Setup steps */}
      {guide && (
        <div className="mb-6 rounded-lg border bg-card p-4">
          <ol className="space-y-3">
            {guide.steps.map((step, i) => (
              <li key={i} className="flex gap-3 text-xs">
                <span className="shrink-0 flex items-center justify-center h-5 w-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                  {i + 1}
                </span>
                <span className="text-muted-foreground pt-0.5">{renderStep(step)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Credential inputs */}
      {integrationKey === "kimai" && (
        <div className="mb-6 space-y-2">
          <input
            type="text"
            placeholder="Kimai URL (e.g., https://kimai.example.com)"
            value={kimaiUrl}
            onChange={(e) => setKimaiUrl(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border bg-background"
          />
          <input
            type="password"
            placeholder="API Token"
            value={kimaiToken}
            onChange={(e) => setKimaiToken(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border bg-background"
          />
        </div>
      )}

      {integrationKey === "bitbucket" && (
        <div className="mb-6 space-y-2">
          <input
            type="text"
            placeholder="Bitbucket username"
            value={bbUsername}
            onChange={(e) => setBbUsername(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border bg-background"
          />
          <input
            type="password"
            placeholder="App Password"
            value={bbAppPassword}
            onChange={(e) => setBbAppPassword(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border bg-background"
          />
          <input
            type="text"
            placeholder="Workspace (leave empty = username)"
            value={bbWorkspace}
            onChange={(e) => setBbWorkspace(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border bg-background"
          />
        </div>
      )}

      {integrationKey === "calendar" && (
        <div className="mb-6 space-y-2">
          <input
            type="email"
            placeholder="Calendar email (leave empty for primary)"
            value={calendarEmail}
            onChange={(e) => setCalendarEmail(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border bg-background"
          />
          <textarea
            placeholder="Paste OAuth client JSON from Google Cloud Console..."
            value={calendarCreds}
            onChange={(e) => setCalendarCreds(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border bg-background h-20 resize-none font-mono"
          />
          {calendarCreds && (
            <div className="flex items-center gap-2">
              {calendarAuthorizing ? (
                <button
                  onClick={() => { cancelCalendarAuth(); setCalendarAuthorizing(false); }}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md border border-destructive text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Cancel
                </button>
              ) : (
                <button
                  onClick={handleAuthorize}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                >
                  Authorize
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {integrationKey === "claude" && (
        <div className="mb-6 space-y-2">
          <input
            type="password"
            placeholder="Anthropic API Key (sk-ant-...)"
            value={claudeKey}
            onChange={(e) => setClaudeKey(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border bg-background"
          />
        </div>
      )}

      {/* Test connection + status */}
      <div className="mb-8 flex items-center gap-3">
        <button
          onClick={handleTest}
          disabled={testing}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {testing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {testing ? "Testing..." : "Test Connection"}
        </button>
        <StatusPill status={status} label={status.message || status.status} />
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg border hover:bg-secondary transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={onSkip}
            className="flex items-center gap-1.5 px-4 py-2 text-sm text-muted-foreground hover:text-foreground rounded-lg hover:bg-secondary transition-colors"
          >
            Skip
            <SkipForward className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onNext}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function AutoFillStep({
  onBack,
  onNext,
  onSkip,
  updateSetting,
  getSetting,
}: {
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  updateSetting: (key: string, value: string) => Promise<void>;
  getSetting: (key: string, fallback: string) => string;
}) {
  const enabled = getSetting("autofill_enabled", "false") === "true";
  const time = getSetting("autofill_time", "09:00");

  return (
    <div className="flex flex-col items-center w-full max-w-lg mx-auto">
      <div className="p-3 rounded-xl bg-primary/10 mb-4">
        <Clock className="h-8 w-8 text-primary" />
      </div>
      <h2 className="text-xl font-bold mb-1">Auto-Fill Timesheet</h2>
      <p className="text-sm text-muted-foreground mb-6 text-center">
        DevPulse can automatically fill your Kimai timesheet every day using your calendar events, git commits, and PR activity.
      </p>

      <div className="w-full rounded-lg border bg-card p-4 mb-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Enable Auto-Fill</p>
            <p className="text-xs text-muted-foreground">
              Runs daily at the scheduled time
            </p>
          </div>
          <button
            onClick={() => updateSetting("autofill_enabled", enabled ? "false" : "true")}
            className={`relative w-9 h-5 rounded-full transition-colors ${
              enabled ? "bg-primary" : "bg-secondary"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                enabled ? "translate-x-4" : ""
              }`}
            />
          </button>
        </div>

        {enabled && (
          <div className="flex items-center justify-between">
            <p className="text-sm">Schedule Time</p>
            <input
              type="time"
              value={time}
              onChange={(e) => updateSetting("autofill_time", e.target.value)}
              className="text-sm rounded-md border bg-background px-2 py-1"
            />
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          You can configure activity mappings later in Reports to customize how calendar events map to Kimai activities.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg border hover:bg-secondary transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
        <button
          onClick={onSkip}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <SkipForward className="h-4 w-4" />
          Skip
        </button>
        <button
          onClick={onNext}
          className="flex items-center gap-2 px-6 py-2 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors"
        >
          Continue
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function FinishStep({
  selectedIntegrations,
  onBack,
  onFinish,
}: {
  selectedIntegrations: IntegrationKey[];
  onBack: () => void;
  onFinish: () => void;
}) {
  const connectionState = useConnectionStore();

  return (
    <div className="flex flex-col items-center w-full max-w-lg mx-auto">
      <div className="p-3 rounded-xl bg-primary/10 mb-4">
        <Rocket className="h-8 w-8 text-primary" />
      </div>
      <h2 className="text-xl font-bold mb-1">You're all set!</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Here's a summary of your integrations
      </p>

      {selectedIntegrations.length > 0 && (
        <div className="w-full rounded-lg border bg-card p-4 mb-8 space-y-2">
          {selectedIntegrations.map((key) => {
            const integration = integrations.find((i) => i.key === key)!;
            const Icon = integration.icon;
            const status = connectionState[storeKeyMap[key]] as ConnectionStatus;
            return (
              <div key={key} className="flex items-center justify-between py-1.5">
                <div className="flex items-center gap-2.5">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{integration.label}</span>
                </div>
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    status.status === "connected"
                      ? "bg-green-500/10 text-green-500"
                      : "bg-red-500/10 text-red-500"
                  }`}
                >
                  {status.status === "connected" ? "Connected" : "Not connected"}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg border hover:bg-secondary transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
        <button
          onClick={onFinish}
          className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors"
        >
          Get Started
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function Onboarding() {
  const navigate = useNavigate();
  const { updateSetting } = useSettingsStore();

  const [step, setStep] = useState(0);
  const [selectedIntegrations, setSelectedIntegrations] = useState<Set<IntegrationKey>>(new Set());

  const toggleIntegration = (key: IntegrationKey) => {
    setSelectedIntegrations((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectedArray = Array.from(selectedIntegrations);
  const showAutofillStep = selectedIntegrations.has("kimai") && selectedIntegrations.has("calendar");
  // Steps: welcome(0), ...integrations(1..N), [autofill(N+1)], finish(N+1 or N+2)
  const totalSteps = selectedArray.length + 2 + (showAutofillStep ? 1 : 0);
  const autofillStepIndex = selectedArray.length + 1;
  const finishStepIndex = selectedArray.length + 1 + (showAutofillStep ? 1 : 0);

  const handleContinue = () => setStep(1);

  const handleBack = () => {
    if (step === 1) {
      // Going back to welcome — allow reselection
      setStep(0);
    } else {
      setStep((s) => s - 1);
    }
  };

  const handleNext = () => setStep((s) => Math.min(s + 1, totalSteps - 1));
  const handleSkip = () => setStep((s) => Math.min(s + 1, totalSteps - 1));

  const handleFinish = async () => {
    await updateSetting("onboarding_completed", "true");
    // Reset sidebar order so Reports comes first
    await updateSetting("sidebar_order", JSON.stringify([
      "/reports", "/invoices", "/connections", "/settings",
      "/dashboard", "/history", "/claude-code", "/pr-review", "/commands",
    ]));
    // Hide beta routes by default
    for (const route of betaRoutes) {
      await updateSetting(`sidebar_visible_${route}`, "false");
    }
    // Save connection visibility based on selected integrations
    for (const { key } of integrations) {
      await updateSetting(`connection_visible_${key}`, selectedIntegrations.has(key) ? "true" : "false");
    }
    // Beta connections hidden by default
    for (const { key } of betaIntegrations) {
      await updateSetting(`connection_visible_${key}`, "false");
    }
    navigate("/reports", { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-background">
      <div className="w-full max-w-2xl">
        {/* Progress indicator */}
        {totalSteps > 2 && step > 0 && (
          <div className="flex items-center justify-center gap-1.5 mb-8">
            {Array.from({ length: totalSteps }, (_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === step ? "w-6 bg-primary" : i < step ? "w-1.5 bg-primary/50" : "w-1.5 bg-muted"
                }`}
              />
            ))}
          </div>
        )}

        {step === 0 && (
          <WelcomeStep
            selected={selectedIntegrations}
            onToggle={toggleIntegration}
            onContinue={selectedArray.length > 0 ? handleContinue : handleFinish}
          />
        )}

        {step > 0 && step <= selectedArray.length && (
          <IntegrationStep
            key={selectedArray[step - 1]}
            integrationKey={selectedArray[step - 1]}
            onBack={handleBack}
            onSkip={handleSkip}
            onNext={handleNext}
          />
        )}

        {showAutofillStep && step === autofillStepIndex && (
          <AutoFillStep
            onBack={handleBack}
            onNext={handleNext}
            onSkip={handleSkip}
            updateSetting={updateSetting}
            getSetting={(key: string, fallback: string) => {
              const { settings } = useSettingsStore.getState();
              return settings[key] ?? fallback;
            }}
          />
        )}

        {step === finishStepIndex && (
          <FinishStep
            selectedIntegrations={selectedArray}
            onBack={handleBack}
            onFinish={handleFinish}
          />
        )}
      </div>
    </div>
  );
}
