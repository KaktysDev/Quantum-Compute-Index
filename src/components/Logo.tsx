export default function Logo({ size = 26 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="qf" x1="0" y1="0" x2="32" y2="32">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor="#65d9a5" />
          </linearGradient>
        </defs>
        {/* stacked bars — a quiet nod to a market depth ladder */}
        <rect x="6" y="8" width="20" height="2.4" rx="1.2" fill="url(#qf)" />
        <rect x="6" y="14.8" width="20" height="2.4" rx="1.2" fill="url(#qf)" opacity="0.75" />
        <rect x="6" y="21.6" width="20" height="2.4" rx="1.2" fill="url(#qf)" opacity="0.5" />
      </svg>
      <span className="text-[15px] font-medium tracking-tight text-white">QuantumForge</span>
    </div>
  );
}
