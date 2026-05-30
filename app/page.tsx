import Link from "next/link";

// Home reads `due review count` from Convex on the client; skip prerender so
// the missing ConvexProvider at build time doesn't blow up the export.
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

export default function HomePage() {
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
        <Card>
          <CardHeader>
            <CardTitle>v0.2 进度</CardTitle>
            <CardDescription>
              DeepSeek API 已接 + Convex schema 待 `npx convex dev` 一次性部署
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              🔍 / ✏️ / 双击查词 / 对话教练全部调用 DeepSeek（OpenAI 兼容协议）。需要在
              <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-xs">
                .env.local
              </code>
              里填入
              <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-xs">
                DEEPSEEK_API_KEY
              </code>
              。
            </p>
            <p>
              /review 从 Convex `words` 表读。如果首次跑，先
              <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-xs">
                npx convex dev
              </code>
              建 deployment，再
              <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-xs">
                npx convex run seed:run
              </code>
              写入 demo 数据。
            </p>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
