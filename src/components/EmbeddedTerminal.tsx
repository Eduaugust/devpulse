import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { spawnPty, writePty, resizePty, killPty } from "@/lib/tauri";
import "@xterm/xterm/css/xterm.css";

interface EmbeddedTerminalProps {
  command: string;
  args?: string[];
  cwd?: string | null;
  onExit?: (code: number | null) => void;
}

export function EmbeddedTerminal({
  command,
  args = [],
  cwd,
  onExit,
}: EmbeddedTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | null>(null);
  const [exited, setExited] = useState<number | null | false>(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      theme: {
        background: "#0a0a0f",
        foreground: "#e4e4e7",
        cursor: "#e4e4e7",
        selectionBackground: "#3f3f46",
        black: "#09090b",
        red: "#ef4444",
        green: "#22c55e",
        yellow: "#eab308",
        blue: "#3b82f6",
        magenta: "#a855f7",
        cyan: "#06b6d4",
        white: "#e4e4e7",
        brightBlack: "#52525b",
        brightRed: "#f87171",
        brightGreen: "#4ade80",
        brightYellow: "#facc15",
        brightBlue: "#60a5fa",
        brightMagenta: "#c084fc",
        brightCyan: "#22d3ee",
        brightWhite: "#fafafa",
      },
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);

    termRef.current = term;
    fitRef.current = fit;

    // Initial fit
    requestAnimationFrame(() => fit.fit());

    let unlistenData: UnlistenFn | undefined;
    let unlistenExit: UnlistenFn | undefined;
    let disposed = false;

    const setup = async () => {
      const cols = term.cols;
      const rows = term.rows;

      const sid = await spawnPty(command, args, cwd ?? null, cols, rows);
      if (disposed) {
        killPty(sid);
        return;
      }
      sessionRef.current = sid;

      // Forward user input to PTY
      term.onData((data) => {
        if (sessionRef.current) {
          writePty(sessionRef.current, data);
        }
      });

      // Listen for PTY output
      unlistenData = await listen<{ session_id: string; data: string }>(
        "pty:data",
        (event) => {
          if (event.payload.session_id === sid) {
            term.write(event.payload.data);
          }
        },
      );

      // Listen for PTY exit
      unlistenExit = await listen<{ session_id: string; code: number | null }>(
        "pty:exit",
        (event) => {
          if (event.payload.session_id === sid) {
            sessionRef.current = null;
            setExited(event.payload.code);
            onExit?.(event.payload.code);
          }
        },
      );
    };

    setup().catch((err) => {
      term.write(`\r\nFailed to start: ${err}\r\n`);
    });

    // ResizeObserver for auto-fit
    const ro = new ResizeObserver(() => {
      if (!disposed && fitRef.current) {
        fitRef.current.fit();
        if (sessionRef.current) {
          resizePty(sessionRef.current, term.cols, term.rows).catch(() => {});
        }
      }
    });
    ro.observe(containerRef.current);

    return () => {
      disposed = true;
      ro.disconnect();
      unlistenData?.();
      unlistenExit?.();
      if (sessionRef.current) {
        killPty(sessionRef.current);
        sessionRef.current = null;
      }
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      {exited !== false && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="text-center space-y-2">
            <p className="text-sm text-muted-foreground">
              Session ended
              {exited !== null && (
                <span className="ml-1 text-xs opacity-60">
                  (exit code {exited})
                </span>
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
