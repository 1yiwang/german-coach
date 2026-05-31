import { NextRequest, NextResponse } from "next/server";
import { recordSentenceReview } from "@/lib/db/listen-progress";
import type { ReviewRating } from "@/lib/srs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_RATINGS: ReviewRating[] = ["again", "hard", "good", "easy"];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sentenceId, rating } = body ?? {};
    if (typeof sentenceId !== "string" || !sentenceId) {
      return NextResponse.json(
        { error: "sentenceId (string) is required" },
        { status: 400 },
      );
    }
    if (!VALID_RATINGS.includes(rating)) {
      return NextResponse.json(
        { error: `rating must be one of ${VALID_RATINGS.join(", ")}` },
        { status: 400 },
      );
    }
    const result = await recordSentenceReview({ sentenceId, rating });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
