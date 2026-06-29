import GlassCard from "@/components/GlassCard";
import ProviderKeyForm from "@/components/ProviderKeyForm";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Settings</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Connect quantum-cloud providers. Their data feeds the QCI calculation.
        </p>
      </div>

      <GlassCard className="p-5">
        <h2 className="text-sm font-medium text-white">Provider API keys</h2>
        <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
          Paste each provider&apos;s API key below. Keys are encrypted at rest and never shown
          again. The index recomputes automatically at <span className="text-white">9:30 AM ET</span>{" "}
          each day using all enabled providers. Until at least one key is added, the exchange shows
          clearly-labeled <span className="text-white">sample data</span>.
        </p>
      </GlassCard>

      <ProviderKeyForm />
    </div>
  );
}
