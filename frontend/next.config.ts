import path from "node:path";
import type { NextConfig } from "next";

// pnpm keeps the packages in the workspace root, one level up. Builds must treat that as the root
// or Turbopack cannot follow the links to them (Vercel's build starts from this folder).
const workspaceRoot = path.join(__dirname, "..");

const nextConfig: NextConfig = {
  // Every screen renders from the browser with live backend data, so there is no static shell to
  // optimise; Cache Components only adds dev-time validation noise here.
  cacheComponents: false,
  // The app moved under /app when the landing page took over /. Old links keep working.
  // The browser only ever talks to this site: /api is forwarded to the backend, so the sign-in
  // cookie is first-party and no browser blocks it.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${process.env.BACKEND_ORIGIN ?? 'http://localhost:4000'}/api/:path*` }]
  },
  async redirects() {
    return [
      { source: '/protect', destination: '/app/protect', permanent: false },
      { source: '/advanced', destination: '/app/advanced', permanent: false },
      { source: '/protection/:path*', destination: '/app/protection/:path*', permanent: false },
      { source: '/plans/:path*', destination: '/app/plans/:path*', permanent: false },
      { source: '/schedule', destination: '/app/protect', permanent: false },
      { source: '/activity', destination: '/app', permanent: false },
    ]
  },
  outputFileTracingRoot: workspaceRoot,
  turbopack: {
    root: workspaceRoot,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
