// Console/docs theme preference. The root layout's inline script replays the
// stored value before first paint; these helpers keep that contract.

export type ThemePreference = "light" | "dark" | "system";
export const THEME_STORAGE_KEY = "qrouter-theme";

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "dark" || stored === "light" || stored === "system") return stored;
  } catch {
    /* storage blocked */
  }
  return "light";
}

export function resolveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference !== "system") return preference;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyThemePreference(preference: ThemePreference) {
  document.documentElement.setAttribute("data-theme", resolveTheme(preference));
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    /* private browsing: the choice just will not persist */
  }
}
