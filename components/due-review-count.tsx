import { dueCount } from "@/lib/db/words";

/**
 * Server-component due-review count. Reads Supabase directly via `lib/db/words`
 * and falls back to "—" if Supabase isn't configured yet (first clone, no
 * .env.local). The parent page (`app/page.tsx`) is marked `force-dynamic`
 * so this fetch happens per-request, not at build time.
 */
export async function DueReviewCount() {
  let count: number | null = null;
  let configured = true;
  try {
    count = await dueCount();
  } catch {
    configured = false;
  }

  if (!configured || count === null) {
    return (
      <>
        <div className="text-3xl font-semibold font-mono text-muted-foreground">
          —
        </div>
        <p className="text-xs text-muted-foreground">
          Supabase 还没配。先填{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
            .env.local
          </code>
          ，再跑迁移和{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
            npm run seed
          </code>
          。
        </p>
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
