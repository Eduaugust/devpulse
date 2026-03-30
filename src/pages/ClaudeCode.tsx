import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Play,
  FolderOpen,
  AlertTriangle,
  Terminal as TerminalIcon,
  Save,
  Monitor,
  X,
} from "lucide-react";
import { checkCommandAvailable, openClaudeTerminal } from "@/lib/tauri";
import { useSettingsStore } from "@/stores/settingsStore";
import { getPlatform, getTerminalOptions } from "@/lib/platform";
import { EmbeddedTerminal } from "@/components/EmbeddedTerminal";

export function ClaudeCode() {
  const location = useLocation();
  const state = location.state as {
    initialPrompt?: string;
    sessionLabel?: string;
  } | null;
  const didAutoOpen = useRef(false);

  const [claudeAvailable, setClaudeAvailable] = useState<boolean | null>(null);
  const [opening, setOpening] = useState(false);
  const [terminalOptions, setTerminalOptions] = useState(getTerminalOptions("macos"));
  const [embeddedActive, setEmbeddedActive] = useState(false);
  const [embeddedKey, setEmbeddedKey] = useState(0);
  const [embeddedPrompt, setEmbeddedPrompt] = useState<string | undefined>();

  // Detect platform and set terminal options
  useEffect(() => {
    getPlatform().then((os) => setTerminalOptions(getTerminalOptions(os)));
  }, []);

  const { getSetting, updateSetting } = useSettingsStore();
  const defaultDir = getSetting("default_working_directory", "");
  const preferredTerminal = getSetting(
    "preferred_terminal",
    terminalOptions[0].value,
  );
  const [workingDirectory, setWorkingDirectory] = useState(defaultDir);

  // Keep workingDirectory in sync if settings load after mount
  const settingsLoaded = useRef(false);
  useEffect(() => {
    if (!settingsLoaded.current && defaultDir) {
      settingsLoaded.current = true;
      setWorkingDirectory(defaultDir);
    }
  }, [defaultDir]);

  // Check if claude CLI is available
  useEffect(() => {
    checkCommandAvailable("claude")
      .then(setClaudeAvailable)
      .catch(() => setClaudeAvailable(false));
  }, []);

  const openTerminal = useCallback(
    async (initialPrompt?: string) => {
      if (preferredTerminal === "builtin") {
        setEmbeddedPrompt(initialPrompt);
        setEmbeddedKey((k) => k + 1);
        setEmbeddedActive(true);
        return;
      }
      setOpening(true);
      try {
        await openClaudeTerminal({
          cwd: workingDirectory || null,
          args: null,
          initialPrompt: initialPrompt || null,
          terminal: preferredTerminal,
        });
      } catch (e) {
        console.error("Failed to open terminal:", e);
      } finally {
        setOpening(false);
      }
    },
    [workingDirectory, preferredTerminal],
  );

  // Auto-open if navigated with initialPrompt (e.g. from Report Generator)
  useEffect(() => {
    if (
      !state?.initialPrompt ||
      didAutoOpen.current ||
      claudeAvailable !== true
    )
      return;
    didAutoOpen.current = true;
    openTerminal(state.initialPrompt);
  }, [state, claudeAvailable, openTerminal]);

  const pickDirectory = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      setWorkingDirectory(selected as string);
    }
  };

  const saveAsDefault = async () => {
    if (workingDirectory) {
      await updateSetting("default_working_directory", workingDirectory);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)]">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0">
        <TerminalIcon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Claude Code</span>

        {claudeAvailable === false && (
          <div className="flex items-center gap-1.5 ml-2 text-yellow-500 text-xs">
            <AlertTriangle className="h-3 w-3" />
            CLI not found
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* Terminal selector */}
          <div className="flex items-center gap-1.5">
            <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
            <select
              value={preferredTerminal}
              onChange={(e) =>
                updateSetting("preferred_terminal", e.target.value)
              }
              className="text-xs rounded-md border bg-background px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {terminalOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Working directory */}
          <div className="flex items-center gap-1.5">
            <input
              value={workingDirectory}
              onChange={(e) => setWorkingDirectory(e.target.value)}
              placeholder="Working directory"
              className="text-xs rounded-md border bg-background px-2 py-1 w-48 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              onClick={pickDirectory}
              className="p-1 rounded-md border bg-background hover:bg-secondary transition-colors"
              title="Browse"
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </button>
            {workingDirectory && workingDirectory !== defaultDir && (
              <button
                onClick={saveAsDefault}
                className="p-1 rounded-md border bg-background hover:bg-secondary transition-colors"
                title="Save as default directory"
              >
                <Save className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {embeddedActive && (
            <button
              onClick={() => setEmbeddedActive(false)}
              className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md border bg-background hover:bg-secondary transition-colors"
            >
              <X className="h-3 w-3" />
              Close
            </button>
          )}

          <button
            onClick={() => openTerminal()}
            disabled={claudeAvailable === false || opening}
            className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            <Play className="h-3 w-3" />
            {opening ? "Opening…" : "Open Claude"}
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 min-h-0 flex items-center justify-center bg-[#0a0a0f]">
        {embeddedActive ? (
          <EmbeddedTerminal
            key={embeddedKey}
            command="claude"
            args={embeddedPrompt ? [embeddedPrompt] : []}
            cwd={workingDirectory || null}
            onExit={() => {}}
          />
        ) : (
          <div className="text-center space-y-4 max-w-md px-6">
            <TerminalIcon className="h-16 w-16 text-muted-foreground/20 mx-auto" />
            <div>
              <p className="text-sm text-muted-foreground/60">
                {preferredTerminal === "builtin"
                  ? "Run Claude directly inside DevPulse"
                  : "Sessions open in your system terminal"}
              </p>
              <p className="text-xs text-muted-foreground/40 mt-2">
                Set a working directory and click Open Claude to start.
              </p>
            </div>
            <button
              onClick={() => openTerminal()}
              disabled={claudeAvailable === false || opening}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <Play className="h-4 w-4" />
              {opening ? "Opening…" : "Open Claude Terminal"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
