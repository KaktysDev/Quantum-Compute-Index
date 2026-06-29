// Monochrome vertical-bars motif (echoes the fluted-glass background).
// Pure CSS shimmer via the shared pulse-soft animation; deterministic heights.

const HEIGHTS = [38, 64, 30, 82, 52, 96, 44, 70, 58, 100, 48, 76, 34, 88, 60, 92, 40, 68];

export default function BarsGraphic({ className = "" }: { className?: string }) {
  return (
    <div className={`flex h-full w-full items-center justify-center gap-[6px] ${className}`}>
      {HEIGHTS.map((h, i) => (
        <span
          key={i}
          className="animate-pulse-soft block w-px bg-white"
          style={{
            height: `${h}%`,
            opacity: 0.15 + (h / 100) * 0.55,
            animationDelay: `${(i % 6) * 0.35}s`,
          }}
        />
      ))}
    </div>
  );
}
