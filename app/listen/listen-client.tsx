"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type {
  SentenceProgress,
  SentenceStatus,
} from "@/lib/db/listen-progress";
import {
  initialSrsState,
  intervalLabel,
  type ReviewRating,
  type SrsState,
} from "@/lib/srs";

const AUTO_ADVANCE_KEY = "german-coach.listen.autoAdvance";

const RATING_BUTTONS: {
  rating: ReviewRating;
  label: string;
  hint: string;
  className: string;
}[] = [
  {
    rating: "again",
    label: "Nochmal",
    hint: "Nicht verstanden",
    className:
      "border-destructive/30 text-destructive hover:bg-destructive/10",
  },
  {
    rating: "hard",
    label: "Schwer",
    hint: "Mit Mühe verstanden",
    className:
      "border-amber-500/30 text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/40",
  },
  {
    rating: "good",
    label: "Gut",
    hint: "Verstanden, kann wiederholen",
    className:
      "border-emerald-500/30 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/40",
  },
  {
    rating: "easy",
    label: "Einfach",
    hint: "Sofort verstanden",
    className:
      "border-sky-500/30 text-sky-700 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-950/40",
  },
];

const STATUS_BADGE: Record<SentenceStatus, { label: string; emoji: string }> =
  {
    new: { label: "Neu", emoji: "🌱" },
    learning: { label: "Am Lernen", emoji: "🔄" },
    mastered: { label: "Gemeistert", emoji: "✅" },
    skipped: { label: "Übersprungen", emoji: "🚫" },
  };

function formatIntervalDays(days: number): string {
  if (days < 1) return "<1 Tag";
  if (days >= 30) {
    const months = Math.floor(days / 30);
    return `${months} ${months === 1 ? "Monat" : "Monate"}`;
  }
  return `${days} ${days === 1 ? "Tag" : "Tage"}`;
}

interface ListenClientProps {
  docId: string;
  title: string;
  level?: string;
  source?: string;
  sentences: SampleSentence[];
  /** Per-sentence SRS state preloaded by the Server Component. Demo
   *  article passes []; absence is treated as "never rated". */
  initialProgress?: SentenceProgress[];
}

