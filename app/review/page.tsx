"use client";

import { useMemo, useState } from "react";
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
  initialSrsState,
  intervalLabel,
  statusLabel,
  type ReviewRating,
  type SrsState,
  WordStatus,
} from "@/lib/srs";

interface ReviewCard {
  id: string;
  word: string;
  definition: string;
  example: string;
  srs: SrsState;
  status: WordStatus;
}

const seedCards: ReviewCard[] = [
  {
    id: "1",
    word: "besuchen",
    definition: "v. 拜访 / 参加（课程、活动）",
    example: "Anna hat gestern einen neuen Deutschkurs besucht.",
    srs: initialSrsState(),
    status: WordStatus.New,
  },
  {
    id: "2",
    word: "nervös",
    definition: "adj. 紧张的、神经质的",
    example: "Sie war ein bisschen nervös.",
    srs: initialSrsState(),
    status: WordStatus.New,
  },
  {
    id: "3",
    word: "vorstellen",
    definition: "v. sich vorstellen 自我介绍 / vorstellen 介绍、设想",
    example: "Die Lehrerin hat sich vorgestellt.",
    srs: initialSrsState(),
    status: WordStatus.New,
  },
  {
    id: "4",
    word: "austauschen",
    definition: "v. trennbar 交换",
    example: "Sie haben ihre Telefonnummern ausgetauscht.",
    srs: initialSrsState(),
    status: WordStatus.New,
  },
];

const ratingButtons: { rating: ReviewRating; label: string; variant: "destructive" | "outline" | "secondary" | "default" }[] = [
  { rating: "again", label: "又错了", variant: "destructive" },
  { rating: "hard", label: "有点难", variant: "outline" },
  { rating: "good", label: "记得", variant: "secondary" },
  { rating: "easy", label: "很简单", variant: "default" },
];

export default function ReviewPage() {
  const [cards, setCards] = useState(seedCards);
  const [showAnswer, setShowAnswer] = useState(false);

  const remaining = cards.length;
  const current = cards[0];

  const previewIntervals = useMemo(() => {
    if (!current) return null;
    return ratingButtons.map((b) => ({
      ...b,
      preview: intervalLabel(current.srs, b.rating),
    }));
  }, [current]);

  const handleRating = (rating: ReviewRating) => {
    if (!current) return;
    const next = calculateNextReview(current.srs, rating);

    setCards((prev) => {
      const [, ...rest] = prev;
      if (rating === "again") {
        return [
          ...rest,
          { ...current, srs: next, status: next.status },
        ];
      }
      return rest;
    });
    setShowAnswer(false);
  };

  if (!current) {
    return (
      <div className="flex flex-col gap-6">
        <header className="space-y-2">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            复习
          </h1>
          <p className="text-sm text-muted-foreground">
            今天全部复习完了。
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

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            复习
          </h1>
          <p className="text-sm text-muted-foreground">
            剩余 {remaining} 张 · 算法 SM-2（移植自 Lumina）
          </p>
        </div>
        <Badge variant="outline">{statusLabel(current.status)}</Badge>
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
              <p className="text-muted-foreground italic">
                例：{current.example}
              </p>
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
        v0.1：词条来自硬编码的 4 个 demo 词。v0.3 接 Convex 后，精读页面「加入复习」+ 对话中的生词会真正流入这里。
      </p>
    </div>
  );
}
