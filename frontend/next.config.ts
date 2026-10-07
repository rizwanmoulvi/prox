import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every screen renders from the browser with live backend data, so there is no static shell to
  // optimise; Cache Components only adds dev-time validation noise here.
  cacheComponents: false,
  // The app moved under /app when the landing page took over /. Old links keep working.
  async redirects() {
    return [
      { source: '/protect', destination: '/app/protect', permanent: false },
      { source: '/advanced', destination: '/app/advanced', permanent: false },
      { source: '/protection/:path*', destination: '/app/protection/:path*', permanent: false },
    ]
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
