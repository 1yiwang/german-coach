import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { StudyLogDay } from "@/lib/db/study-log";

interface StudyHeatmapProps {
  days: StudyLogDay[];
  loadError?: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_COUNT = 52;
const DAYS_PER_WEEK = 7;
const MONTHS_DE = [
  "Jan",
  "Feb",
  "Mär",
  "Apr",
  "Mai",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Okt",
  "Nov",
  "Dez",
];

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildRecentDays(totalDays: number): string[] {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end.getTime() - (totalDays - 1) * DAY_MS);
  return Array.from({ length: totalDays }, (_, i) =>
    dateKey(new Date(start.getTime() + i * DAY_MS)),
  );
}

function buildGithubWeeks(): (string | null)[][] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // GitHub-style layout: each column is a calendar week, newest week on
  // the right. Empty cells before the first visible date are placeholders
  // so today stays in the rightmost column instead of the chart bunching
  // up on the left.
  const lastColumnStart = new Date(today);
  lastColumnStart.setDate(today.getDate() - today.getDay());
  const firstColumnStart = new Date(lastColumnStart);
  firstColumnStart.setDate(
    lastColumnStart.getDate() - (WEEK_COUNT - 1) * DAYS_PER_WEEK,
  );

  const visibleStart = new Date(today);
  visibleStart.setDate(
    today.getDate() - (WEEK_COUNT * DAYS_PER_WEEK - 1),
  );

  return Array.from({ length: WEEK_COUNT }, (_, weekIndex) =>
    Array.from({ length: DAYS_PER_WEEK }, (_, dayIndex) => {
      const date = new Date(firstColumnStart);
      date.setDate(
        firstColumnStart.getDate() + weekIndex * DAYS_PER_WEEK + dayIndex,
      );
      if (date < visibleStart || date > today) return null;
      return dateKey(date);
    }),
  );
}

function intensity(score: number): number {
  if (score <= 0) return 0;
  if (score <= 5) return 1;
  if (score <= 15) return 2;
  if (score <= 25) return 3;
  return 4;
}

function cellClass(score: number): string {
  switch (intensity(score)) {
    case 1:
      return "bg-emerald-200 dark:bg-emerald-900/60";
    case 2:
      return "bg-emerald-400 dark:bg-emerald-700";
    case 3:
      return "bg-emerald-600 dark:bg-emerald-500";
    case 4:
      return "bg-emerald-800 dark:bg-emerald-300";
    default:
      return "bg-muted";
  }
}

function formatDate(key: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    month: "short",
    day: "2-digit",
  }).format(new Date(`${key}T00:00:00`));
}

function currentStreak(
  keys: string[],
  byDate: Map<string, StudyLogDay>,
): number {
  let streak = 0;
  for (let i = keys.length - 1; i >= 0; i--) {
    const score = byDate.get(keys[i])?.effortScore ?? 0;
    if (score <= 0) break;
    streak++;
  }
  return streak;
}

/**
 * Map of column index → German month abbreviation, shown above the
 * first column where a new month begins. Mirrors GitHub's behaviour:
 * the month label sits above the column that contains the 1st-7th of
 * that month.
 */
function buildMonthLabels(weeks: (string | null)[][]): Map<number, string> {
  const labels = new Map<number, string>();
  let prevMonth: number | null = null;
  weeks.forEach((week, weekIndex) => {
    const firstKey = week.find((k): k is string => k !== null);
    if (!firstKey) return;
    const month = Number(firstKey.slice(5, 7)) - 1;
    if (month !== prevMonth) {
      labels.set(weekIndex, MONTHS_DE[month]);
      prevMonth = month;
    }
  });
  return labels;
}

