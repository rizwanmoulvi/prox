import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every screen renders from the browser with live backend data, so there is no static shell to
  // optimise; Cache Components only adds dev-time validation noise here.
  cacheComponents: false,
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
