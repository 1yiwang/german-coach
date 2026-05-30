"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  calculateNextReview,
  intervalLabel,
  statusLabel,
  WordStatus,
  type ReviewRating,
  type SrsState,
} from "@/lib/srs";

interface ReviewWord {
  id: string;
  word: string;
  definition: string;
  exampleSentence?: string;
  ease: number;
  interval: number;
  repetitions: number;
  nextReview: number;
  lastReview?: number;
}

const ratingButtons: {
  rating: ReviewRating;
  label: string;
  variant: "destructive" | "outline" | "secondary" | "default";
}[] = [
  { rating: "again", label: "又错了", variant: "destructive" },
  { rating: "hard", label: "有点难", variant: "outline" },
  { rating: "good", label: "记得", variant: "secondary" },
  { rating: "easy", label: "很简单", variant: "default" },
];

function statusFromReps(reps: number, lastRating?: ReviewRating): WordStatus {
  if (lastRating === "again") return WordStatus.Learning1;
  if (reps >= 4) return WordStatus.WellKnown;
  if (reps === 0) return WordStatus.New;
  return Math.min(WordStatus.Learning4, reps + 1) as WordStatus;
}

export default function ReviewPage() {
  const [words, setWords] = useState<ReviewWord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());
  const [showAnswer, setShowAnswer] = useState(false);

  const loadDue = useCallback(async () => {
    try {
      const res = await fetch("/api/words/due", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const { words: payload } = (await res.json()) as { words: ReviewWord[] };
      setWords(payload);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Unknown error");
      setWords([]);
    }
  }, []);

  useEffect(() => {
    loadDue();
  }, [loadDue]);

  const pending = useMemo(
    () => (words ?? []).filter((w) => !reviewedIds.has(w.id)),
    [words, reviewedIds],
  );
  const current = pending[0];

  const srsState = (w: ReviewWord): SrsState => ({
    ease: w.ease,
    interval: w.interval,
    repetitions: w.repetitions,
    lastReview: w.lastReview,
    nextReview: w.nextReview,
  });

  const previewIntervals = useMemo(() => {
    if (!current) return null;
    return ratingButtons.map((b) => ({
      ...b,
      preview: intervalLabel(srsState(current), b.rating),
    }));
  }, [current]);

  const handleRating = async (rating: ReviewRating) => {
    if (!current) return;
    setReviewedIds((prev) => new Set(prev).add(current.id));
    setShowAnswer(false);
    try {
      const res = await fetch("/api/words/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wordId: current.id, rating }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
    } catch (err) {
      console.error("recordReview failed", err);
    }
  };

  if (loadError && (words?.length ?? 0) === 0) {
    return <NotConfiguredState error={loadError} />;
  }

  if (words === null) {
    return (
      <div className="flex flex-col gap-6">
        <header className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            复习
          </h1>
          <p className="text-sm text-muted-foreground">从 Supabase 加载词条中……</p>
        </header>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="flex flex-col gap-6">
        <header className="space-y-2">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            复习
          </h1>
          <p className="text-sm text-muted-foreground">
            {words.length === 0
              ? "数据库里还没有词条。运行 `npm run seed` 写入 4 个 demo 词，或在精读页面把新词加进队列。"
              : "今天全部复习完了。"}
          </p>
        </header>
        <Card>
          <CardHeader>
            <CardTitle>Gut gemacht! 🎉</CardTitle>
            <CardDescription>
              SM-2 已根据你的回答更新了下次复习时间。回来明天再战。
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const previewSrs = calculateNextReview(srsState(current), "good");
  const status = statusFromReps(current.repetitions);
  void previewSrs;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            复习
          </h1>
          <p className="text-sm text-muted-foreground">
            剩余 {pending.length} 张 · 算法 SM-2 · 数据源 Supabase
          </p>
        </div>
        <Badge variant="outline">{statusLabel(status)}</Badge>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-3xl font-heading">
            {current.word}
          </CardTitle>
          <CardDescription>这个词是什么意思？</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {showAnswer ? (
            <div className="space-y-2 text-sm">
              <p className="font-medium">{current.definition}</p>
              {current.exampleSentence && (
                <p className="text-muted-foreground italic">
                  例：{current.exampleSentence}
                </p>
              )}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground italic">
              想好了再点「显示答案」。
            </div>
          )}

          {!showAnswer ? (
            <Button onClick={() => setShowAnswer(true)} size="lg">
              显示答案
            </Button>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {previewIntervals?.map((b) => (
                <Button
                  key={b.rating}
                  variant={b.variant}
                  onClick={() => handleRating(b.rating)}
                  className="flex flex-col h-auto py-3 gap-1"
                >
                  <span>{b.label}</span>
                  <span className="text-xs font-mono opacity-75">
                    {b.preview}
                  </span>
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground border-l-2 border-border pl-3 italic">
        v0.2.5：词条从 Supabase `words` 表读，评分通过 POST `/api/words/review`
        写回（service_role 只在 server-only 路径出现），下次复习时间由 SM-2 算法在服务端计算。
      </p>
    </div>
  );
}

function NotConfiguredState({ error }: { error: string }) {
  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          复习
        </h1>
        <p className="text-sm text-muted-foreground">Supabase 还没配好</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>初始化 Supabase</CardTitle>
          <CardDescription>
            这个页面从 Supabase `words` 表读。需要在终端跑一次初始化。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ol className="list-decimal pl-5 space-y-1.5">
            <li>
              在 Supabase Dashboard → SQL Editor 跑{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                supabase/migrations/0001_init.sql
              </code>
            </li>
            <li>
              把{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                NEXT_PUBLIC_SUPABASE_URL
              </code>
              、
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                NEXT_PUBLIC_SUPABASE_ANON_KEY
              </code>
              、
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                SUPABASE_SERVICE_ROLE_KEY
              </code>{" "}
              填进{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                .env.local
              </code>
            </li>
            <li>
              终端：
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                npm run seed
              </code>
            </li>
            <li>
              重启{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                npm run dev
              </code>
              ，刷新本页
            </li>
          </ol>
          <p className="text-xs text-muted-foreground border-l-2 border-border pl-3 italic">
            报错详情：{error}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
