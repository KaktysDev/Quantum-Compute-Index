import Link from "next/link";

// One picture of what QRouter is: you talk to one thing, and it talks to all of
// them. Drawn entirely in SVG rather than as positioned HTML boxes plus an SVG
// overlay, because the arrows have to land on the box edges exactly — two
// coordinate systems that have to agree is a bug waiting for the first font or
// zoom change.
//
// Static on purpose, apart from the hover states. The magnetic field behind it
// already carries every bit of ambient motion this surface needs, and two
// things moving at once is where a diagram stops looking considered.
//
// The provider boxes are real links, not decorations: pressing one drops you
// into the assistant with that provider already chosen. They are `next/link`
// anchors living inside the SVG — an SVG <a> is a real focusable link, so this
// keeps middle-click, right-click and tab order working, which a <g onClick>
// would not.

/** Box geometry, all in viewBox units. */
const W = 1000;
const H = 560;
const MID_Y = 280;

const YOU = { x: 26, y: 232, w: 150, h: 96 };
const HUB = { x: 358, y: 214, w: 190, h: 132 };

const TARGET = { x: 748, w: 226, h: 62 };
const TARGET_GAP = 26;
/** Clearance between an arrow's tip or tail and the box it touches. */
const GAP = 9;

/** Rounded to two decimals — see the note on `polar` in QciMap. */
const q = (v: number) => Math.round(v * 100) / 100;

export interface DiagramTarget {
  name: string;
  href: string;
}

export default function RoutingDiagram({ providers }: { providers: DiagramTarget[] }) {
  const count = providers.length;
  const stackH = count * TARGET.h + (count - 1) * TARGET_GAP;
  const stackTop = q((H - stackH) / 2);

  const hubRight = HUB.x + HUB.w;
  const hubMidY = HUB.y + HUB.h / 2;

  return (
    <svg
      className="rt-diagram"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      aria-label={`You send one request to QRouter, which routes it to ${count} quantum providers. Choose one to start a routing task.`}
    >
      <defs>
        {/* userSpaceOnUse so the head keeps its size regardless of the stroke
            width of the line carrying it. */}
        <marker
          id="rtHead"
          markerUnits="userSpaceOnUse"
          markerWidth="11"
          markerHeight="11"
          refX="9"
          refY="5.5"
          orient="auto"
        >
          <path className="rt-head" d="M0 0.6 L10 5.5 L0 10.4 Z" />
        </marker>
      </defs>

      {/* You → QRouter */}
      <line
        className="rt-arrow"
        x1={YOU.x + YOU.w + GAP}
        y1={MID_Y}
        x2={HUB.x - GAP}
        y2={MID_Y}
        markerEnd="url(#rtHead)"
      />

      {/* QRouter → every provider */}
      {providers.map(({ name }, i) => {
        const cy = q(stackTop + i * (TARGET.h + TARGET_GAP) + TARGET.h / 2);
        return (
          <line
            key={name}
            className="rt-arrow"
            x1={hubRight + GAP}
            y1={hubMidY}
            x2={TARGET.x - GAP}
            y2={cy}
            markerEnd="url(#rtHead)"
          />
        );
      })}

      <g className="rt-box">
        <rect x={YOU.x} y={YOU.y} width={YOU.w} height={YOU.h} rx={12} />
        <text x={YOU.x + YOU.w / 2} y={MID_Y} textAnchor="middle" dominantBaseline="central">
          You
        </text>
      </g>

      <g className="rt-box rt-box-hub">
        <rect x={HUB.x} y={HUB.y} width={HUB.w} height={HUB.h} rx={14} />
        <text x={HUB.x + HUB.w / 2} y={MID_Y - 9} textAnchor="middle" dominantBaseline="central">
          QRouter
        </text>
        <text
          className="rt-box-sub"
          x={HUB.x + HUB.w / 2}
          y={MID_Y + 15}
          textAnchor="middle"
          dominantBaseline="central"
        >
          one key · one request
        </text>
      </g>

      {providers.map(({ name, href }, i) => {
        const y = q(stackTop + i * (TARGET.h + TARGET_GAP));
        const mid = q(y + TARGET.h / 2);
        return (
          <Link key={`box:${name}`} href={href} className="rt-target" aria-label={`Route a task using ${name}`}>
            <g className="rt-box">
              <rect x={TARGET.x} y={y} width={TARGET.w} height={TARGET.h} rx={10} />
              <text x={TARGET.x + TARGET.w / 2} y={mid} textAnchor="middle" dominantBaseline="central">
                {name}
              </text>
              {/* Only visible on hover or focus — at rest the picture stays a
                  picture, and the cue arrives exactly when it is useful. */}
              <text
                className="rt-target-cue"
                x={TARGET.x + TARGET.w - 16}
                y={mid}
                textAnchor="end"
                dominantBaseline="central"
                aria-hidden="true"
              >
                →
              </text>
            </g>
          </Link>
        );
      })}
    </svg>
  );
}
