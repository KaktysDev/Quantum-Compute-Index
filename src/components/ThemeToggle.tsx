"use client";

// Light/dark switch for the public docs. The console has its own control in
// the account menu; both share the storage contract in @/lib/client/theme.

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { applyThemePreference } from "@/lib/client/theme";

type Theme = "light" | "dark";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const stored = document.documentElement.getAttribute("data-theme");
    setTheme(stored === "dark" ? "dark" : "light");
  }, []);

  function choose(next: Theme) {
    setTheme(next);
    applyThemePreference(next);
  }

  return (
    <div className="theme-switch">
      <button
        type="button"
        className={theme === "light" ? "console-primary" : "console-secondary"}
        aria-pressed={theme === "light"}
        onClick={() => choose("light")}
      >
        <Sun size={15} /> Light
      </button>
      <button
        type="button"
        className={theme === "dark" ? "console-primary" : "console-secondary"}
        aria-pressed={theme === "dark"}
        onClick={() => choose("dark")}
      >
        <Moon size={15} /> Dark
      </button>
    </div>
  );
}
