import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow testing the dev server from the LAN URL printed by `npm run dev`.
  // Without this, Next blocks dev resources and client-side clicks won't hydrate.
  allowedDevOrigins: ["172.20.10.4"],
};

export default nextConfig;
