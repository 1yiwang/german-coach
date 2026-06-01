import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// ── Types ──────────────────────────────────────────────────────────

interface WordEntry {
  headword: string;
  pos: string;
  inflection: string;
  examples: string[];
  topic: string | null;
  regional: string | null;
}

// ── Labels ─────────────────────────────────────────────────────────

const POS_LABELS: Record<string, string> = {
  verb: "动词",
  "noun:m": "阳性名词",
  "noun:f": "阴性名词",
  "noun:n": "中性名词",
  adj: "形容词",
  adv: "副词",
  prep: "介词",
  conj: "连词",
  other: "其他",
  unknown: "未知",
};

function posLabel(pos: string): string {
  return POS_LABELS[pos] || pos;
}

// ── Data loader (server-only, no Supabase) ─────────────────────────

function loadEntries(): { entries: WordEntry[]; posOptions: string[] } {
  const filePath = join(process.cwd(), "scripts", "transcriptions", "_wortliste-b1.json");
  const raw = readFileSync(filePath, "utf-8");
  const entries: WordEntry[] = JSON.parse(raw);
  const posOptions = [...new Set(entries.map((e) => e.pos.split(":")[0]))].sort();
  return { entries, posOptions };
}

// ── Page (server component — reads JSON directly) ──────────────────

export default async function WortlistePage(props: {
  searchParams: Promise<{ q?: string; pos?: string; page?: string }>;
}) {
  const sp = await props.searchParams;
  const q = sp.q?.toLowerCase().trim() || "";
  const pos = sp.pos?.trim() || "";
  const page = Math.max(1, parseInt(sp.page || "1", 10) || 1);
  const PER_PAGE = 50;

  const { entries, posOptions } = loadEntries();

  // Filter
  let filtered = entries;
  if (pos) {
    filtered = filtered.filter((e) => e.pos === pos || e.pos.startsWith(pos + ":"));
  }
  if (q) {
    filtered = filtered.filter(
      (e) =>
        e.headword.toLowerCase().includes(q) ||
        e.inflection.toLowerCase().includes(q),
    );
  }

  const total = filtered.length;
  const totalPages = Math.ceil(total / PER_PAGE);
  const items = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  return (
    <div className="flex flex-col gap-6 p-4 max-w-5xl mx-auto">
      <header className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Goethe B1 Wortliste
        </h1>
        <p className="text-sm text-muted-foreground">
          {total} 个词条 · 第 {page}/{Math.max(1, totalPages)} 页
        </p>
      </header>

      {/* Filters — form submits via URL params */}
      <form className="flex gap-3 items-end" method="GET">
        <div className="flex-1">
          <label className="text-xs text-muted-foreground mb-1 block">搜索</label>
          <Input
            name="q"
            placeholder="词头或变位……"
            defaultValue={q}
          />
        </div>
        <div className="w-40">
          <label className="text-xs text-muted-foreground mb-1 block">词性</label>
          <select
            name="pos"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            defaultValue={pos}
          >
            <option value="">全部</option>
            {posOptions.map((p) => (
              <option key={p} value={p}>
                {posLabel(p)}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline">
          搜索
        </Button>
      </form>

      {/* Results */}
      {items.length === 0 && (
        <p className="text-muted-foreground text-sm py-8 text-center">没有匹配的词条。</p>
      )}

      <div className="space-y-3">
        {items.map((entry, i) => (
          <Card key={`${entry.headword}-${(page - 1) * PER_PAGE + i}`}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-lg font-heading">
                  {entry.headword}
                </CardTitle>
                <Badge variant="secondary">{posLabel(entry.pos)}</Badge>
                {entry.regional && (
                  <Badge variant="outline" className="text-xs">
                    {entry.regional}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {entry.inflection && (
                <p className="text-muted-foreground font-mono text-xs">
                  {entry.inflection}
                </p>
              )}
              {entry.examples.length > 0 && (
                <ul className="space-y-0.5">
                  {entry.examples.map((ex, j) => (
                    <li key={j} className="text-muted-foreground italic">
                      {ex}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-4">
          {page > 1 ? (
            <a href={`/admin/wortliste?q=${encodeURIComponent(q)}&pos=${encodeURIComponent(pos)}&page=${page - 1}`}>
              <Button variant="outline" size="sm" type="button">
                上一页
              </Button>
            </a>
          ) : (
            <Button variant="outline" size="sm" disabled type="button">
              上一页
            </Button>
          )}
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          {page < totalPages ? (
            <a href={`/admin/wortliste?q=${encodeURIComponent(q)}&pos=${encodeURIComponent(pos)}&page=${page + 1}`}>
              <Button variant="outline" size="sm" type="button">
                下一页
              </Button>
            </a>
          ) : (
            <Button variant="outline" size="sm" disabled type="button">
              下一页
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
