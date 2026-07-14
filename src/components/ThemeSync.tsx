"use client";

import { useEffect } from "react";

/**
 * Applies the signed-in user's saved theme (profiles.preferences.theme) when
 * the console loads, and mirrors it to localStorage so the root layout's
 * no-flash snippet picks it up on the next visit. The saved profile value is
 * the source of truth after login — it restores the choice on new devices.
 */
export default function ThemeSync({ theme }: { theme?: string }) {
  useEffect(() => {
    if (theme !== "dark" && theme !== "light") return;
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("qr-theme", theme);
    } catch {
      /* private mode etc. — cosmetic only */
    }
  }, [theme]);
  return null;
}
