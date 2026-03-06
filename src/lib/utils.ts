import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDistanceToNow, format } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function timeAgo(dateStr: string): string {
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
  } catch {
    return dateStr;
  }
}

export function formatDate(dateStr: string): string {
  try {
    return format(new Date(dateStr), "MMM d, yyyy HH:mm");
  } catch {
    return dateStr;
  }
}

export function eventTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    pr_created: "PR Created",
    pr_activity: "PR Update",
    pr_approved: "PR Approved",
    changes_requested: "Changes Requested",
    review_dismissed: "Review Dismissed",
    review_requested: "Review Requested",
    comment: "Comment",
    mention: "Mentioned",
    assigned: "Assigned",
    ci_activity: "CI/CD",
    approval_requested: "Approval Requested",
    issue_activity: "Issue",
    release: "Release",
    discussion: "Discussion",
    notification: "Notification",
    commit: "Commit",
  };
  return labels[type] || type;
}

export function eventTypeColor(type: string): string {
  const colors: Record<string, string> = {
    pr_created: "text-green-500",
    pr_activity: "text-green-400",
    pr_approved: "text-emerald-500",
    changes_requested: "text-red-500",
    review_dismissed: "text-gray-400",
    review_requested: "text-blue-500",
    comment: "text-cyan-500",
    mention: "text-purple-500",
    assigned: "text-orange-500",
    ci_activity: "text-amber-500",
    approval_requested: "text-blue-400",
    issue_activity: "text-red-400",
    release: "text-teal-500",
    discussion: "text-indigo-400",
    notification: "text-yellow-500",
    commit: "text-gray-500",
  };
  return colors[type] || "text-gray-500";
}
