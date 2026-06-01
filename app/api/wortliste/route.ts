import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface WordEntry {
  headword: string;
  pos: string;
  inflection: string;
  examples: string[];
  topic: string | null;
  regional: string | null;
}

let cache: { entries: WordEntry[]; mtime: number } | null = null;

function loadEntries(): WordEntry[] {
  const filePath = join(process.cwd(), "scripts", "transcriptions", "_wortliste-b1.json");
  // Bust cache if file changed
  const mtime = readFileSync(filePath, "utf-8").length; // cheap fingerprint
  if (cache && cache.mtime === mtime) return cache.entries;

  const raw = readFileSync(filePath, "utf-8");
  const entries: WordEntry[] = JSON.parse(raw);
  cache = { entries, mtime };
  return entries;
}

export async function GET(req: NextRequest) {
  try {
    const entries = loadEntries();

    const q = req.nextUrl.searchParams.get("q")?.toLowerCase().trim() || "";
    const pos = req.nextUrl.searchParams.get("pos")?.trim() || "";
    const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") || "1", 10) || 1);
    const perPage = Math.min(100, Math.max(10, parseInt(req.nextUrl.searchParams.get("perPage") || "50", 10) || 50));

    let filtered = entries;

    // POS filter
    if (pos) {
      filtered = filtered.filter((e) => e.pos === pos || e.pos.startsWith(pos + ":"));
    }

    // Search by headword or inflection
    if (q) {
      filtered = filtered.filter(
        (e) =>
          e.headword.toLowerCase().includes(q) ||
          e.inflection.toLowerCase().includes(q),
      );
    }

    const total = filtered.length;
    const totalPages = Math.ceil(total / perPage);
    const start = (page - 1) * perPage;
    const items = filtered.slice(start, start + perPage);

    // Unique POS values for filter dropdown
    const allPos = [...new Set(entries.map((e) => e.pos.split(":")[0]))].sort();

    return NextResponse.json({
      items,
      page,
      perPage,
      total,
      totalPages,
      posOptions: allPos,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
