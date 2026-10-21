import { useState } from "react";

// index.html applies the saved choice (or the system preference) before first paint; this only flips it.
const DARK_THEME = "mou-dark";
const LIGHT_THEME = "mou";

export function useTheme() {
  const [isDark, setIsDark] = useState(() => document.documentElement.dataset["theme"] === DARK_THEME);

  function toggle() {
    const next = !isDark;
    let theme = LIGHT_THEME;
    let saved = "light";
    if (next) {
      theme = DARK_THEME;
      saved = "dark";
    }
    document.documentElement.dataset["theme"] = theme;
    try {
      localStorage.setItem("theme", saved);
    } catch {
      // Storage blocked: the choice lasts until reload.
    }
    setIsDark(next);
  }

  return { isDark, toggle };
}
