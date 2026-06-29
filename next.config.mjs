/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    // Don't fail production builds on lint warnings — keeps Vercel deploys green.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
