/**
 * QRouter brand mark — a rounded-square "die" with the emerald routing path:
 * a short left riser, a step up to the top rail, then a drop to a rounded
 * terminal node. Matches the official brand lockup. Self-contained (dark die +
 * green route), so it reads on both the light public pages and the dark
 * dashboard. Used by Logo, the landing hero, and the footer.
 */
export default function LogoMark({
  size = 26,
  className,
  glow = true,
}: {
  size?: number;
  className?: string;
  glow?: boolean;
}) {
  // Unique-ish id so multiple marks on one page don't collide on the filter.
  const gid = `qr-glow-${size}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      {glow && (
        <defs>
          <filter id={gid} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="1.1" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      )}

      <rect
        x="1.75"
        y="1.75"
        width="28.5"
        height="28.5"
        rx="8.5"
        fill="#0d100e"
        stroke="rgba(255,255,255,0.14)"
        strokeWidth="1.2"
      />

      <g filter={glow ? `url(#${gid})` : undefined}>
        <path
          d="M10.5 14V20.5H16V11.5H21.5V20.5"
          stroke="#42E59E"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="21.5" cy="20.5" r="2.5" fill="#42E59E" />
      </g>
    </svg>
  );
}
