/**
 * QRouter brand mark — a black "die" with the emerald routing path.
 * Self-contained (dark die + green route), so it reads on both the light public
 * pages and the dark dashboard. Used by Logo, the landing hero, and the footer.
 */
export default function LogoMark({
  size = 26,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect
        x="1.75"
        y="1.75"
        width="28.5"
        height="28.5"
        rx="8.5"
        fill="#111612"
        stroke="rgba(255,255,255,0.14)"
        strokeWidth="1.2"
      />
      <path
        d="M10.5 20.5H15.5V11.5H20.5V21.4"
        stroke="#42E59E"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="20.5" cy="21.4" r="2.5" fill="#42E59E" />
    </svg>
  );
}
