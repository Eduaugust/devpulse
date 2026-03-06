import { useState, type ReactNode } from "react";
import { StatusPill } from "./StatusPill";
import type { ConnectionStatus } from "@/lib/types";
import { Loader2 } from "lucide-react";

interface ConnectionCardProps {
  title: string;
  description: string;
  icon: ReactNode;
  status: ConnectionStatus;
  onTest: () => Promise<void>;
  children?: ReactNode;
}

export function ConnectionCard({
  title,
  description,
  icon,
  status,
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
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-md bg-secondary">{icon}</div>
          <div>
            <h3 className="font-medium text-sm">{title}</h3>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
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
    </div>
  );
}
