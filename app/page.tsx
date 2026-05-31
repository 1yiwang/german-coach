import Link from "next/link";

// `<DueReviewCount>` reads Supabase on the server per request; skip prerender
// so the build doesn't try to hit the DB without env vars.
export const dynamic = "force-dynamic";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { sampleArticle } from "@/lib/sample-article";
import { DueReviewCount } from "@/components/due-review-count";
import { StudyHeatmap } from "@/components/study-heatmap";
import { listRecentStudyLogDays, type StudyLogDay } from "@/lib/db/study-log";

export default async function HomePage() {
  let studyDays: StudyLogDay[] = [];
  let studyLogError: string | null = null;
  try {
    studyDays = await listRecentStudyLogDays(90);
  } catch (err) {
    studyLogError = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="space-y-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          Guten Tag, Yi.
        </h1>
        <p className="text-muted-foreground">
          今天用 15 分钟精读一篇、对话一次、复习几张卡，就够了。
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>今日目标</CardTitle>
            <CardDescription>3 项小任务，可拆可拼</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span>精读句子</span>
              <span className="font-mono">0 / 5</span>
            </div>
            <div className="flex justify-between">
              <span>对话轮次</span>
              <span className="font-mono">0 / 6</span>
            </div>
            <div className="flex justify-between">
              <span>SRS 复习</span>
              <span className="font-mono">0 / 10</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>待复习</CardTitle>
            <CardDescription>SM-2 算法智能安排</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <DueReviewCount />
            <Link
              href="/review"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              去复习
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>继续学习</CardTitle>
            <CardDescription>正在学的文章</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm font-medium leading-snug">
              {sampleArticle.title}
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{sampleArticle.level}</Badge>
              <span className="text-xs text-muted-foreground">
                {sampleArticle.sentences.length} 句
              </span>
            </div>
            <Link href="/learn" className={buttonVariants({ size: "sm" })}>
              打开精读
            </Link>
          </CardContent>
        </Card>
      </section>

      <section>
        <StudyHeatmap days={studyDays} loadError={studyLogError} />
      </section>

      <section>
        <Card>
          <CardHeader>
            <CardTitle>v0.2.5 进度</CardTitle>
            <CardDescription>
              数据后端从 Convex 迁移到 Supabase Postgres；DeepSeek 不动
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              🔍 / ✏️ / 双击查词 / 对话教练 全部调用 DeepSeek（OpenAI 兼容协议）。需要在
              <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-xs">
                .env.local
              </code>
              里填{" "}
              <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-xs">
                DEEPSEEK_API_KEY
              </code>
              。
            </p>
            <p>
              /review 从 Supabase{" "}
              <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-xs">
                words
              </code>{" "}
              表读，所有写操作走 server-only API routes（service_role 不进浏览器）。首次部署先在
              Supabase SQL Editor 跑{" "}
              <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-xs">
                supabase/migrations/0001_init.sql
              </code>
              ，再{" "}
              <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-xs">
                npm run seed
              </code>
              。
            </p>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
