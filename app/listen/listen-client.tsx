"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DictionaryPopover,
  type LookupState,
  type WordPopover,
} from "@/components/dictionary-popover";
import type { SampleSentence } from "@/lib/sample-article";

interface ListenClientProps {
  docId: string;
  title: string;
  level?: string;
  source?: string;
  sentences: SampleSentence[];
}

export function ListenClient({
  docId,
  title,
  level,
  source,
  sentences,
}: ListenClientProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showText, setShowText] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [addedWords, setAddedWords] = useState<Set<string>>(new Set());
  const [popover, setPopover] = useState<WordPopover | null>(null);
  const [lookup, setLookup] = useState<LookupState | null>(null);

  const currentSentence = sentences[currentIndex];
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === sentences.length - 1;
  const ttsAvailable =
    typeof window !== "undefined" && "speechSynthesis" in window;

  // Per-sentence reset: kill any in-flight TTS + collapse panels.
  useEffect(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setIsPlaying(false);
    setShowText(false);
    setAnalysis(null);
    setIsAnalyzing(false);
    setAnalysisError(null);
  }, [currentIndex]);

  // Component unmount: stop any speech.
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const speak = useCallback(() => {
    if (!ttsAvailable) {
      toast.error("当前浏览器不支持 Web Speech API");
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(currentSentence.original);
    utter.lang = "de-DE";
    utter.rate = 0.8;
    utter.onstart = () => setIsPlaying(true);
    utter.onend = () => setIsPlaying(false);
    utter.onerror = () => setIsPlaying(false);
    window.speechSynthesis.speak(utter);
  }, [currentSentence, ttsAvailable]);

  const stopSpeaking = useCallback(() => {
    if (!ttsAvailable) return;
    window.speechSynthesis.cancel();
    setIsPlaying(false);
  }, [ttsAvailable]);

  const togglePlay = () => {
    if (isPlaying) stopSpeaking();
    else speak();
  };

  const goPrev = () => {
    if (!isFirst) setCurrentIndex((i) => i - 1);
  };
  const goNext = () => {
    if (!isLast) setCurrentIndex((i) => i + 1);
  };

  const handleAnalyze = async () => {
    if (isAnalyzing || analysis) return;
    setIsAnalyzing(true);
    setAnalysisError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sentence: currentSentence.original }),
      });
      const json = (await res.json()) as {
        content?: string;
        error?: string;
      };
      if (!res.ok || json.error) {
        setAnalysisError(json.error ?? `HTTP ${res.status}`);
      } else {
        setAnalysis(json.content ?? "");
      }
    } catch (err) {
      setAnalysisError((err as Error).message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleWordDoubleClick = async (
    e: React.MouseEvent<HTMLSpanElement>,
    sentence: SampleSentence,
    word: string,
  ) => {
    e.stopPropagation();
    const cleaned = word.replace(/[.,!?;:„""()\-]/g, "");
    if (!cleaned) return;
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setPopover({
      sentenceIndex: sentence.index,
      word: cleaned,
      sentence: sentence.original,
      x: rect.left + window.scrollX,
      y: rect.bottom + window.scrollY + 6,
    });
    setLookup({ status: "loading" });
    try {
      const res = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word: cleaned, sentence: sentence.original }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        setLookup({
          status: "error",
          error: json.error ?? `HTTP ${res.status}`,
        });
      } else {
        setLookup({ status: "ready", data: json });
      }
    } catch (err) {
      setLookup({ status: "error", error: (err as Error).message });
    }
  };

  // Keyboard shortcuts: Space=play/pause, ← prev, → next.
  // Disabled while a popover is open or focus is in an input (this page has none).
  useEffect(() => {
    if (popover) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.code === "ArrowLeft") {
        if (!isFirst) goPrev();
      } else if (e.code === "ArrowRight") {
        if (!isLast) goNext();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popover, isFirst, isLast, isPlaying, currentSentence]);

  const progressPct = Math.round(
    ((currentIndex + 1) / sentences.length) * 100,
  );
  const words = currentSentence.original.split(/(\s+)/);

  return (
    <div className="flex flex-col gap-6" onClick={() => setPopover(null)}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-semibold tracking-tight truncate">
            {title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1 truncate">
            {source ?? "—"} · 精听跟读
          </p>
        </div>
        <div className="flex items-center gap-2">
          {level && <Badge>{level}</Badge>}
          <Link
            href="/listen"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← 返回列表
          </Link>
        </div>
      </header>

      {/* Progress strip */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground font-mono">
          <span>
            第 {currentIndex + 1} / {sentences.length} 句
          </span>
          <span>{progressPct}%</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-foreground transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground border-l-2 border-border pl-3 italic">
        提示：先点 ▶ 播放德语 → 自己复述一遍 → 点 「显示原文」核对 → 不懂的词双击查词
        → 单击「解析」让 DeepSeek 拆句。键盘：Space 播放 / ← → 切句。
      </p>

      {/* Main sentence card */}
      <Card>
        <CardContent className="space-y-4">
          {/* Hidden / shown state */}
          <div className="min-h-[88px] flex flex-col justify-center">
            {showText ? (
              <div className="space-y-3">
                <p
                  className="text-lg sm:text-xl leading-relaxed select-text"
                  onClick={(e) => e.stopPropagation()}
                >
                  {words.map((w, i) =>
                    /^\s+$/.test(w) ? (
                      <span key={i}>{w}</span>
                    ) : (
                      <span
                        key={i}
                        onDoubleClick={(e) =>
                          handleWordDoubleClick(e, currentSentence, w)
                        }
                        className="cursor-text hover:bg-accent/60 rounded px-0.5 -mx-0.5 transition-colors"
                      >
                        {w}
                      </span>
                    ),
                  )}
                </p>
                {(currentSentence.translationHint ||
                  currentSentence.grammarTag) && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground pt-1 border-t border-border/40">
                    {currentSentence.grammarTag && (
                      <span>
                        <Badge variant="outline" className="mr-1">
                          语法
                        </Badge>
                        {currentSentence.grammarTag}
                      </span>
                    )}
                    {currentSentence.translationHint && (
                      <span>
                        <Badge variant="outline" className="mr-1">
                          翻译
                        </Badge>
                        {currentSentence.translationHint}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-2xl text-muted-foreground/30 select-none tracking-widest font-mono">
                  ▒▒▒▒▒▒▒▒▒▒▒▒▒
                </div>
                <p className="text-sm text-muted-foreground italic">
                  仔细听，然后试着复述一遍。准备好就点
                  <span className="font-medium"> 显示原文 </span>核对。
                </p>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-border/40 max-[480px]:flex-col">
            <Button
              size="sm"
              variant={isPlaying ? "default" : "outline"}
              onClick={togglePlay}
              disabled={!ttsAvailable}
              title="播放 / 暂停 (Space)"
              className="max-[480px]:w-full"
            >
              {isPlaying ? "⏸ 暂停" : "▶ 播放"}
            </Button>
            <Button
              size="sm"
              variant={showText ? "secondary" : "outline"}
              onClick={() => setShowText((v) => !v)}
              className="max-[480px]:w-full"
            >
              {showText ? "🙈 隐藏原文" : "👁 显示原文"}
            </Button>
            <Button
              size="sm"
              variant={analysis ? "secondary" : "outline"}
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              className="max-[480px]:w-full"
            >
              {isAnalyzing
                ? "🔍 解析中…"
                : analysis
                  ? "🔍 已解析"
                  : "🔍 DeepSeek 解析"}
            </Button>
          </div>

          {/* Analysis panel */}
          {(analysis || analysisError) && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              {analysisError ? (
                <div className="text-destructive text-xs">
                  解析失败：{analysisError}
                  <div className="mt-1 text-muted-foreground not-italic">
                    检查 <code>.env.local</code> 是否配置了
                    <code> DEEPSEEK_API_KEY</code>。
                  </div>
                </div>
              ) : (
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                  {analysis}
                </pre>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Nav: prev / next */}
      <div className="flex justify-between gap-2">
        <Button
          variant="outline"
          onClick={goPrev}
          disabled={isFirst}
          className="max-[480px]:flex-1"
          title="上一句 (←)"
        >
          ← 上一句
        </Button>
        <Button
          onClick={goNext}
          disabled={isLast}
          className="max-[480px]:flex-1"
          title="下一句 (→)"
        >
          下一句 →
        </Button>
      </div>

      {isLast && (
        <Card className="border-dashed">
          <CardContent className="text-sm text-muted-foreground text-center">
            🎉 听完了！可以
            <Link
              href={`/listen?id=${docId}`}
              className="mx-1 underline hover:text-foreground"
              onClick={(e) => {
                e.preventDefault();
                setCurrentIndex(0);
              }}
            >
              从头再来一遍
            </Link>
            ，或者去
            <Link
              href="/review"
              className="mx-1 underline hover:text-foreground"
            >
              /review
            </Link>
            把刚才加入队列的词过一遍。
          </CardContent>
        </Card>
      )}

      {popover && lookup && (
        <DictionaryPopover
          popover={popover}
          lookup={lookup}
          alreadyAdded={addedWords.has(popover.word.toLowerCase())}
          sourceRef={`听力：${title}`}
          onAdded={(word) =>
            setAddedWords((prev) => new Set(prev).add(word.toLowerCase()))
          }
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  );
}
