/**
 * QRouter brand mark — the black rounded tile with the emerald route: a tail
 * entering through the left edge, a step up to the top rail, then a drop that
 * exits through the bottom edge, with a node where the drop crosses the tail
 * line. Geometry is traced from the brand lockup.
 *
 * Two details that matter if you edit this:
 *
 *  · The tile is full-bleed in the 32-unit box, so `size` is the mark's true
 *    rendered size and it lines up with text at any scale. The route is drawn
 *    past the box on the left (x = -2) and bottom (y = 34) and the SVG viewport
 *    clips it — that is what makes the route bleed off the edges. It also means
 *    the mark needs no clipPath, hence no element ids, hence no duplicate-id
 *    collisions when several marks share a page.
 *
 *  · `.qr-logomark-edge` is a hairline that only paints on the dark console and
 *    docs surfaces (see globals.css), where the near-black tile would otherwise
 *    disappear into a near-black background. Everywhere else it is transparent
 *    and the mark renders as the plain brand artwork.
 *
 * Self-contained (dark tile + green route), so it reads on the light public
 * pages and the dark dashboard alike. Used by Logo, the landing nav and footer,
 * the console sidebar, the chat avatar, and the sign-in header.
 */
const ROUTE =
  "M-2 21.8H6.9A2.5 2.5 0 0 0 9.4 19.3V12.1A2.5 2.5 0 0 1 11.9 9.6" +
  "H18.7A2.5 2.5 0 0 1 21.2 12.1V34";

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
      <rect width="32" height="32" rx="9" fill="#0d100e" />
      <path d={ROUTE} stroke="#42e59e" strokeWidth="3.4" />
      <circle cx="21.2" cy="21.8" r="2.3" fill="#42e59e" />
      <rect
        className="qr-logomark-edge"
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="8.5"
        strokeWidth="1"
      />
    </svg>
  );
}
