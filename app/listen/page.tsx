import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { sampleArticle, type SampleSentence } from "@/lib/sample-article";
import {
  listDocuments,
  getDocumentWithSentences,
} from "@/lib/db/documents";
import {
  listLibraryStats,
  listProgressForDocument,
  type LibraryDocStat,
  type SentenceProgress,
} from "@/lib/db/listen-progress";
import { ListenClient } from "./listen-client";
import { LibraryGrid, type LibraryDoc } from "./library-grid";

// Server Component talks to Supabase per request; never prerender.
export const dynamic = "force-dynamic";

interface ListenPageProps {
  searchParams: Promise<{ id?: string }>;
}

export default async function ListenPage({ searchParams }: ListenPageProps) {
  const { id } = await searchParams;

  if (!id) {
    return <ListenIndex />;
  }

  if (id === "demo") {
    return (
      <ListenClient
        docId="demo"
        title={sampleArticle.title}
        level={sampleArticle.level}
        source={sampleArticle.source}
        sentences={sampleArticle.sentences}
      />
    );
  }

  let result: Awaited<ReturnType<typeof getDocumentWithSentences>> = null;
  let loadError: string | null = null;
  try {
    result = await getDocumentWithSentences(id);
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  if (loadError) {
    return (
      <NotFound
        title="加载失败"
        detail={loadError}
        hint="检查 .env.local 里的 SUPABASE_SERVICE_ROLE_KEY 是否填了。"
      />
    );
  }
  if (!result) {
    return (
      <NotFound
        title="找不到这篇文章"
        detail={`id = ${id}`}
        hint="可能已被删除，或者你打开了错误的链接。"
      />
    );
  }

  const sentences: SampleSentence[] = result.sentences.map((s) => ({
    id: s.id,
    index: s.index,
    original: s.original,
    translationHint: s.translation,
    grammarTag: s.grammar,
    audioUrl: s.audioUrl,
  }));

  if (sentences.length === 0) {
    return (
      <NotFound
        title="这篇文章是空的"
        detail={`"${result.doc.title}" 没有任何句子`}
        hint="去 Supabase 里检查 sentences 表，或者重新导入。"
      />
    );
  }

  // Per-sentence SRS state. Swallow errors — a missing sentence_progress
  // table (e.g. user hasn't applied 0002_sentence_progress.sql yet) should
  // degrade gracefully to "no prior ratings" rather than 500 the page.
  let initialProgress: SentenceProgress[] = [];
  try {
    initialProgress = await listProgressForDocument(result.doc.id);
  } catch (err) {
    console.warn("listProgressForDocument failed:", err);
  }

  return (
    <ListenClient
      docId={result.doc.id}
      title={result.doc.title}
      level={result.doc.level}
      source={result.doc.source}
      sentences={sentences}
      initialProgress={initialProgress}
    />
  );
}

async function ListenIndex() {
  let docs: Awaited<ReturnType<typeof listDocuments>> = [];
  let loadError: string | null = null;
  try {
    docs = await listDocuments();
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  // Library-wide SRS aggregates feed the grid (HP bars, due badges,
  // status emoji). Failing here shouldn't 500 the page — degrade to
  // empty stats so unexplored cards still render and the demo entry
  // still works.
  let stats: LibraryDocStat[] = [];
  if (!loadError && docs.length > 0) {
    try {
      stats = await listLibraryStats(
        docs.map((d) => ({ id: d.id, totalSentences: d.totalSentences })),
      );
    } catch (err) {
      console.warn("listLibraryStats failed:", err);
    }
  }

  if (loadError) {
    return (
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">
              Bibliothek konnte nicht geladen werden
            </CardTitle>
            <CardDescription>{loadError}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            检查 <code>.env.local</code> 里的{" "}
            <code>SUPABASE_SERVICE_ROLE_KEY</code> 是否填了。
          </CardContent>
        </Card>
      </div>
    );
  }

  if (docs.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Noch keine Lektionen</CardTitle>
            <CardDescription>
              Die <code>documents</code>-Tabelle ist leer. Probier zuerst die
              Demo aus.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/listen?id=demo"
              className={buttonVariants({ size: "sm" })}
            >
              Demo starten ({sampleArticle.sentences.length} Sätze)
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const libraryDocs: LibraryDoc[] = docs.map((d) => ({
    id: d.id,
    title: d.title,
    source: d.source,
    level: d.level,
    totalSentences: d.totalSentences,
    createdAt: d.createdAt,
  }));

  return (
    <LibraryGrid
      docs={libraryDocs}
      stats={stats}
      showDemo
      demoTitle={sampleArticle.title}
      demoLevel={sampleArticle.level}
      demoSentenceCount={sampleArticle.sentences.length}
    />
  );
}

function NotFound({
  title,
  detail,
  hint,
}: {
  title: string;
  detail: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription className="font-mono text-xs">
            {detail}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>{hint}</p>
          <div className="flex gap-2">
            <Link
              href="/listen"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              返回文章列表
            </Link>
            <Link
              href="/listen?id=demo"
              className={buttonVariants({ size: "sm" })}
            >
              试试 Demo
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