export function ListenClient({
  docId,
  title,
  level,
  source,
  sentences,
  initialProgress = [],
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
  // Speed control applies to BOTH real audio (HTMLAudioElement.playbackRate)
  // and TTS (SpeechSynthesisUtterance.rate). 1.0 is natural, 0.75 is study pace.
  const [playbackRate, setPlaybackRate] = useState(1.0);
  // Per-sentence SRS state, seeded from server and updated in place when
  // the user grades a sentence. Key = Supabase sentence.id (uuid).
  const [progressMap, setProgressMap] = useState<
    Record<string, SentenceProgress>
  >(() => {
    const m: Record<string, SentenceProgress> = {};
    for (const p of initialProgress) m[p.sentenceId] = p;
    return m;
  });
  // Rating button being submitted; disables all four while in-flight.
  const [submittingRating, setSubmittingRating] = useState<ReviewRating | null>(
    null,
  );
  // Skip toggle in-flight flag — separate from submittingRating so the
  // two never block each other (and so the toggle can show a dimmed
  // state during its own roundtrip).
  const [submittingSkip, setSubmittingSkip] = useState(false);
  // localStorage-backed toggle: when on, a successful rating auto-advances
  // to the next sentence after a short delay. Off by default (user keeps
  // full manual control over re-listen / lookup / analyse).
  const [autoAdvance, setAutoAdvance] = useState(false);

  // <audio> element when this sentence has a real audio_url. Hung off a ref so
  // play/pause/cleanup don't trigger React re-renders.
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const currentSentence = sentences[currentIndex];
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === sentences.length - 1;
  const ttsAvailable =
    typeof window !== "undefined" && "speechSynthesis" in window;
  const hasRealAudio = Boolean(currentSentence?.audioUrl);
  const sentenceId = currentSentence?.id;
  const currentProgress = sentenceId ? progressMap[sentenceId] : undefined;
  const ratingsEnabled = Boolean(sentenceId);

  // SM-2 state for preview labels on the rating buttons. Mirrors the
  // pattern in app/review/page.tsx: when never-rated, start from the
  // canonical initial state so users see "<1 day" / "1 day" / "4 days"
  // on the first grade.
  const currentSrsState = useMemo<SrsState>(() => {
    if (!currentProgress) return initialSrsState();
    return {
      ease: currentProgress.ease,
      interval: currentProgress.interval,
      repetitions: currentProgress.repetitions,
      nextReview: currentProgress.nextReview,
      lastReview: currentProgress.lastReview,
    };
  }, [currentProgress]);

  const ratingPreviews = useMemo(() => {
    return RATING_BUTTONS.map((b) => ({
      ...b,
      preview: intervalLabel(currentSrsState, b.rating),
    }));
  }, [currentSrsState]);

  const stopSpeaking = useCallback(() => {
    if (typeof window === "undefined") return;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
  }, []);

  // Per-sentence reset: kill any in-flight playback + collapse panels.
  useEffect(() => {
    stopSpeaking();
    setShowText(false);
    setAnalysis(null);
    setIsAnalyzing(false);
    setAnalysisError(null);
  }, [currentIndex, stopSpeaking]);

  // Component unmount: stop any speech.
  useEffect(() => {
    return () => {
      if (typeof window === "undefined") return;
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      if (audioRef.current) audioRef.current.pause();
    };
  }, []);

  // Keep the live <audio> element in sync with the speed slider.
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  // Hydrate autoAdvance from localStorage on first render.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(AUTO_ADVANCE_KEY) === "1") {
        setAutoAdvance(true);
      }
    } catch {
      // localStorage can throw in some sandboxed iframes; ignore.
    }
  }, []);

  // Persist autoAdvance whenever it changes.
  useEffect(() => {
    try {
      window.localStorage.setItem(
        AUTO_ADVANCE_KEY,
        autoAdvance ? "1" : "0",
      );
    } catch {
      // ignore
    }
  }, [autoAdvance]);

  const speak = useCallback(() => {
    if (!currentSentence) return;
    // Real publisher audio takes priority over OS TTS — voice quality + natural
    // pacing are dramatically better, and `?audio_url` is what gets stored once
    // a document is imported via `scripts/import-aligned.ts`.
    if (currentSentence.audioUrl) {
      const el = audioRef.current;
      if (!el) {
        toast.error("Audio nicht bereit");
        return;
      }
      el.playbackRate = playbackRate;
      el.currentTime = 0;
      el.play().catch((err) => {
        toast.error("Wiedergabe fehlgeschlagen", {
          description: (err as Error).message,
        });
        setIsPlaying(false);
      });
      return;
    }
    if (!ttsAvailable) {
      toast.error("Web Speech API nicht verfügbar");
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(currentSentence.original);
    utter.lang = "de-DE";
    utter.rate = playbackRate * 0.9;
    utter.onstart = () => setIsPlaying(true);
    utter.onend = () => setIsPlaying(false);
    utter.onerror = () => setIsPlaying(false);
    window.speechSynthesis.speak(utter);
  }, [currentSentence, ttsAvailable, playbackRate]);

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

  const handleRate = async (rating: ReviewRating) => {
    if (!sentenceId || submittingRating) return;
    setSubmittingRating(rating);
    try {
      const res = await fetch("/api/listen-progress/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sentenceId, rating }),
      });
      const json = (await res.json()) as
        | {
            ease: number;
            interval: number;
            repetitions: number;
            nextReview: number;
            lastReview: number;
            status: SentenceStatus;
          }
        | { error: string };
      if (!res.ok || "error" in json) {
        throw new Error(
          "error" in json ? json.error : `HTTP ${res.status}`,
        );
      }
      setProgressMap((prev) => ({
        ...prev,
        [sentenceId]: {
          sentenceId,
          ease: json.ease,
          interval: json.interval,
          repetitions: json.repetitions,
          nextReview: json.nextReview,
          lastReview: json.lastReview,
          status: json.status,
        },
      }));
      toast.success(
        `Gespeichert · nächste Wiederholung in ${formatIntervalDays(json.interval)}`,
        {
          description: `${STATUS_BADGE[json.status].emoji} ${STATUS_BADGE[json.status].label}`,
        },
      );
      if (autoAdvance && !isLast) {
        // Small delay so the user sees the toast / button highlight before
        // the card swaps. 450 ms feels snappy without being abrupt.
        setTimeout(() => {
          setCurrentIndex((i) => Math.min(sentences.length - 1, i + 1));
        }, 450);
      }
    } catch (err) {
      toast.error("Bewertung fehlgeschlagen", {
        description: err instanceof Error ? err.message : "Unbekannter Fehler",
      });
    } finally {
      setSubmittingRating(null);
    }
  };

  const isSkipped = currentProgress?.status === "skipped";

  const handleToggleSkip = async () => {
    if (!sentenceId || submittingSkip) return;
    setSubmittingSkip(true);
    const action = isSkipped ? "unskip" : "skip";
    try {
      const res = await fetch("/api/listen-progress/skip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sentenceId, action }),
      });
      const json = (await res.json()) as
        | (SentenceProgress & { ok?: undefined })
        | { ok: true }
        | { error: string };
      if (!res.ok || "error" in json) {
        throw new Error(
          "error" in json ? json.error : `HTTP ${res.status}`,
        );
      }
      setProgressMap((prev) => {
        const next = { ...prev };
        if (action === "skip") {
          // API returned a full SentenceProgress row.
          next[sentenceId] = json as SentenceProgress;
        } else {
          // Row was deleted server-side → reset to "never rated".
          delete next[sentenceId];
        }
        return next;
      });
      toast.success(
        action === "skip" ? "Aus SRS entfernt" : "Wieder in SRS aufgenommen",
      );
    } catch (err) {
      toast.error("Aktion fehlgeschlagen", {
        description: err instanceof Error ? err.message : "Unbekannter Fehler",
      });
    } finally {
      setSubmittingSkip(false);
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
            {source ?? "—"} · Hörverstehen
          </p>
        </div>
        <div className="flex items-center gap-2">
          {level && <Badge>{level}</Badge>}
          <Link
            href="/listen"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Zurück
          </Link>
        </div>
      </header>

      {/* Progress strip */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground font-mono">
          <span>
            Satz {currentIndex + 1} / {sentences.length}
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
                          Grammatik
                        </Badge>
                        {currentSentence.grammarTag}
                      </span>
                    )}
                    {currentSentence.translationHint && (
                      <span>
                        <Badge variant="outline" className="mr-1">
                          Übersetzung
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
              </div>
            )}
          </div>

          {/* Hidden <audio> element — present whenever this sentence has a
              real audio_url, controlled imperatively via audioRef. */}
          {hasRealAudio && (
            <audio
              ref={audioRef}
              src={currentSentence.audioUrl}
              preload="auto"
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={() => setIsPlaying(false)}
              onError={() => {
                setIsPlaying(false);
                toast.error("Audio konnte nicht geladen werden", {
                  description: currentSentence.audioUrl,
                });
              }}
            />
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/40 max-[480px]:flex-col max-[480px]:items-stretch">
            <Button
              size="sm"
              variant={isPlaying ? "default" : "outline"}
              onClick={togglePlay}
              disabled={!hasRealAudio && !ttsAvailable}
              title="Abspielen / Pause (Space)"
              className="max-[480px]:w-full"
            >
              {isPlaying ? "⏸ Pause" : "▶ Abspielen"}
            </Button>
            <Button
              size="sm"
              variant={showText ? "secondary" : "outline"}
              onClick={() => setShowText((v) => !v)}
              className="max-[480px]:w-full"
            >
              {showText ? "🙈 Text verbergen" : "👁 Text zeigen"}
            </Button>
            <Button
              size="sm"
              variant={analysis ? "secondary" : "outline"}
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              className="max-[480px]:w-full"
            >
              {isAnalyzing
                ? "🔍 Analysiere…"
                : analysis
                  ? "🔍 Analysiert"
                  : "🔍 Analyse"}
            </Button>
            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground max-[480px]:ml-0 max-[480px]:justify-between max-[480px]:pt-1">
              <span className="font-mono">{playbackRate.toFixed(2)}x</span>
              <input
                type="range"
                min={0.5}
                max={1.25}
                step={0.05}
                value={playbackRate}
                onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
                className="w-24 accent-foreground"
                title="Wiedergabegeschwindigkeit"
              />
              {hasRealAudio ? (
                <Badge variant="secondary" className="text-[10px]">
                  Original
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">
                  TTS
                </Badge>
              )}
            </div>
          </div>

          {/* Analysis panel */}
          {(analysis || analysisError) && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              {analysisError ? (
                <div className="text-destructive text-xs">
                  Analyse fehlgeschlagen: {analysisError}
                  <div className="mt-1 text-muted-foreground not-italic">
                    Bitte <code>DEEPSEEK_API_KEY</code> in
                    <code> .env.local</code> prüfen.
                  </div>
                </div>
              ) : (
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                  {analysis}
                </pre>
              )}
            </div>
          )}

          {/* SRS rating row — always visible so a single click is enough
              when the sentence was easy. Status reflects current progress;
              "Text zeigen" stays a separate action for self-check. */}
          <div className="space-y-2 pt-3 border-t border-border/40">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 text-muted-foreground">
                <span>Status</span>
                <Badge variant="outline" className="font-normal">
                  {currentProgress
                    ? `${STATUS_BADGE[currentProgress.status].emoji} ${STATUS_BADGE[currentProgress.status].label}`
                    : `${STATUS_BADGE.new.emoji} ${STATUS_BADGE.new.label}`}
                </Badge>
                {!isSkipped &&
                  currentProgress?.interval !== undefined &&
                  currentProgress.interval > 0 && (
                    <span className="font-mono">
                      · Intervall {formatIntervalDays(currentProgress.interval)}
                    </span>
                  )}
              </div>
              <div className="flex items-center gap-3">
                {ratingsEnabled && (
                  <button
                    type="button"
                    onClick={handleToggleSkip}
                    disabled={submittingSkip}
                    className="text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline disabled:opacity-50"
                    title={
                      isSkipped
                        ? "Diesen Satz wieder in die Wiederholung aufnehmen"
                        : "Diesen Satz nicht wiederholen"
                    }
                  >
                    {isSkipped ? "↩ Wieder aufnehmen" : "🚫 Aus SRS"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setAutoAdvance((v) => !v)}
                  className="text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
                  title="Nach Bewertung automatisch zum nächsten Satz"
                >
                  {autoAdvance ? "⏭ Auto-Weiter" : "✋ Manuell"}
                </button>
              </div>
            </div>
            {!ratingsEnabled ? (
              <p className="text-xs text-muted-foreground italic">
                Demo-Artikel unterstützt keine Bewertung. Importiere einen
                echten Artikel, um SRS-Bewertungen zu nutzen.
              </p>
            ) : isSkipped ? (
              <p className="text-xs text-muted-foreground italic">
                Dieser Satz wird nicht mehr zur Wiederholung vorgeschlagen.
                Klick auf{" "}
                <span className="font-medium">↩ Wieder aufnehmen</span>, um ihn
                zurückzuholen.
              </p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {ratingPreviews.map((b) => {
                  const isSubmitting = submittingRating === b.rating;
                  return (
                    <Button
                      key={b.rating}
                      size="sm"
                      variant="outline"
                      disabled={!!submittingRating}
                      onClick={() => handleRate(b.rating)}
                      title={b.hint}
                      className={`flex flex-col h-auto py-2 gap-0.5 ${b.className}`}
                    >
                      <span className="text-sm font-medium">
                        {isSubmitting ? "…" : b.label}
                      </span>
                      <span className="text-[10px] font-mono opacity-70">
                        {b.preview}
                      </span>
                    </Button>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Nav: prev / next */}
      <div className="flex justify-between gap-2">
        <Button
          variant="outline"
          onClick={goPrev}
          disabled={isFirst}
          className="max-[480px]:flex-1"
          title="Vorheriger Satz (←)"
        >
          ← Zurück
        </Button>
        <Button
          onClick={goNext}
          disabled={isLast}
          className="max-[480px]:flex-1"
          title="Nächster Satz (→)"
        >
          Weiter →
        </Button>
      </div>

      {isLast && (
        <Card className="border-dashed">
          <CardContent className="text-sm text-muted-foreground text-center">
            🎉 Geschafft! Du kannst
            <Link
              href={`/listen?id=${docId}`}
              className="mx-1 underline hover:text-foreground"
              onClick={(e) => {
                e.preventDefault();
                setCurrentIndex(0);
              }}
            >
              von vorn beginnen
            </Link>
            oder zu
            <Link
              href="/review"
              className="mx-1 underline hover:text-foreground"
            >
              /review
            </Link>
            gehen, um die gespeicherten Wörter zu wiederholen.
          </CardContent>
        </Card>
      )}

      {popover && lookup && (
        <DictionaryPopover
          popover={popover}
          lookup={lookup}
          alreadyAdded={addedWords.has(popover.word.toLowerCase())}
          sourceRef={`Hörverstehen: ${title}`}
          onAdded={(word) =>
            setAddedWords((prev) => new Set(prev).add(word.toLowerCase()))
          }
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  );
}
