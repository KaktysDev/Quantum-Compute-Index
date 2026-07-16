import LogoMark from "./LogoMark";

export default function Logo({ size = 26 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={size} />
      <span className="text-[15px] font-semibold tracking-normal text-white">QRouter</span>
    </div>
  );
}
