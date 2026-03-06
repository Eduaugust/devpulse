import { platform } from "@tauri-apps/plugin-os";

type Platform = "macos" | "windows" | "linux";

let cached: Platform | null = null;

/** Cached platform detection — only calls Tauri once per app session. */
export async function getPlatform(): Promise<Platform> {
  if (!cached) cached = (await platform()) as Platform;
  return cached;
}

/**
 * Check if a filesystem path ends with a given name segment.
 * Handles both `/` and `\` separators for cross-platform paths.
 */
export function pathEndsWith(p: string, name: string): boolean {
  const last = p.split(/[\\/]/).pop() || p;
  return last === name;
}

export interface TerminalOption {
  value: string;
  label: string;
}

const MAC_TERMINALS: TerminalOption[] = [
  { value: "terminal", label: "Terminal.app" },
  { value: "iterm2", label: "iTerm2" },
  { value: "warp", label: "Warp" },
];
const WINDOWS_TERMINALS: TerminalOption[] = [
  { value: "windows-terminal", label: "Windows Terminal" },
  { value: "powershell", label: "PowerShell" },
];
const LINUX_TERMINALS: TerminalOption[] = [
  { value: "gnome-terminal", label: "GNOME Terminal" },
  { value: "konsole", label: "Konsole" },
  { value: "alacritty", label: "Alacritty" },
  { value: "xterm", label: "xterm" },
];

export function getTerminalOptions(os: Platform): TerminalOption[] {
  if (os === "windows") return WINDOWS_TERMINALS;
  if (os === "linux") return LINUX_TERMINALS;
  return MAC_TERMINALS;
}
