"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

/**
 * Live count of words whose `nextReview` is at or before now. Falls back
 * gracefully if Convex isn't configured yet.
 *
 * Mount-guarded so `next build` prerender (which has no ConvexProvider in
 * the tree because NEXT_PUBLIC_CONVEX_URL isn't set at build time) doesn't
 * trip useQuery's "must be under ConvexProvider" assertion.
 */
export function DueReviewCount() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return (
      <>
        <div className="text-3xl font-semibold font-mono">…</div>
        <p className="text-xs text-muted-foreground">加载中。</p>
      </>
    );
  }
  return <Inner />;
}

function Inner() {
  const convexConfigured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
  const count = useQuery(api.words.dueCount, {}) as number | undefined;

  if (!convexConfigured) {
    return (
      <>
        <div className="text-3xl font-semibold font-mono text-muted-foreground">
          —
        </div>
        <p className="text-xs text-muted-foreground">
          Convex 还没部署。先跑 <code>npx convex dev</code>。
        </p>
      </>
    );
  }

  if (count === undefined) {
    return (
      <>
        <div className="text-3xl font-semibold font-mono">…</div>
        <p className="text-xs text-muted-foreground">从 Convex 拉数据中。</p>
      </>
    );
  }

  return (
    <>
      <div className="text-3xl font-semibold font-mono">{count}</div>
      <p className="text-xs text-muted-foreground">
        {count === 0
          ? "今日队列已清。新词会自动入队。"
          : "排在最前的会先出现。"}
      </p>
    </>
  );
}
