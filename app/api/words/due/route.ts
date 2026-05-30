import { NextResponse } from "next/server";
import { dueForReview } from "@/lib/db/words";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const words = await dueForReview();
    return NextResponse.json({ words });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
