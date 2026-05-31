import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { StudyLogDay } from "@/lib/db/study-log";

interface StudyHeatmapProps {
  days: StudyLogDay[];
  loadError?: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildRecentDays(totalDays: number): string[] {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end.getTime() - (totalDays - 1) * DAY_MS);
  return Array.from({ length: totalDays }, (_, i) =>
    dateKey(new Date(start.getTime() + i * DAY_MS)),
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

function splitWeeks(keys: string[]): string[][] {
  const weeks: string[][] = [];
  for (let i = 0; i < keys.length; i += 7) {
    weeks.push(keys.slice(i, i + 7));
  }
  return weeks;
}

function currentStreak(keys: string[], byDate: Map<string, StudyLogDay>): number {
  let streak = 0;
  for (let i = keys.length - 1; i >= 0; i--) {
    const score = byDate.get(keys[i])?.effortScore ?? 0;
    if (score <= 0) break;
    streak++;
  }
  return streak;
}

function longestStreak(keys: string[], byDate: Map<string, StudyLogDay>): number {
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
  const keys = buildRecentDays(91);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const weeks = splitWeeks(keys);
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
            <div className="overflow-x-auto pb-1">
              <div className="flex min-w-max gap-1">
                {weeks.map((week, weekIndex) => (
                  <div key={weekIndex} className="grid grid-rows-7 gap-1">
                    {week.map((key) => {
                      const day = byDate.get(key);
                      const score = day?.effortScore ?? 0;
                      return (
                        <div
                          key={key}
                          title={`${formatDate(key)} · ${score} Punkte · ${day?.sentencesStudied ?? 0} Sätze`}
                          className={cn(
                            "h-3 w-3 rounded-[3px] ring-1 ring-foreground/5",
                            cellClass(score),
                          )}
                        />
                      );
                    })}
                  </div>
                ))}
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
                90 Tage · {totalEffort} Punkte
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
