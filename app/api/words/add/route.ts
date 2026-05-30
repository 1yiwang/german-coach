import { NextRequest, NextResponse } from "next/server";
import { addWord } from "@/lib/db/words";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { word, definition, exampleSentence, source, sourceRef } = body ?? {};
    if (typeof word !== "string" || !word.trim()) {
      return NextResponse.json({ error: "word is required" }, { status: 400 });
    }
    if (typeof definition !== "string" || !definition) {
      return NextResponse.json(
        { error: "definition is required" },
        { status: 400 },
      );
    }
    if (source !== "reading" && source !== "chat") {
      return NextResponse.json(
        { error: "source must be 'reading' or 'chat'" },
        { status: 400 },
      );
    }
    const id = await addWord({
      word: word.trim(),
      definition,
      exampleSentence: exampleSentence || undefined,
      source,
      sourceRef: sourceRef || undefined,
    });
    return NextResponse.json({ id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
