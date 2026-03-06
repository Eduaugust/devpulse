import { useEffect } from "react";
import { useEventStore } from "@/stores/eventStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { EventCard } from "./EventCard";
import { StatusPill } from "./StatusPill";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Activity, ExternalLink } from "lucide-react";

export function TrayPanel() {
  const { recentEvents, fetchRecentEvents } = useEventStore();
  const { github, kimai, calendar, claude } = useConnectionStore();

  useEffect(() => {
    fetchRecentEvents();
    const interval = setInterval(fetchRecentEvents, 30000);
    return () => clearInterval(interval);
  }, [fetchRecentEvents]);

  const openMain = async () => {
    const { getAllWebviewWindows } = await import("@tauri-apps/api/webviewWindow");
    const windows = await getAllWebviewWindows();
    const main = windows.find((w) => w.label === "main");
    if (main) {
      await main.show();
      await main.setFocus();
    }
    const current = getCurrentWebviewWindow();
    await current.hide();
  };

  return (
    <div className="h-full flex flex-col bg-background/95 backdrop-blur-xl rounded-lg border shadow-xl overflow-hidden">
      <div className="px-3 pt-3 pb-2 border-b">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-semibold">DevPulse</span>
          </div>
          <button
            onClick={openMain}
            className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          >
            Open App
            <ExternalLink className="h-2.5 w-2.5" />
          </button>
        </div>
        <div className="flex gap-3">
          <StatusPill status={github} label="GitHub" />
          <StatusPill status={kimai} label="Kimai" />
          <StatusPill status={calendar} label="Calendar" />
          <StatusPill status={claude} label="Claude" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {recentEvents.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            No recent events
          </div>
        ) : (
          recentEvents.slice(0, 5).map((event, i) => (
            <EventCard key={event.id ?? i} event={event} compact />
          ))
        )}
      </div>
      <div className="px-3 py-2 border-t">
        <button
          onClick={openMain}
          className="w-full text-[10px] text-center text-muted-foreground hover:text-foreground transition-colors"
        >
          View all activity
        </button>
      </div>
    </div>
  );
}
