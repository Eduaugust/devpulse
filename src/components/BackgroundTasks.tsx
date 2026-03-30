import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useBackgroundTaskStore } from "@/stores/backgroundTaskStore";
import {
  Bell,
  Loader2,
  CheckCircle2,
  XCircle,
  GitPullRequestArrow,
  FileText,
  FilePen,
  Send,
  X,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { BackgroundTask } from "@/lib/types";

const typeIcons: Record<BackgroundTask["type"], typeof GitPullRequestArrow> = {
  "pr-review": GitPullRequestArrow,
  "post-review": Send,
  "report-generation": FileText,
  "pr-description": FilePen,
  "pr-fixes": GitPullRequestArrow,
  "fill-timesheet": FileText,
};

const typeRoutes: Record<BackgroundTask["type"], string> = {
  "pr-review": "/pr-review",
  "post-review": "/pr-review",
  "report-generation": "/reports",
  "pr-description": "/history",
  "pr-fixes": "/pr-review",
  "fill-timesheet": "/reports",
};

const statusIcons: Record<BackgroundTask["status"], typeof Loader2> = {
  running: Loader2,
  completed: CheckCircle2,
  error: XCircle,
};

function formatDuration(startedAt: number, finishedAt?: number): string {
  const elapsed = (finishedAt ?? Date.now()) - startedAt;
  const secs = Math.floor(elapsed / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

export function BackgroundTasks() {
  const { tasks, removeTask, clearCompleted } = useBackgroundTaskStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const runningCount = tasks.filter((t) => t.status === "running").length;
  const totalCount = tasks.length;
  const hasFinished = tasks.some((t) => t.status !== "running");

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleNavigate = (task: BackgroundTask) => {
    const route = typeRoutes[task.type];
    if (route) {
      setOpen(false);
      navigate(route);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "relative flex items-center justify-center w-8 h-8 rounded-md transition-colors",
          open
            ? "bg-secondary text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
        )}
      >
        <Bell className="h-4 w-4" />
        {totalCount > 0 && (
          <span
            className={cn(
              "absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center rounded-full text-[10px] font-bold px-1",
              runningCount > 0
                ? "bg-primary text-primary-foreground animate-pulse"
                : "bg-muted-foreground text-background",
            )}
          >
            {runningCount > 0 ? runningCount : totalCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 rounded-lg border bg-card shadow-lg z-50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <span className="text-xs font-semibold">Background Tasks</span>
            {hasFinished && (
              <button
                onClick={clearCompleted}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <Trash2 className="h-3 w-3" />
                Clear done
              </button>
            )}
          </div>

          {tasks.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <p className="text-xs text-muted-foreground">
                No background tasks
              </p>
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto divide-y">
              {tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onRemove={removeTask}
                  onNavigate={handleNavigate}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TaskRow({
  task,
  onRemove,
  onNavigate,
}: {
  task: BackgroundTask;
  onRemove: (id: string) => void;
  onNavigate: (task: BackgroundTask) => void;
}) {
  const TypeIcon = typeIcons[task.type] || FileText;
  const StatusIcon = statusIcons[task.status];

  return (
    <div className="px-3 py-2 hover:bg-secondary/30 transition-colors">
      <div className="flex items-center gap-2">
        <TypeIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <button
          onClick={() => onNavigate(task)}
          className="flex-1 text-left min-w-0"
        >
          <p className="text-xs font-medium truncate">{task.label}</p>
          <p className="text-[10px] text-muted-foreground">
            {task.repo && `${task.repo}`}
            {task.prNumber ? ` #${task.prNumber}` : ""}
            {" — "}
            {formatDuration(task.startedAt, task.finishedAt)}
          </p>
        </button>
        <StatusIcon
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            task.status === "running" && "text-primary animate-spin",
            task.status === "completed" && "text-green-500",
            task.status === "error" && "text-destructive",
          )}
        />
        {task.status !== "running" && (
          <button
            onClick={() => onRemove(task.id)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {task.status === "completed" && task.result && (
        <p className="text-[10px] text-muted-foreground mt-0.5 ml-5.5 truncate">
          {task.result}
        </p>
      )}
      {task.status === "error" && task.error && (
        <p className="text-[10px] text-destructive mt-0.5 ml-5.5 truncate">
          {task.error}
        </p>
      )}
    </div>
  );
}
