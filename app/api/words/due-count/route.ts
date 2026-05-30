import { NextResponse } from "next/server";
import { dueCount } from "@/lib/db/words";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const count = await dueCount();
    return NextResponse.json({ count });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
