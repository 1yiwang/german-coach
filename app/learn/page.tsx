"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { sampleArticle, type SampleSentence } from "@/lib/sample-article";

type PanelMode = "analyze" | "practice" | null;

interface SentenceState {
  mode: PanelMode;
}

interface WordPopover {
  sentenceIndex: number;
  word: string;
  x: number;
  y: number;
}

export default function LearnPage() {
  const [states, setStates] = useState<Record<number, SentenceState>>({});
  const [popover, setPopover] = useState<WordPopover | null>(null);

  const togglePanel = (index: number, mode: PanelMode) => {
    setStates((prev) => {
      const current = prev[index]?.mode;
      return {
        ...prev,
        [index]: { mode: current === mode ? null : mode },
      };
    });
  };

  const speak = (text: string) => {
    if (typeof window === "undefined") return;
    if (!("speechSynthesis" in window)) {
      alert("当前浏览器不支持 Web Speech API");
      return;
    }
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "de-DE";
    utter.rate = 0.9;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  };

  const handleWordDoubleClick = (
    e: React.MouseEvent<HTMLSpanElement>,
    sentenceIndex: number,
    word: string,
  ) => {
    e.stopPropagation();
    const cleaned = word.replace(/[.,!?;:„""()\-]/g, "");
    if (!cleaned) return;
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setPopover({
      sentenceIndex,
      word: cleaned,
      x: rect.left + window.scrollX,
      y: rect.bottom + window.scrollY + 6,
    });
  };

  return (
    <div className="flex flex-col gap-6" onClick={() => setPopover(null)}>
      <header className="flex items-end justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {sampleArticle.title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {sampleArticle.source}
          </p>
        </div>
        <Badge>{sampleArticle.level}</Badge>
      </header>

      <p className="text-xs text-muted-foreground border-l-2 border-border pl-3 italic">
        提示：单击 🔍 看语法解析（v0.1 是 placeholder），单击 ✏️ 进入练习，单击 🔊 由浏览器 TTS 朗读，双击任意单词弹出释义浮窗。
      </p>

      <div className="space-y-3">
        {sampleArticle.sentences.map((sentence) => (
          <SentenceBlock
            key={sentence.index}
            sentence={sentence}
            state={states[sentence.index] ?? { mode: null }}
            onToggle={togglePanel}
            onSpeak={speak}
            onWordDoubleClick={handleWordDoubleClick}
          />
        ))}
      </div>

      {popover && (
        <DictionaryPopover
          popover={popover}
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  );
}

interface SentenceBlockProps {
  sentence: SampleSentence;
  state: SentenceState;
  onToggle: (index: number, mode: PanelMode) => void;
  onSpeak: (text: string) => void;
  onWordDoubleClick: (
    e: React.MouseEvent<HTMLSpanElement>,
    sentenceIndex: number,
    word: string,
  ) => void;
}

function SentenceBlock({
  sentence,
  state,
  onToggle,
  onSpeak,
  onWordDoubleClick,
}: SentenceBlockProps) {
  const words = sentence.original.split(/(\s+)/);
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <p className="text-lg leading-relaxed select-text">
            {words.map((w, i) =>
              /^\s+$/.test(w) ? (
                <span key={i}>{w}</span>
              ) : (
                <span
                  key={i}
                  onDoubleClick={(e) =>
                    onWordDoubleClick(e, sentence.index, w)
                  }
                  className="cursor-text hover:bg-accent/60 rounded px-0.5 -mx-0.5 transition-colors"
                >
                  {w}
                </span>
              ),
            )}
          </p>
          <div className="flex shrink-0 gap-1">
            <Button
              size="sm"
              variant={state.mode === "analyze" ? "default" : "outline"}
              onClick={() => onToggle(sentence.index, "analyze")}
              aria-label="解析"
              title="解析"
            >
              🔍
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onSpeak(sentence.original)}
              aria-label="朗读"
              title="朗读"
            >
              🔊
            </Button>
            <Button
              size="sm"
              variant={state.mode === "practice" ? "default" : "outline"}
              onClick={() => onToggle(sentence.index, "practice")}
              aria-label="练习"
              title="练习"
            >
              ✏️
            </Button>
          </div>
        </div>

        {state.mode === "analyze" && (
          <div className="rounded-md border bg-muted/40 p-3 space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant="outline">语法</Badge>
              <span className="text-muted-foreground">
                {sentence.grammarTag ?? "—"}
              </span>
            </div>
            <div className="flex items-start gap-2">
              <Badge variant="outline">参考翻译</Badge>
              <span>{sentence.translationHint ?? "—"}</span>
            </div>
            <p className="text-xs text-muted-foreground italic">
              v0.1：接 LLM 后这里会显示「语法结构 + 词汇 + 搭配 + 类似表达 + 难度评级」的完整详解。
            </p>
          </div>
        )}

        {state.mode === "practice" && (
          <PracticePanel sentence={sentence} />
        )}
      </CardContent>
    </Card>
  );
}

function PracticePanel({ sentence }: { sentence: SampleSentence }) {
  const [answer, setAnswer] = useState("");
  const [submitted, setSubmitted] = useState(false);

  return (
    <div className="rounded-md border bg-muted/40 p-3 space-y-3 text-sm">
      <div>
        <div className="text-xs text-muted-foreground mb-1">核心语法</div>
        <div className="font-medium">{sentence.grammarTag ?? "—"}</div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground mb-1">
          A. 用相同语法点造一句新的话
        </div>
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={2}
          placeholder="在这里写你的德语句子……"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <div className="mt-2 flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => setSubmitted(true)}
            disabled={!answer.trim()}
          >
            提交
          </Button>
          {submitted && (
            <span className="text-xs text-muted-foreground italic">
              v0.1：接 LLM 后这里会返回纠正、地道说法、错误统计。
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function DictionaryPopover({
  popover,
  onClose,
}: {
  popover: WordPopover;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed z-50 w-72 rounded-lg border bg-popover text-popover-foreground shadow-lg p-4 space-y-3"
      style={{ left: popover.x, top: popover.y }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-baseline justify-between">
        <span className="font-heading text-lg font-semibold">
          {popover.word}
        </span>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground text-sm"
          aria-label="关闭"
        >
          ✕
        </button>
      </div>
      <div className="text-sm space-y-2">
        <p className="text-muted-foreground italic text-xs">
          v0.1：接 LLM 后这里会显示「词性 + 中/英释义 + 3 个搭配 + 2 个例句 + 变格变位表」。
        </p>
        <p className="text-xs">
          双击查词的交互模式参考自{" "}
          <a
            href="https://github.com/HashBrowns-fries/Lumina"
            className="underline"
            target="_blank"
            rel="noreferrer"
          >
            Lumina
          </a>
          。
        </p>
      </div>
      <Button size="sm" variant="outline" className="w-full">
        + 加入复习队列
      </Button>
    </div>
  );
}
