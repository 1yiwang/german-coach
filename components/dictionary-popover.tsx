"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface WordPopover {
  sentenceIndex: number;
  word: string;
  sentence: string;
  x: number;
  y: number;
}

export interface LookupState {
  status: "loading" | "ready" | "error";
  data?: {
    word: string;
    pos: string;
    meaningZh: string;
    meaningEn: string;
    collocations: string[];
    examples: string[];
    inflection: string;
  };
  error?: string;
}

interface DictionaryPopoverProps {
  popover: WordPopover;
  lookup: LookupState;
  alreadyAdded: boolean;
  sourceRef: string;
  onAdded: (word: string) => void;
  onClose: () => void;
}

export function DictionaryPopover({
  popover,
  lookup,
  alreadyAdded,
  sourceRef,
  onAdded,
  onClose,
}: DictionaryPopoverProps) {
  // Clamp popover to viewport so it never falls off the right edge.
  const ref = useRef<HTMLDivElement>(null);
  const [adjusted, setAdjusted] = useState({ x: popover.x, y: popover.y });
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const overflowX = rect.right - (window.innerWidth - 8);
    setAdjusted({
      x: overflowX > 0 ? popover.x - overflowX : popover.x,
      y: popover.y,
    });
  }, [popover.x, popover.y]);

  const handleAdd = async () => {
    if (lookup.status !== "ready" || !lookup.data) return;
    const word = lookup.data.word || popover.word;
    setAdding(true);
    try {
      const res = await fetch("/api/words/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word,
          definition: lookup.data.meaningZh,
          exampleSentence: popover.sentence,
          source: "reading",
          sourceRef,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      onAdded(word);
      toast.success(`已加入复习队列：${word}`, {
        description: "明天 /review 会出现这张卡。",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error("加入失败", { description: message });
    } finally {
      setAdding(false);
    }
  };

  return (
    <div
      ref={ref}
      className="absolute z-50 w-80 max-w-[calc(100vw-1rem)] rounded-lg border bg-popover text-popover-foreground shadow-lg p-4 space-y-3"
      style={{ left: adjusted.x, top: adjusted.y }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-heading text-lg font-semibold break-all">
          {lookup.data?.word ?? popover.word}
        </span>
        <div className="flex items-center gap-2">
          {lookup.data?.pos && (
            <Badge variant="outline" className="text-xs">
              {lookup.data.pos}
            </Badge>
          )}
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-sm"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
      </div>

      {lookup.status === "loading" && (
        <div className="text-sm text-muted-foreground italic">查询中…</div>
      )}
      {lookup.status === "error" && (
        <div className="text-xs text-destructive">
          查询失败：{lookup.error}
        </div>
      )}
      {lookup.status === "ready" && lookup.data && (
        <div className="space-y-2 text-sm">
          <p className="font-medium">{lookup.data.meaningZh}</p>
          {lookup.data.meaningEn && (
            <p className="text-xs text-muted-foreground">
              {lookup.data.meaningEn}
            </p>
          )}
          {lookup.data.inflection && (
            <p className="text-xs">
              <span className="text-muted-foreground">变形：</span>
              {lookup.data.inflection}
            </p>
          )}
          {lookup.data.collocations?.length > 0 && (
            <div>
              <div className="text-xs text-muted-foreground">搭配</div>
              <ul className="list-disc pl-5 text-xs">
                {lookup.data.collocations.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          {lookup.data.examples?.length > 0 && (
            <div>
              <div className="text-xs text-muted-foreground">例句</div>
              <ul className="list-disc pl-5 text-xs space-y-1">
                {lookup.data.examples.map((ex, i) => (
                  <li key={i}>{ex}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <Button
        size="sm"
        variant={alreadyAdded ? "secondary" : "outline"}
        className="w-full"
        disabled={
          lookup.status !== "ready" || !lookup.data || adding || alreadyAdded
        }
        onClick={handleAdd}
      >
        {alreadyAdded
          ? "✓ 已加入复习队列"
          : adding
            ? "加入中…"
            : "+ 加入复习队列"}
      </Button>
    </div>
  );
}
