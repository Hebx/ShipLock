import type { NextConfig } from "next";

const API_ORIGIN = process.env.SHIPLOCK_API_ORIGIN ?? "http://127.0.0.1:4000";

const config: NextConfig = {
  poweredByHeader: false,
  // Hostnames allowed to load dev-server resources (e.g. a tailnet HTTPS proxy); comma-separated.
  allowedDevOrigins: (process.env.SHIPLOCK_DEV_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  // Same-origin proxy so session cookies and the World callback stay on the web origin.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` }];
  },
};

export default config;
