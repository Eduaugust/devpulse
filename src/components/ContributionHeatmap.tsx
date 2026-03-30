import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface ContributionHeatmapProps {
  data: Map<string, number>;
  months: number;
  onDayClick?: (date: string) => void;
}

function getIntensityClass(count: number): string {
  if (count === 0) return "bg-muted";
  if (count === 1) return "bg-primary/20";
  if (count <= 3) return "bg-primary/40";
  if (count <= 6) return "bg-primary/65";
  return "bg-primary/90";
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_LABELS: [number, string][] = [[1, "Mon"], [3, "Wed"], [5, "Fri"]];

export function ContributionHeatmap({ data, months, onDayClick }: ContributionHeatmapProps) {
  const { days, monthLabels } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Start date: N months ago, aligned to the previous Sunday
    const start = new Date(today);
    start.setMonth(start.getMonth() - months);
    const dayOfWeek = start.getDay(); // 0=Sun
    start.setDate(start.getDate() - dayOfWeek);

    const allDays: string[] = [];
    const labels: { label: string; col: number }[] = [];
    let lastMonth = -1;
    const cursor = new Date(start);

    while (cursor <= today) {
      const dateStr = formatDate(cursor);
      allDays.push(dateStr);

      // Track month labels at the first day of each new month that falls on row 0 (Sunday)
      const m = cursor.getMonth();
      if (m !== lastMonth) {
        const col = Math.floor(allDays.length / 7);
        labels.push({ label: SHORT_MONTHS[m], col });
        lastMonth = m;
      }

      cursor.setDate(cursor.getDate() + 1);
    }

    return { days: allDays, monthLabels: labels };
  }, [data, months]);

  const totalWeeks = Math.ceil(days.length / 7);

  return (
    <div className="space-y-1">
      {/* Month labels */}
      <div className="flex text-[10px] text-muted-foreground ml-8">
        <div
          className="grid grid-flow-col"
          style={{
            gridTemplateColumns: `repeat(${totalWeeks}, 1fr)`,
          }}
        >
          {Array.from({ length: totalWeeks }, (_, i) => {
            const label = monthLabels.find((m) => m.col === i);
            return (
              <span key={i} className="text-center">
                {label?.label ?? ""}
              </span>
            );
          })}
        </div>
      </div>

      <div className="flex gap-1">
        {/* Day-of-week labels */}
        <div className="grid grid-rows-7 gap-[3px] text-[10px] text-muted-foreground w-6 shrink-0">
          {Array.from({ length: 7 }, (_, i) => {
            const match = DAY_LABELS.find(([row]) => row === i);
            return (
              <span key={i} className="h-3 flex items-center justify-end pr-0.5">
                {match?.[1] ?? ""}
              </span>
            );
          })}
        </div>

        {/* Heatmap grid */}
        <div className="overflow-x-auto">
          <div
            className="grid grid-rows-7 grid-flow-col gap-[3px]"
            style={{ gridTemplateRows: "repeat(7, 12px)" }}
          >
            {days.map((dateStr) => {
              const count = data.get(dateStr) ?? 0;
              return (
                <div
                  key={dateStr}
                  className={cn(
                    "w-3 h-3 rounded-sm transition-colors",
                    getIntensityClass(count),
                    onDayClick && "cursor-pointer hover:ring-1 hover:ring-foreground/30",
                  )}
                  title={`${dateStr}: ${count} commit${count !== 1 ? "s" : ""}`}
                  onClick={() => onDayClick?.(dateStr)}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-1.5 ml-8 text-[10px] text-muted-foreground">
        <span>Less</span>
        {[0, 1, 3, 6, 7].map((n) => (
          <div key={n} className={cn("w-3 h-3 rounded-sm", getIntensityClass(n))} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
