"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { sampleArticle, type SampleSentence } from "@/lib/sample-article";
import {
  DictionaryPopover,
  type WordPopover,
  type LookupState,
} from "@/components/dictionary-popover";

type PanelMode = "analyze" | "practice" | null;

interface SentenceState {
  mode: PanelMode;
}

interface AnalyzeCache {
  status: "idle" | "loading" | "ready" | "error";
  content?: string;
  error?: string;
}

export default function LearnPage() {
  const [states, setStates] = useState<Record<number, SentenceState>>({});
  const [analyzeCache, setAnalyzeCache] = useState<
    Record<number, AnalyzeCache>
  >({});
  const [popover, setPopover] = useState<WordPopover | null>(null);
  const [lookup, setLookup] = useState<LookupState | null>(null);
  // Track words added to the SRS queue this session so the popover button
  // can flip to "已加入 ✓" without re-fetching from Supabase on every click.
  const [addedWords, setAddedWords] = useState<Set<string>>(new Set());

  const togglePanel = async (
    sentence: SampleSentence,
    mode: PanelMode,
  ) => {
    const index = sentence.index;
    setStates((prev) => {
      const current = prev[index]?.mode;
      return {
        ...prev,
        [index]: { mode: current === mode ? null : mode },
      };
    });

    if (mode === "analyze" && !analyzeCache[index]) {
      setAnalyzeCache((prev) => ({
        ...prev,
        [index]: { status: "loading" },
      }));
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sentence: sentence.original }),
        });
        const json = (await res.json()) as { content?: string; error?: string };
        if (!res.ok || json.error) {
          setAnalyzeCache((prev) => ({
            ...prev,
            [index]: {
              status: "error",
              error: json.error ?? `HTTP ${res.status}`,
            },
          }));
        } else {
          setAnalyzeCache((prev) => ({
            ...prev,
            [index]: { status: "ready", content: json.content },
          }));
        }
      } catch (err) {
        setAnalyzeCache((prev) => ({
          ...prev,
          [index]: { status: "error", error: (err as Error).message },
        }));
      }
    }
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
        setLookup({ status: "error", error: json.error ?? `HTTP ${res.status}` });
      } else {
        setLookup({ status: "ready", data: json });
      }
    } catch (err) {
      setLookup({ status: "error", error: (err as Error).message });
    }
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
        提示：单击 🔍 让 DeepSeek 解析这句的语法/词汇，单击 ✏️ 提交练习，单击 🔊 用浏览器 TTS 朗读，双击任意单词查词。
      </p>

      <div className="space-y-3">
        {sampleArticle.sentences.map((sentence) => (
          <SentenceBlock
            key={sentence.index}
            sentence={sentence}
            state={states[sentence.index] ?? { mode: null }}
            analyze={analyzeCache[sentence.index]}
            onToggle={togglePanel}
            onSpeak={speak}
            onWordDoubleClick={handleWordDoubleClick}
          />
        ))}
      </div>

      {popover && lookup && (
        <DictionaryPopover
          popover={popover}
          lookup={lookup}
          alreadyAdded={addedWords.has(popover.word.toLowerCase())}
          sourceRef={sampleArticle.title}
          onAdded={(word) =>
            setAddedWords((prev) => new Set(prev).add(word.toLowerCase()))
          }
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  );
}

interface SentenceBlockProps {
  sentence: SampleSentence;
  state: SentenceState;
  analyze?: AnalyzeCache;
  onToggle: (sentence: SampleSentence, mode: PanelMode) => void;
  onSpeak: (text: string) => void;
  onWordDoubleClick: (
    e: React.MouseEvent<HTMLSpanElement>,
    sentence: SampleSentence,
    word: string,
  ) => void;
}

function SentenceBlock({
  sentence,
  state,
  analyze,
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
                  onDoubleClick={(e) => onWordDoubleClick(e, sentence, w)}
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
              onClick={() => onToggle(sentence, "analyze")}
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
              onClick={() => onToggle(sentence, "practice")}
              aria-label="练习"
              title="练习"
            >
              ✏️
            </Button>
          </div>
        </div>

        {state.mode === "analyze" && (
          <div className="rounded-md border bg-muted/40 p-3 space-y-2 text-sm">
            {!analyze || analyze.status === "loading" ? (
              <div className="text-muted-foreground italic">解析中…</div>
            ) : analyze.status === "error" ? (
              <div className="text-destructive text-xs">
                解析失败：{analyze.error}
                <div className="mt-1 text-muted-foreground not-italic">
                  检查 <code>.env.local</code> 是否配置了
                  <code>DEEPSEEK_API_KEY</code>。
                </div>
              </div>
            ) : (
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                {analyze.content}
              </pre>
            )}
            <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1 border-t border-border/40">
              <Badge variant="outline">参考</Badge>
              <span>语法点：{sentence.grammarTag ?? "—"}</span>
              <span>·</span>
              <span>翻译：{sentence.translationHint ?? "—"}</span>
            </div>
          </div>
        )}

        {state.mode === "practice" && <PracticePanel sentence={sentence} />}
      </CardContent>
    </Card>
  );
}

function PracticePanel({ sentence }: { sentence: SampleSentence }) {
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!answer.trim()) return;
    setLoading(true);
    setFeedback(null);
    setError(null);
    try {
      const res = await fetch("/api/practice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sentence: sentence.original,
          grammarTag: sentence.grammarTag,
          userAnswer: answer,
        }),
      });
      const json = (await res.json()) as { content?: string; error?: string };
      if (!res.ok || json.error) {
        setError(json.error ?? `HTTP ${res.status}`);
      } else {
        setFeedback(json.content ?? "");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-md border bg-muted/40 p-3 space-y-3 text-sm">
      <div>
        <div className="text-xs text-muted-foreground mb-1">核心语法</div>
        <div className="font-medium">{sentence.grammarTag ?? "—"}</div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground mb-1">
          用相同语法点造一句新的话
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
            onClick={submit}
            disabled={!answer.trim() || loading}
          >
            {loading ? "批改中…" : "提交"}
          </Button>
          {error && (
            <span className="text-xs text-destructive">{error}</span>
          )}
        </div>
      </div>
      {feedback && (
        <div className="rounded-md bg-background border p-3 text-sm">
          <pre className="whitespace-pre-wrap font-sans leading-relaxed">
            {feedback}
          </pre>
        </div>
      )}
    </div>
  );
}

