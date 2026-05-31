import { NextRequest, NextResponse } from "next/server";
import {
  skipSentence,
  unskipSentence,
} from "@/lib/db/listen-progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Action = "skip" | "unskip";
const VALID_ACTIONS: Action[] = ["skip", "unskip"];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sentenceId, action } = body ?? {};
    if (typeof sentenceId !== "string" || !sentenceId) {
      return NextResponse.json(
        { error: "sentenceId (string) is required" },
        { status: 400 },
      );
    }
    if (!VALID_ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: `action must be one of ${VALID_ACTIONS.join(", ")}` },
        { status: 400 },
      );
    }
    if (action === "skip") {
      const result = await skipSentence(sentenceId);
      return NextResponse.json(result);
    }
    await unskipSentence(sentenceId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
