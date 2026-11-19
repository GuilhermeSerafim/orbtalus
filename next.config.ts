import type { NextConfig } from "next";

const localApiProxyEnabled = process.env.NODE_ENV === "development" && process.env.ORBTALUS_LOCAL_API_PROXY === "1";

const nextConfig: NextConfig = {
  ...(localApiProxyEnabled ? { experimental: { proxyTimeout: 120_000 } } : {}),
  async redirects() {
    return [{
      source: "/:path*",
      has: [{ type: "host", value: "geo-risk-front\\.vercel\\.app" }],
      destination: "https://orbtalus.vercel.app/:path*",
      permanent: true,
    }];
  },
  async rewrites() {
    if (!localApiProxyEnabled) return [];
    return [{ source: "/api/geo/risk", destination: "http://127.0.0.1:8000/geo/risk" }];
  },
};

export default nextConfig;
