import Link from "next/link";
import GlassCard from "@/components/GlassCard";
import Logo from "@/components/Logo";

export default function AccessDeniedPage() {
  return (
    <main className="qci-subpage mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-5">
      <GlassCard strong className="w-full max-w-md p-10 text-center">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <h1 className="mb-3 text-2xl font-semibold text-white">Access is invite-only</h1>
        <p className="mb-6 text-sm leading-relaxed text-[var(--muted)]">
          Your account isn&apos;t on the QRouter access list yet. Access is currently
          limited to approved partners. If you believe this is a mistake, reach out to the team to
          be added.
        </p>
        <Link href="/" className="btn btn-solid">
          Back to home
        </Link>
      </GlassCard>
    </main>
  );
}
