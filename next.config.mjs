// Security response headers.
//
// These live here rather than in src/middleware.ts for two reasons: the
// middleware matcher deliberately skips _next/static, _next/image and image
// files, so headers set there would miss every static asset; and next.config
// headers() keeps one source of truth instead of two places that can drift.
// The middleware keeps doing only what it already did (x-request-id, Supabase
// session refresh, /dashboard gating). The one gap is that a redirect returned
// *from* middleware short-circuits this pipeline — those are bodyless 307s to
// /signin, and the page they land on carries the full header set.

const isDev = process.env.NODE_ENV !== "production";

/**
 * The Supabase project origin, read at config-evaluation time so the URL is
 * never hardcoded. Realtime/auth use wss, so both schemes are emitted. Missing
 * or unparseable env degrades to no extra origin rather than a broken policy.
 */
function supabaseOrigins() {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!raw) return [];
  try {
    const { protocol, host } = new URL(raw);
    if (protocol !== "https:" && protocol !== "http:") return [];
    return [`${protocol}//${host}`, `${protocol === "https:" ? "wss:" : "ws:"}//${host}`];
  } catch {
    return [];
  }
}

// Every external origin below was read off the code, not assumed:
//   js.stripe.com / api.stripe.com / m.stripe.network / hooks.stripe.com —
//     src/components/OnboardingForm.tsx calls loadStripe() and renders
//     <Elements><PaymentElement/></Elements>, which injects Stripe's script,
//     its card iframes and the 3-D Secure challenge frame.
//   the Supabase origin — src/lib/supabase/client.ts builds a browser client
//     from NEXT_PUBLIC_SUPABASE_URL.
// Everything else is same-origin: `geist` fonts ship through next/font,
// src/components/landing/AffiliationRail.tsx only points next/image at local
// files under /affiliations, and three.js (src/components/RoutingTopology.tsx)
// plus framer-motion are bundled and use no workers or blob URLs.
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // Next.js inlines its bootstrap payload and src/app/layout.tsx carries an
  // inline theme script with no nonce, so 'unsafe-inline' has to stay: a
  // nonce-based policy would mean rewriting that layout. Dev also needs
  // 'unsafe-eval' for React Refresh.
  `script-src 'self' 'unsafe-inline' ${isDev ? "'unsafe-eval' " : ""}https://js.stripe.com`,
  // next/font, Tailwind and framer-motion all inject inline <style>/style attrs.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.stripe.com",
  "font-src 'self' data:",
  ["connect-src 'self' https://api.stripe.com https://m.stripe.network https://js.stripe.com",
    ...supabaseOrigins(), ...(isDev ? ["ws:"] : [])].join(" "),
  "frame-src https://js.stripe.com https://hooks.stripe.com https://m.stripe.network",
  "worker-src 'self' blob:",
  "media-src 'self'",
  "manifest-src 'self'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

// `payment` stays allowed for Stripe's frame or Apple Pay / Google Pay inside
// PaymentElement stops working.
const permissionsPolicy = [
  "accelerometer=()",
  "autoplay=()",
  "camera=()",
  "display-capture=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=(self \"https://js.stripe.com\")",
  "usb=()",
  "xr-spatial-tracking=()",
].join(", ");

// The CSP is the only header here that can white-screen the site, and it cannot
// be verified without a build or a browser, so it ships in report-only mode.
// Set CSP_ENFORCE=true once the violation reports come back clean to promote it
// to the enforcing header. Everything else is safe to enforce immediately.
const cspHeaderName = process.env.CSP_ENFORCE === "true"
  ? "Content-Security-Policy"
  : "Content-Security-Policy-Report-Only";

const securityHeaders = [
  // No `preload`: that is a one-way commitment on the apex domain.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // Matters most for the artifact/result download routes, which return
  // customer-controlled bytes.
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: permissionsPolicy },
  { key: cspHeaderName, value: contentSecurityPolicy },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
  eslint: {
    // Don't fail production builds on lint warnings — keeps Vercel deploys green.
    ignoreDuringBuilds: true,
  },
  async headers() {
    // A CSP on an API response constrains nothing (JSON is never rendered as a
    // document) and there is no `sandbox` directive here, so applying the same
    // set everywhere is safe and leaves no route uncovered.
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
