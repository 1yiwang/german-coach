"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
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

interface ConvexWord {
  _id: Id<"words">;
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
  // Defer Convex hooks until client mount so SSR/prerender doesn't crash on
  // the missing ConvexProvider during `next build`.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <ReviewPageClient />;
}

function ReviewPageClient() {
  const convexConfigured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
  const words = useQuery(api.words.dueForReview, {}) as
    | ConvexWord[]
    | undefined;
  const recordReview = useMutation(api.words.recordReview);

  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());
  const [showAnswer, setShowAnswer] = useState(false);

  // Pending = words returned by Convex that haven't been graded this session yet.
  const pending = useMemo(
    () => (words ?? []).filter((w) => !reviewedIds.has(w._id)),
    [words, reviewedIds],
  );
  const current = pending[0];

  const srsState = (w: ConvexWord): SrsState => ({
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
    const next = calculateNextReview(srsState(current), rating);
    const quality = rating === "again" ? 1 : rating === "hard" ? 3 : rating === "good" ? 4 : 5;

    setReviewedIds((prev) => new Set(prev).add(current._id));
    setShowAnswer(false);

    try {
      await recordReview({
        wordId: current._id,
        quality,
        ease: next.ease,
        interval: next.interval,
        repetitions: next.repetitions,
        nextReview: next.nextReview,
      });
    } catch (err) {
      console.error("recordReview failed", err);
    }
  };

  if (!convexConfigured) {
    return <NotConfiguredState />;
  }

  if (words === undefined) {
    return (
      <div className="flex flex-col gap-6">
        <header className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            复习
          </h1>
          <p className="text-sm text-muted-foreground">
            从 Convex 加载词条中……
          </p>
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
              ? "数据库里还没有词条。运行 `npx convex run seed:run` 写入 4 个 demo 词，或在精读页面把新词加进队列。"
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

  const status = statusFromReps(current.repetitions);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            复习
          </h1>
          <p className="text-sm text-muted-foreground">
            剩余 {pending.length} 张 · 算法 SM-2 · 数据源 Convex
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
        v0.2：词条从 Convex `words` 表读，评分通过 `words.recordReview` 写回，下次复习时间由 SM-2 算法计算。
      </p>
    </div>
  );
}

function NotConfiguredState() {
  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          复习
        </h1>
        <p className="text-sm text-muted-foreground">Convex 还没部署</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>等待 Convex 上线</CardTitle>
          <CardDescription>
            这个页面从 Convex `words` 表读数据。需要在终端跑一次设置。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ol className="list-decimal pl-5 space-y-1.5">
            <li>
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                npx convex dev
              </code>{" "}
              （浏览器登录 + 创建 dev deployment，会写入{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                .env.local
              </code>
              ）
            </li>
            <li>
              另起终端：
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                npx convex run seed:run
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
        </CardContent>
      </Card>
    </div>
  );
}
