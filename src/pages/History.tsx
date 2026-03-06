import { useEffect, useState, useCallback } from "react";
import { useEventStore } from "@/stores/eventStore";
import { EventCard } from "@/components/EventCard";
import { Search, Filter, ChevronLeft, ChevronRight } from "lucide-react";

const EVENT_TYPES = [
  { value: "", label: "All Types" },
  { value: "pr_created", label: "PRs Created" },
  { value: "review_requested", label: "Reviews" },
  { value: "notification", label: "Notifications" },
  { value: "mention", label: "Mentions" },
];

const PAGE_SIZE = 20;

export function History() {
  const { events, loading, fetchEvents } = useEventStore();
  const [typeFilter, setTypeFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(0);

  const loadEvents = useCallback(() => {
    fetchEvents({
      event_type: typeFilter || undefined,
      search: searchQuery || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    });
  }, [fetchEvents, typeFilter, searchQuery, page]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold mb-1">Event History</h2>
        <p className="text-sm text-muted-foreground">
          Browse all tracked development events
        </p>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search events..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(0);
            }}
            className="w-full pl-9 pr-3 py-1.5 text-sm rounded-md border bg-background"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(0);
            }}
            className="text-sm rounded-md border bg-background px-2 py-1.5"
          >
            {EVENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No events found{searchQuery ? ` matching "${searchQuery}"` : ""}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((event, i) => (
            <EventCard key={event.id ?? i} event={event} />
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <button
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Previous
        </button>
        <span className="text-xs text-muted-foreground">Page {page + 1}</span>
        <button
          onClick={() => setPage((p) => p + 1)}
          disabled={events.length < PAGE_SIZE}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
