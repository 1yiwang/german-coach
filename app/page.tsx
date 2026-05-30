import Link from "next/link";
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
            <div className="text-3xl font-semibold font-mono">0</div>
            <p className="text-xs text-muted-foreground">
              v0.1 还没有真实词条。从精读页面把生词加入复习队列即可。
            </p>
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
            <Link
              href="/learn"
              className={buttonVariants({ size: "sm" })}
            >
              打开精读
            </Link>
          </CardContent>
        </Card>
      </section>

      <section>
        <Card>
          <CardHeader>
            <CardTitle>v0.1 范围</CardTitle>
            <CardDescription>
              核心体验验证：硬编码一篇文章，跑通逐句解析 + 练习 + 词典浮窗的交互流
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              本版本不连 PDF 上传，不连 Convex（schema 已搭好，等
              <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-xs">
                npx convex dev
              </code>
              首次部署），LLM 解析按钮先返回 placeholder。SM-2 算法已经移植自
              Lumina，可在
              <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-xs">
                lib/srs.ts
              </code>
              查看。
            </p>
            <p>
              路线图见
              <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-xs">
                D:\My Second Brain\10-PROJECTS\german-coach\design.md
              </code>
              。
            </p>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
