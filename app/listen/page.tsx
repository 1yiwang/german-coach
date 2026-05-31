import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { sampleArticle, type SampleSentence } from "@/lib/sample-article";
import {
  listDocuments,
  getDocumentWithSentences,
} from "@/lib/db/documents";
import {
  listProgressForDocument,
  type SentenceProgress,
} from "@/lib/db/listen-progress";
import { ListenClient } from "./listen-client";

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

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          精听跟读
        </h1>
        <p className="text-sm text-muted-foreground">
          逐句精听：先听德语 → 隐藏原文 → 复述 → 显示原文 → DeepSeek 解析
          → 不懂的词加入 SRS 复习。
        </p>
      </header>

      {loadError ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">读取文章列表失败</CardTitle>
            <CardDescription>{loadError}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            检查 <code>.env.local</code> 里的{" "}
            <code>SUPABASE_SERVICE_ROLE_KEY</code> 是否填了。
          </CardContent>
        </Card>
      ) : docs.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>还没有文章</CardTitle>
            <CardDescription>
              Supabase 的 documents 表是空的。可以先用 Demo 体验逐句精听。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/listen?id=demo"
              className={buttonVariants({ size: "sm" })}
            >
              试试 Demo（{sampleArticle.sentences.length} 句）
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <DemoCard />
          {docs.map((doc) => (
            <Link
              key={doc.id}
              href={`/listen?id=${doc.id}`}
              className="block group"
            >
              <Card className="h-full transition-colors group-hover:border-foreground/40">
                <CardHeader>
                  <CardTitle className="text-base leading-snug">
                    {doc.title}
                  </CardTitle>
                  <CardDescription className="line-clamp-1">
                    {doc.source ?? "—"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex items-center gap-2 text-xs">
                  {doc.level && (
                    <Badge variant="secondary">{doc.level}</Badge>
                  )}
                  <span className="text-muted-foreground">
                    {doc.totalSentences} 句
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function DemoCard() {
  return (
    <Link href="/listen?id=demo" className="block group">
      <Card className="h-full border-dashed transition-colors group-hover:border-foreground/40">
        <CardHeader>
          <CardTitle className="text-base leading-snug">
            {sampleArticle.title}
          </CardTitle>
          <CardDescription className="line-clamp-1">
            Demo · 不需要 Supabase
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-2 text-xs">
          <Badge variant="outline">{sampleArticle.level}</Badge>
          <span className="text-muted-foreground">
            {sampleArticle.sentences.length} 句
          </span>
        </CardContent>
      </Card>
    </Link>
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
