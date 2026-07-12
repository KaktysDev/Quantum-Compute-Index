"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default function SignInButton({
  label = "Sign in",
  variant = "glass",
  className = "",
  next = "/dashboard",
}: {
  label?: string;
  variant?: "glass" | "solid";
  className?: string;
  next?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configured = isSupabaseConfigured();

  async function handleSignIn() {
    if (!configured) {
      if (process.env.NODE_ENV !== "production") {
        window.location.href = next;
        return;
      }
      setError("Sign-in is temporarily unavailable.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (error) {
        setError(error.message);
        setLoading(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
      setLoading(false);
    }
  }

  return (
    <div className={`inline-flex flex-col items-end gap-1.5 ${className}`}>
      <button
        onClick={handleSignIn}
        disabled={loading}
        className={`btn sheen ${variant === "solid" ? "btn-solid" : "btn-glass"}`}
        title={configured ? undefined : "Add Supabase env vars to enable sign-in"}
      >
        {loading ? "Redirecting…" : label}
      </button>
      {error && <span className="text-xs text-[var(--muted)]">{error}</span>}
    </div>
  );
}