function longestStreak(
  keys: string[],
  byDate: Map<string, StudyLogDay>,
): number {
  let best = 0;
  let current = 0;
  for (const key of keys) {
    const score = byDate.get(key)?.effortScore ?? 0;
    if (score > 0) {
      current++;
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  }
  return best;
}

export function StudyHeatmap({ days, loadError }: StudyHeatmapProps) {
  const keys = buildRecentDays(WEEK_COUNT * DAYS_PER_WEEK);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const weeks = buildGithubWeeks();
  const monthLabels = buildMonthLabels(weeks);
  const today = byDate.get(keys[keys.length - 1]);
  const totalEffort = days.reduce((sum, d) => sum + d.effortScore, 0);
  const totalSentences = days.reduce((sum, d) => sum + d.sentencesStudied, 0);
  const streak = currentStreak(keys, byDate);
  const best = longestStreak(keys, byDate);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>📊 Lern-Heatmap</CardTitle>
            <CardDescription>
              Deine tägliche Arbeit sichtbar machen, ohne Druck.
            </CardDescription>
          </div>
          <Badge variant="secondary">🔥 {streak} Tage</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadError ? (
          <p className="text-sm text-muted-foreground">
            Heatmap noch nicht verfügbar: {loadError}
          </p>
        ) : (
          <>
            {/* GitHub-style heatmap. ONE big CSS grid with explicit
                placement:
                  • column 1   = day-of-week labels (auto width, ~20 px)
                  • columns 2-53 = 52 calendar weeks, equal-share (1fr)
                  • row 1      = month labels (12 px tall)
                  • rows 2-8   = 7 weekdays
                Cells use aspectRatio "1 / 1" so they're perfectly
                square and shrink/grow with the card width. 3 px gaps
                give the visible separation between cells that the
                previous fixed-width layout was hiding. */}
            <div className="pb-1">
              <div
                className="grid"
                style={{
                  gridTemplateColumns: "auto repeat(52, minmax(0, 1fr))",
                  gridTemplateRows: "12px repeat(7, auto)",
                  columnGap: "6px",
                  rowGap: "6px",
                }}
              >
                {/* Top-left corner (empty) */}
                <div style={{ gridRow: 1, gridColumn: 1 }} />

                {/* Month labels — row 1, columns 2-53. */}
                {weeks.map((_, weekIndex) => (
                  <div
                    key={`m-${weekIndex}`}
                    className="whitespace-nowrap text-[10px] leading-none text-muted-foreground"
                    style={{ gridRow: 1, gridColumn: weekIndex + 2 }}
                  >
                    {monthLabels.get(weekIndex) ?? ""}
                  </div>
                ))}

                {/* Day-of-week labels — column 1, rows 2-8 (Mo / Mi / Fr). */}
                {[0, 1, 2, 3, 4, 5, 6].map((rowIdx) => (
                  <div
                    key={`d-${rowIdx}`}
                    className="flex items-center pr-1 text-[10px] leading-none text-muted-foreground"
                    style={{ gridRow: rowIdx + 2, gridColumn: 1 }}
                  >
                    {rowIdx === 1
                      ? "Mo"
                      : rowIdx === 3
                        ? "Mi"
                        : rowIdx === 5
                          ? "Fr"
                          : ""}
                  </div>
                ))}

                {/* Heatmap cells. Flatten weeks×days into individual
                    grid items with explicit row/column placement. */}
                {weeks.flatMap((week, weekIndex) =>
                  week.map((key, dayIndex) => {
                    const placement = {
                      gridRow: dayIndex + 2,
                      gridColumn: weekIndex + 2,
                    };
                    if (!key) {
                      return (
                        <div
                          key={`empty-${weekIndex}-${dayIndex}`}
                          style={{ ...placement, aspectRatio: "1 / 1" }}
                          className="rounded-[2px] opacity-0"
                        />
                      );
                    }
                    const day = byDate.get(key);
                    const score = day?.effortScore ?? 0;
                    return (
                      <div
                        key={`c-${weekIndex}-${dayIndex}`}
                        title={`${formatDate(key)} · ${score} Punkte · ${day?.sentencesStudied ?? 0} Sätze`}
                        style={{ ...placement, aspectRatio: "1 / 1" }}
                        className={cn(
                          "rounded-[2px] ring-1 ring-foreground/5",
                          cellClass(score),
                        )}
                      />
                    );
                  }),
                )}
              </div>
            </div>

            <div className="grid gap-2 text-sm sm:grid-cols-4">
              <Metric label="Heute" value={`${today?.effortScore ?? 0} P`} />
              <Metric label="Sätze" value={`${totalSentences}`} />
              <Metric label="Streak" value={`${streak} Tage`} />
              <Metric label="Best" value={`${best} Tage`} />
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span>Weniger</span>
              {[0, 1, 2, 3, 4].map((level) => (
                <span
                  key={level}
                  className={cn(
                    "h-3 w-3 rounded-[3px] ring-1 ring-foreground/5",
                    cellClass(level === 0 ? 0 : level === 1 ? 3 : level * 8),
                  )}
                />
              ))}
              <span>Mehr</span>
              <span className="ml-auto hidden sm:inline">
                52 Wochen · {totalEffort} Punkte
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}
