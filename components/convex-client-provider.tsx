"use client";

import { ReactNode, useMemo } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";

/**
 * Client-side Convex provider.
 *
 * Reads `NEXT_PUBLIC_CONVEX_URL` (set by `npx convex dev` into `.env.local`).
 * If the URL is missing, we render children without a provider — any
 * `useQuery` calls will just sit in the loading state (returning undefined),
 * and components are expected to fall back gracefully. This keeps the app
 * runnable BEFORE the first Convex deployment.
 */
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) return null;
    return new ConvexReactClient(url);
  }, []);

  if (!client) return <>{children}</>;
  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}

export function hasConvexUrl(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);
}
