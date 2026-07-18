import LogoMark from "./LogoMark";

export default function Logo({ size = 26 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={size} />
      <span className="text-[15px] font-bold uppercase tracking-[0.02em] text-white">
        QROUTER
      </span>
    </div>
  );
}
