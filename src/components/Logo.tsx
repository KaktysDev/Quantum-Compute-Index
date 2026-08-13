import LogoMark from "./LogoMark";

export default function Logo({ size = 26 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={size} />
      {/* Colour is inherited so the lockup reads on light and dark shells alike. */}
      <span className="text-[15px] font-bold uppercase tracking-[0.02em]">
        QROUTER
      </span>
    </div>
  );
}
