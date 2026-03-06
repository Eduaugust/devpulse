import type { DevEvent } from "@/lib/types";
import { timeAgo, eventTypeLabel, eventTypeColor } from "@/lib/utils";
import {
  GitPullRequest,
  Eye,
  Bell,
  AtSign,
  GitCommit,
  MessageSquare,
  UserCheck,
  CircleDot,
  Tag,
  PlayCircle,
  MessagesSquare,
  ShieldCheck,
  ExternalLink,
} from "lucide-react";

const iconMap: Record<string, React.ElementType> = {
  pr_created: GitPullRequest,
  pr_activity: GitPullRequest,
  pr_approved: ShieldCheck,
  changes_requested: CircleDot,
  review_dismissed: Eye,
  review_requested: Eye,
  comment: MessageSquare,
  mention: AtSign,
  assigned: UserCheck,
  ci_activity: PlayCircle,
  approval_requested: ShieldCheck,
  issue_activity: CircleDot,
  release: Tag,
  discussion: MessagesSquare,
  notification: Bell,
  commit: GitCommit,
};

const reasonLabels: Record<string, string> = {
  author: "You authored this",
  approved: "Your PR was approved",
  changes_requested: "Changes requested on your PR",
  review_comment: "Review comment on your PR",
  dismissed: "Review was dismissed",
  review_requested: "Review requested",
  mention: "You were mentioned",
  team_mention: "Your team was mentioned",
  assign: "You were assigned",
  comment: "New comment",
  state_change: "State changed",
  subscribed: "Subscribed",
  ci_activity: "CI activity",
  manual: "Manual",
  approval_requested: "Approval requested",
  security_alert: "Security alert",
};

function toWebUrl(url: string): string {
  return url
    .replace("https://api.github.com/repos/", "https://github.com/")
    .replace("/pulls/", "/pull/");
}

interface EventCardProps {
  event: DevEvent;
  compact?: boolean;
}

export function EventCard({ event, compact }: EventCardProps) {
  const Icon = iconMap[event.event_type] || Bell;

  if (compact) {
    return (
      <div className="flex items-start gap-2 py-1.5 px-2 rounded-md hover:bg-accent/50 transition-colors">
        <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${eventTypeColor(event.event_type)}`} />
        <div className="min-w-0 flex-1">
          <p className="text-xs truncate">{event.title}</p>
          <p className="text-[10px] text-muted-foreground">
            {event.repo && <span>{event.repo} · </span>}
            {timeAgo(event.created_at)}
          </p>
        </div>
      </div>
    );
  }

  const description = (() => {
    if (!event.description) return "";
    // New format: "SubjectType:reason"
    if (event.description.includes(":")) {
      const reason = event.description.split(":").pop() || "";
      return reasonLabels[reason] || reason;
    }
    // Legacy format: just the reason
    return reasonLabels[event.description] || event.description;
  })();

  const card = (
    <div className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-accent/30 transition-colors">
      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${eventTypeColor(event.event_type)}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {eventTypeLabel(event.event_type)}
          </span>
          {description && (
            <span className="text-[10px] text-muted-foreground">
              — {description}
            </span>
          )}
        </div>
        <p className="text-sm font-medium truncate">{event.title}</p>
        <div className="flex items-center gap-2 mt-1">
          {event.repo && (
            <span className="text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
              {event.repo}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground">
            {timeAgo(event.created_at)}
          </span>
          {event.url && (
            <ExternalLink className="h-2.5 w-2.5 text-muted-foreground" />
          )}
        </div>
      </div>
    </div>
  );

  if (event.url) {
    return (
      <a href={toWebUrl(event.url)} target="_blank" rel="noopener noreferrer">
        {card}
      </a>
    );
  }

  return card;
}
