import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { SentenceStatus } from "@/lib/db/listen-progress";

export interface HardSentence {
  index: number;
  text: string;
  repetitions: number;
  status: SentenceStatus;
}

export interface ArticleSummaryStats {
  totalSentences: number;
  masteredCount: number;
  learningCount: number;
  skippedCount: number;
  newCount: number;
  firstReviewAt?: number;
  lastReviewAt?: number;
  hardestSentences: HardSentence[];
}

interface ArticleSummaryProps {
  title: string;
  stats: ArticleSummaryStats;
  sessionReplayCount: number;
  sessionBossBreaks: number;
  onRestart: () => void;
}

function formatDuration(start?: number, end?: number): string {
  if (!start || !end || end <= start) return "heute";
  const minutes = Math.max(1, Math.round((end - start) / 60_000));
  if (minutes < 60) return `${minutes} Min.`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  if (hours < 24) return `${hours} Std.`;
  const days = Math.ceil(hours / 24);
  return `${days} Tage`;
}

const STATUS_TONE: Record<SentenceStatus, string> = {
  new: "bg-muted text-muted-foreground",
  learning: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  mastered: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  skipped: "bg-muted text-muted-foreground",
};

export function ArticleSummary({
  title,
  stats,
  sessionReplayCount,
  sessionBossBreaks,
  onRestart,
}: ArticleSummaryProps) {
  const masteredPct =
    stats.totalSentences > 0
      ? Math.round((stats.masteredCount / stats.totalSentences) * 100)
      : 0;

  return (
    <Card className="border-emerald-500/40 bg-emerald-500/5 shadow-sm shadow-emerald-500/10">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>🎉 Lektion abgeschlossen</CardTitle>
            <CardDescription className="line-clamp-2">
              {title} · dein Kampfbericht
            </CardDescription>
          </div>
          <Badge variant="secondary" className="text-xs">
            {masteredPct}% HP
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-4">
          <Metric
            label="Besiegt"
            value={`${stats.masteredCount}/${stats.totalSentences}`}
          />
          <Metric label="Dauer" value={formatDuration(stats.firstReviewAt, stats.lastReviewAt)} />
          <Metric label="Replays" value={`${sessionReplayCount}`} />
          <Metric label="Breaks" value={`${sessionBossBreaks}`} />
        </div>

        <div className="rounded-lg border bg-background/70 p-3">
          <div className="mb-2 flex flex-wrap gap-2 text-xs">
            <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-emerald-700 dark:text-emerald-300">
              ✅ {stats.masteredCount} gemeistert
            </span>
            <span className="rounded-md bg-sky-500/15 px-2 py-0.5 text-sky-700 dark:text-sky-300">
              🔄 {stats.learningCount} lernen
            </span>
            <span className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground">
              🌱 {stats.newCount} neu
            </span>
            {stats.skippedCount > 0 && (
              <span className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground">
                🚫 {stats.skippedCount} übersprungen
              </span>
            )}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${masteredPct}%` }}
            />
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-medium">🔥 Schwerste Sätze</h3>
          {stats.hardestSentences.length > 0 ? (
            <div className="space-y-2">
              {stats.hardestSentences.map((sentence) => (
                <div
                  key={`${sentence.index}-${sentence.repetitions}`}
                  className="rounded-lg border bg-background/70 p-3 text-sm"
                >
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono text-muted-foreground">
                      Satz {sentence.index + 1}
                    </span>
                    <span
                      className={`rounded-md px-2 py-0.5 ${STATUS_TONE[sentence.status]}`}
                    >
                      {sentence.repetitions}× · {sentence.status}
                    </span>
                  </div>
                  <p className="line-clamp-2 leading-relaxed">{sentence.text}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Noch keine schwierigen Sätze. Das ist ein guter Anfang.
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" onClick={onRestart}>
            ↻ Noch einmal
          </Button>
          <Link href="/listen">
            <Button size="sm" variant="outline">
              🏰 Zur Bibliothek
            </Button>
          </Link>
          <Link href="/review">
            <Button size="sm" variant="outline">
              📚 Wiederholen
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-background/70 px-3 py-2 ring-1 ring-foreground/10">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}
