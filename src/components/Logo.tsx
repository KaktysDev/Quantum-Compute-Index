export default function Logo({ size = 26 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <path d="M6 9h8l4 7-4 7H6l4-7-4-7Z" fill="#FF6B00" />
        <path d="M18 9h8l-4 7 4 7h-8l-4-7 4-7Z" fill="white" fillOpacity=".88" />
      </svg>
      <span className="text-[15px] font-semibold tracking-normal text-white">QRouter</span>
    </div>
  );
}
