// Monochrome provider marks. These are clean, on-brand stylizations (no color)
// rather than official logos — drop in official monochrome SVGs anytime.

import type { ReactNode } from "react";

interface Company {
  name: string;
  sub: string;
  mark: ReactNode;
}

const S = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const };

const COMPANIES: Company[] = [
  {
    name: "IBM Quantum",
    sub: "Heron · Eagle",
    mark: (
      <svg viewBox="0 0 48 48" className="h-9 w-9">
        <g {...S}>
          <line x1="9" y1="14" x2="39" y2="14" />
          <line x1="9" y1="20" x2="39" y2="20" />
          <line x1="9" y1="26" x2="39" y2="26" />
          <line x1="9" y1="32" x2="39" y2="32" />
        </g>
      </svg>
    ),
  },
  {
    name: "IonQ",
    sub: "Aria · Forte",
    mark: (
      <svg viewBox="0 0 48 48" className="h-9 w-9">
        <g {...S}>
          <circle cx="24" cy="24" r="14" />
          <circle cx="24" cy="24" r="7.5" />
        </g>
        <circle cx="24" cy="24" r="3" fill="currentColor" />
      </svg>
    ),
  },
  {
    name: "Rigetti",
    sub: "Ankaa",
    mark: (
      <svg viewBox="0 0 48 48" className="h-9 w-9">
        <g {...S}>
          <rect x="15" y="15" width="18" height="18" rx="2" />
          <rect x="21" y="21" width="6" height="6" rx="1" />
          <line x1="24" y1="9" x2="24" y2="15" />
          <line x1="24" y1="33" x2="24" y2="39" />
          <line x1="9" y1="24" x2="15" y2="24" />
          <line x1="33" y1="24" x2="39" y2="24" />
        </g>
      </svg>
    ),
  },
  {
    name: "IQM",
    sub: "Garnet · Emerald",
    mark: (
      <svg viewBox="0 0 48 48" className="h-9 w-9">
        <g {...S}>
          <rect x="14" y="14" width="20" height="20" transform="rotate(45 24 24)" />
          <rect x="19.5" y="19.5" width="9" height="9" transform="rotate(45 24 24)" />
        </g>
      </svg>
    ),
  },
  {
    name: "AWS Braket",
    sub: "Rigetti · QuEra · AQT",
    mark: (
      <svg viewBox="0 0 48 48" className="h-9 w-9">
        <g {...S}>
          <polyline points="20,12 11,24 20,36" />
          <polyline points="28,12 37,24 28,36" />
        </g>
        <circle cx="24" cy="24" r="2.6" fill="currentColor" />
      </svg>
    ),
  },
  {
    name: "Quandela",
    sub: "Belenos · photonic",
    mark: (
      <svg viewBox="0 0 48 48" className="h-9 w-9">
        <g {...S}>
          <circle cx="18" cy="24" r="8" />
          <circle cx="30" cy="24" r="8" />
        </g>
      </svg>
    ),
  },
];

export default function CompanyLogos() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      {COMPANIES.map((c) => (
        <div
          key={c.name}
          className="glass glass-hover sheen flex flex-col items-center gap-3 rounded-2xl p-6 text-center text-white"
        >
          <span className="text-white/85">{c.mark}</span>
          <div>
            <p className="text-sm font-medium text-white">{c.name}</p>
            <p className="mono-label mt-1 normal-case tracking-normal">{c.sub}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
