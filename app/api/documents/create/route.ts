import { NextRequest, NextResponse } from "next/server";
import { createDocument } from "@/lib/db/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Split a German paragraph into sentences. v0.3-MVP uses a regex tuned for
 * German conventions:
 *   - End-of-sentence punctuation: . ! ?
 *   - Don't split on common abbreviations (z.B., u.a., Dr., usw.) — exact list
 *     is small; for unknown abbrevs the worst case is an over-segmented sentence
 *     that still works fine in all downstream LLM calls.
 *   - Preserve typographic quotes („…") and umlauts; the split happens on the
 *     punctuation, not inside any quote pair.
 *
 * Returns trimmed non-empty sentences in original order.
 */
function splitSentences(raw: string): string[] {
  // Normalize whitespace first.
  const text = raw.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
  if (!text) return [];

  // Protect a few abbreviations from being split.
  const ABBREVS = ["z. B.", "z.B.", "u. a.", "u.a.", "Dr.", "Prof.", "Mr.", "Mrs.", "usw.", "etc.", "ggf.", "bzw."];
  let guarded = text;
  ABBREVS.forEach((abbr, i) => {
    guarded = guarded.split(abbr).join(`\u0001ABBR${i}\u0001`);
  });

  // Split on sentence-ending punctuation followed by whitespace + capital letter / quote.
  const parts = guarded.split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ„"])/);

  return parts
    .map((s) => {
      let out = s.trim();
      ABBREVS.forEach((abbr, i) => {
        out = out.split(`\u0001ABBR${i}\u0001`).join(abbr);
      });
      return out;
    })
    .filter((s) => s.length > 0);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { title, text, level } = body ?? {};
    if (typeof title !== "string" || !title.trim()) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    if (typeof text !== "string" || !text.trim()) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    const sentences = splitSentences(text);
    if (sentences.length === 0) {
      return NextResponse.json(
        { error: "Could not split text into any sentences" },
        { status: 400 },
      );
    }

    const id = await createDocument({
      title: title.trim(),
      level: typeof level === "string" && level ? level : undefined,
      source: "user-paste",
      sentences: sentences.map((s) => ({ original: s })),
    });

    return NextResponse.json({ id, sentenceCount: sentences.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
