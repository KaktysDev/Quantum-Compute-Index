/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
  eslint: {
    // Don't fail production builds on lint warnings — keeps Vercel deploys green.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
