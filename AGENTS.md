<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- supabase-start -->

This project uses [Supabase](https://supabase.com) (Postgres) as its backend.

- Schema lives in `supabase/migrations/*.sql` — the source of truth. Run migrations through the Supabase Dashboard SQL Editor, or via `supabase db push` if the CLI is installed.
- All DB access from app code MUST go through `lib/db/*` (server-only), never `@supabase/supabase-js` directly from a component. The `service_role` key is imported only in `lib/supabase/server.ts` (`import "server-only"`) — adding a fresh import anywhere else risks shipping it to the browser.
- Browser code calls Next.js API routes under `app/api/words/*` (and friends), which then call `lib/db/*`.
- SRS state changes go through `recordReview` in `lib/db/words.ts`, which computes the next SM-2 state server-side via `lib/srs.ts` — never trust a client-supplied `ease` / `interval` / `nextReview`.

<!-- supabase-end -->
