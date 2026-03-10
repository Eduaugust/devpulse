import { useState, type ReactNode } from "react";
import { StatusPill } from "./StatusPill";
import { ToggleSwitch } from "./ToggleSwitch";
import type { ConnectionStatus } from "@/lib/types";
import { Loader2 } from "lucide-react";

interface ConnectionCardProps {
  title: string;
  description: string;
  icon: ReactNode;
  status: ConnectionStatus;
  enabled: boolean;
  onToggle: () => void;
  onTest: () => Promise<void>;
  children?: ReactNode;
}

export function ConnectionCard({
  title,
  description,
  icon,
  status,
  enabled,
  onToggle,
  onTest,
  children,
}: ConnectionCardProps) {
  const [testing, setTesting] = useState(false);

  const handleTest = async () => {
    setTesting(true);
    try {
      await onTest();
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className={`rounded-lg border bg-card p-4 transition-opacity ${enabled ? "" : "opacity-50"}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-md bg-secondary shrink-0">{icon}</div>
          <div className="min-w-0">
            <h3 className="font-medium text-sm truncate">{title}</h3>
            <p className="text-xs text-muted-foreground truncate">{description}</p>
          </div>
        </div>
        <ToggleSwitch enabled={enabled} onToggle={onToggle} />
      </div>
      {enabled && (
        <>
          <div className="mb-3">
            <StatusPill status={status} label={status.message || status.status} />
          </div>
          {children && <div className="mb-3 space-y-2">{children}</div>}
          <button
            onClick={handleTest}
            disabled={testing}
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {testing && <Loader2 className="h-3 w-3 animate-spin" />}
            {testing ? "Testing..." : "Test Connection"}
          </button>
        </>
      )}
    </div>
  );
}
