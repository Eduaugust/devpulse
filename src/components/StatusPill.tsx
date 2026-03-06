import { cn } from "@/lib/utils";
import type { ConnectionStatus } from "@/lib/types";

interface StatusPillProps {
  status: ConnectionStatus;
  label: string;
}

export function StatusPill({ status, label }: StatusPillProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex items-center">
        <span
          className={cn(
            "h-2.5 w-2.5 rounded-full",
            status.status === "connected" && "bg-green-500",
            status.status === "disconnected" && "bg-red-500",
            status.status === "checking" && "bg-yellow-500",
          )}
        />
        {status.status === "checking" && (
          <span className="absolute h-2.5 w-2.5 rounded-full bg-yellow-500 animate-ping" />
        )}
      </div>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}
