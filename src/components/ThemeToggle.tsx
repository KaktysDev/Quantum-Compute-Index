"use client";

// Appearance switch. Writes data-theme on <html> and remembers the choice in
// localStorage; the inline script in the root layout replays it before first
// paint so there is no flash. Light is the default (no attribute set).

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";
export const THEME_STORAGE_KEY = "qrouter-theme";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "dark") root.setAttribute("data-theme", "dark");
  else root.setAttribute("data-theme", "light");
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* private browsing — the choice just will not persist */
  }
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const stored = document.documentElement.getAttribute("data-theme");
    setTheme(stored === "dark" ? "dark" : "light");
  }, []);

  function choose(next: Theme) {
    setTheme(next);
    applyTheme(next);
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
