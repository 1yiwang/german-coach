"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LibraryDocStat } from "@/lib/db/listen-progress";

/**
 * S2 · 🏰 文库 BOSS 地图.
 *
 * Renders the 27 imported lessons as a "world map" of relevant
 * lessons: each card is a relevant lesson (or a "boss fight"), HP bar
 * = mastered/total, due-count badge = pending SRS reviews, status
 * emoji = unexplored / battling / conquered.
 *
 * Pure cosmetic — no SRS logic, no new data writes. All values come
 * from `listLibraryStats()` (server-aggregated `sentence_progress`).
 *
 * Tab filters intentionally use plain buttons (no shadcn Tabs) to keep
 * the component self-contained and avoid a new dependency surface.
 */

export type LibraryDoc = {
  id: string;
  title: string;
  source?: string;
  level?: string;
  totalSentences: number;
  createdAt: number;
};

interface LibraryGridProps {
  docs: LibraryDoc[];
  stats: LibraryDocStat[];
  showDemo: boolean;
  demoTitle: string;
  demoSentenceCount: number;
  demoLevel: string;
}

type TabKey = "all" | "active" | "due" | "mastered";

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "Alle" },
  { key: "active", label: "Aktiv" },
  { key: "due", label: "Fällig" },
  { key: "mastered", label: "Besiegt" },
];

type LessonStatus = "unexplored" | "battling" | "conquered";

interface MergedDoc extends LibraryDoc {
  stat: LibraryDocStat;
  status: LessonStatus;
  progress: number;
}

function deriveStatus(stat: LibraryDocStat): LessonStatus {
  if (stat.total === 0) return "unexplored";
  if (stat.masteredCount >= stat.total) return "conquered";
  if (
    stat.masteredCount === 0 &&
    stat.learningCount === 0 &&
    stat.skippedCount === 0
  ) {
    return "unexplored";
  }
  return "battling";
}

const STATUS_META: Record<
  LessonStatus,
  { emoji: string; label: string; tone: string; ringTone: string }
> = {
  conquered: {
    emoji: "🎉",
    label: "Besiegt",
    tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    ringTone: "ring-emerald-500/40",
  },
  battling: {
    emoji: "⚔️",
    label: "Im Kampf",
    tone: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
    ringTone: "ring-sky-500/40",
  },
  unexplored: {
    emoji: "🏚️",
    label: "Unerforscht",
    tone: "bg-muted text-muted-foreground",
    ringTone: "ring-foreground/10",
  },
};

function formatLastReview(ms?: number): string | null {
  if (!ms) return null;
  const diff = Date.now() - ms;
  if (diff < 60_000) return "gerade eben";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "gestern";
  if (days < 7) return `vor ${days} Tagen`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `vor ${weeks} Wo.`;
  const months = Math.floor(days / 30);
  return `vor ${months} Mon.`;
}

