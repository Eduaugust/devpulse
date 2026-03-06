import { useEffect, useMemo, useState } from "react";
import { useEventStore } from "@/stores/eventStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { StatusPill } from "@/components/StatusPill";
import { EventCard } from "@/components/EventCard";
import type { DevEvent } from "@/lib/types";
import {
  GitPullRequest,
  Eye,
  GitCommit,
  Activity,
} from "lucide-react";

type StatPeriod = "today" | "week" | "month";

function filterByPeriod(events: DevEvent[], period: StatPeriod): DevEvent[] {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (period === "week") {
    start.setDate(start.getDate() - start.getDay());
  } else if (period === "month") {
    start.setDate(1);
  }

  return events.filter((e) => new Date(e.created_at) >= start);
}

function dayLabel(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const eventDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diff = today.getTime() - eventDay.getTime();
    const days = Math.floor(diff / 86_400_000);

    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return date.toLocaleDateString("en-US", { weekday: "long" });
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

function groupByDay(events: DevEvent[]): [string, DevEvent[]][] {
  const groups = new Map<string, DevEvent[]>();
  for (const event of events) {
    const label = dayLabel(event.created_at);
    const group = groups.get(label);
    if (group) {
      group.push(event);
    } else {
      groups.set(label, [event]);
    }
  }
  return Array.from(groups.entries());
}

export function Dashboard() {
  const { recentEvents, fetchRecentEvents } = useEventStore();
  const { github, kimai, calendar, claude, checkAll } = useConnectionStore();

  useEffect(() => {
    fetchRecentEvents();
    checkAll();
  }, [fetchRecentEvents, checkAll]);

  const [statPeriod, setStatPeriod] = useState<StatPeriod>("today");

  const periodEvents = useMemo(() => filterByPeriod(recentEvents, statPeriod), [recentEvents, statPeriod]);

  const prTypes = new Set(["pr_created", "pr_activity", "pr_approved", "changes_requested", "review_dismissed"]);
  const notifTypes = new Set(["notification", "comment", "mention", "assigned", "ci_activity", "approval_requested", "issue_activity", "release", "discussion"]);
  const prCount = periodEvents.filter((e) => prTypes.has(e.event_type)).length;
  const reviewCount = periodEvents.filter((e) => e.event_type === "review_requested").length;
  const notifCount = periodEvents.filter((e) => notifTypes.has(e.event_type)).length;

  const grouped = useMemo(() => groupByDay(recentEvents.slice(0, 20)), [recentEvents]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Dashboard</h2>
        <p className="text-sm text-muted-foreground">
          Overview of your development activity
        </p>
      </div>

      <div className="flex gap-4">
        <StatusPill status={github} label="GitHub" />
        <StatusPill status={kimai} label="Kimai" />
        <StatusPill status={calendar} label="Calendar" />
        <StatusPill status={claude} label="Claude" />
      </div>

      <div className="flex items-center gap-1 rounded-lg border bg-card p-1 w-fit">
        {([["today", "Today"], ["week", "This Week"], ["month", "This Month"]] as const).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setStatPeriod(value)}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              statPeriod === value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <GitPullRequest className="h-4 w-4 text-green-500" />
            <span className="text-xs text-muted-foreground">PRs</span>
          </div>
          <p className="text-2xl font-bold">{prCount}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Eye className="h-4 w-4 text-blue-500" />
            <span className="text-xs text-muted-foreground">Reviews</span>
          </div>
          <p className="text-2xl font-bold">{reviewCount}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <GitCommit className="h-4 w-4 text-yellow-500" />
            <span className="text-xs text-muted-foreground">
              Notifications
            </span>
          </div>
          <p className="text-2xl font-bold">{notifCount}</p>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <Activity className="h-4 w-4" />
          <h3 className="text-sm font-medium">Recent Events</h3>
        </div>
        {recentEvents.length === 0 ? (
          <div className="rounded-lg border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No events yet. Configure your connections and monitored repos to
              start tracking activity.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {grouped.map(([label, events]) => (
              <div key={label}>
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
                  {label}
                </p>
                <div className="space-y-2">
                  {events.map((event, i) => (
                    <EventCard key={event.id ?? i} event={event} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