export function LibraryGrid({
  docs,
  stats,
  showDemo,
  demoTitle,
  demoSentenceCount,
  demoLevel,
}: LibraryGridProps) {
  const [tab, setTab] = useState<TabKey>("all");

  const merged: MergedDoc[] = useMemo(() => {
    const statById = new Map(stats.map((s) => [s.documentId, s]));
    return docs.map((doc) => {
      const stat: LibraryDocStat =
        statById.get(doc.id) ?? {
          documentId: doc.id,
          total: doc.totalSentences,
          newCount: doc.totalSentences,
          learningCount: 0,
          masteredCount: 0,
          skippedCount: 0,
          dueCount: 0,
        };
      const status = deriveStatus(stat);
      const progress =
        stat.total > 0 ? Math.round((stat.masteredCount / stat.total) * 100) : 0;
      return { ...doc, stat, status, progress };
    });
  }, [docs, stats]);

  const counts = useMemo(() => {
    let active = 0;
    let due = 0;
    let mastered = 0;
    for (const m of merged) {
      if (m.status === "battling") active++;
      if (m.stat.dueCount > 0) due++;
      if (m.status === "conquered") mastered++;
    }
    return { all: merged.length, active, due, mastered };
  }, [merged]);

  const filtered = useMemo(() => {
    if (tab === "all") return merged;
    if (tab === "active") return merged.filter((m) => m.status === "battling");
    if (tab === "due") return merged.filter((m) => m.stat.dueCount > 0);
    return merged.filter((m) => m.status === "conquered");
  }, [merged, tab]);

  const totalSentences = merged.reduce((acc, m) => acc + m.stat.total, 0);
  const totalMastered = merged.reduce(
    (acc, m) => acc + m.stat.masteredCount,
    0,
  );
  const totalDue = merged.reduce((acc, m) => acc + m.stat.dueCount, 0);

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-3">
        <div className="flex items-center gap-2">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Bibliothek
          </h1>
          <Badge variant="secondary" className="text-xs">
            🏰 Weltkarte
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {merged.length} Lektion{merged.length === 1 ? "" : "en"} · insgesamt{" "}
          {totalSentences} Sätze · {totalMastered} besiegt
          {totalDue > 0 ? ` · ${totalDue} fällig` : ""}
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const count =
            t.key === "all"
              ? counts.all
              : t.key === "active"
                ? counts.active
                : t.key === "due"
                  ? counts.due
                  : counts.mastered;
          const isActive = tab === t.key;
          return (
            <Button
              key={t.key}
              type="button"
              variant={isActive ? "default" : "outline"}
              size="sm"
              onClick={() => setTab(t.key)}
              className="gap-2"
            >
              <span>{t.label}</span>
              <span
                className={cn(
                  "rounded-full px-1.5 text-xs leading-5",
                  isActive
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {count}
              </span>
            </Button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            {tab === "due"
              ? "Heute ist gerade nichts fällig — gut gemacht!"
              : tab === "mastered"
                ? "Noch keine Lektion komplett besiegt. Weiter so!"
                : tab === "active"
                  ? "Keine Lektion gerade im Kampf. Wähle eine 🏚️ Lektion zum Starten."
                  : "Keine Lektionen."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {showDemo && tab === "all" && (
            <DemoCard
              title={demoTitle}
              level={demoLevel}
              sentenceCount={demoSentenceCount}
            />
          )}
          {filtered.map((m) => (
            <LessonCard key={m.id} doc={m} />
          ))}
        </div>
      )}
    </div>
  );
}

function LessonCard({ doc }: { doc: MergedDoc }) {
  const meta = STATUS_META[doc.status];
  const lastLabel = formatLastReview(doc.stat.lastReviewedAt);
  const hpPct = doc.progress;
  return (
    <Link
      href={`/listen?id=${doc.id}`}
      className="group block focus:outline-none"
    >
      <Card
        className={cn(
          "h-full transition-colors group-hover:border-foreground/40",
          "ring-1",
          meta.ringTone,
        )}
      >
        <CardContent className="flex h-full flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-1.5">
                <span aria-hidden className="text-base leading-none">
                  {meta.emoji}
                </span>
                <h3 className="truncate font-heading text-base font-semibold leading-snug">
                  {doc.title}
                </h3>
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {doc.source ?? "—"}
              </p>
            </div>
            {doc.stat.dueCount > 0 && (
              <Badge
                variant="destructive"
                className="shrink-0 gap-1 text-[10px]"
              >
                <span aria-hidden>🔔</span>
                {doc.stat.dueCount} fällig
              </Badge>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  doc.status === "conquered"
                    ? "bg-emerald-500"
                    : doc.status === "battling"
                      ? "bg-sky-500"
                      : "bg-muted-foreground/30",
                )}
                style={{ width: `${hpPct}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                HP {doc.stat.masteredCount}/{doc.stat.total}
              </span>
              <span>{hpPct}%</span>
            </div>
          </div>

          <div className="mt-auto flex flex-wrap items-center gap-1.5 text-[11px]">
            <span
              className={cn("rounded-md px-2 py-0.5 font-medium", meta.tone)}
            >
              {meta.label}
            </span>
            {doc.level && (
              <Badge variant="outline" className="text-[10px]">
                {doc.level}
              </Badge>
            )}
            {doc.stat.learningCount > 0 && (
              <span className="text-muted-foreground">
                ⚔️ {doc.stat.learningCount}
              </span>
            )}
            {doc.stat.skippedCount > 0 && (
              <span className="text-muted-foreground">
                🚫 {doc.stat.skippedCount}
              </span>
            )}
            {lastLabel && (
              <span className="ml-auto text-muted-foreground">
                🕐 {lastLabel}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function DemoCard({
  title,
  level,
  sentenceCount,
}: {
  title: string;
  level: string;
  sentenceCount: number;
}) {
  return (
    <Link href="/listen?id=demo" className="group block focus:outline-none">
      <Card className="h-full border-dashed transition-colors group-hover:border-foreground/40">
        <CardContent className="flex h-full flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-1.5">
                <span aria-hidden className="text-base leading-none">
                  🧪
                </span>
                <h3 className="truncate font-heading text-base font-semibold leading-snug">
                  {title}
                </h3>
              </div>
              <p className="truncate text-xs text-muted-foreground">
                Demo · ohne Supabase
              </p>
            </div>
          </div>
          <div className="mt-auto flex items-center gap-1.5 text-[11px]">
            <Badge variant="outline" className="text-[10px]">
              {level}
            </Badge>
            <span className="text-muted-foreground">{sentenceCount} Sätze</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
