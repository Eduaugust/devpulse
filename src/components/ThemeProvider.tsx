import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settingsStore";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { settings, fetchSettings } = useSettingsStore();

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    const theme = settings.theme || "dark";
    document.documentElement.classList.remove("dark", "light");

    if (theme === "system") {
      const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      if (isDark) document.documentElement.classList.add("dark");
    } else if (theme === "dark") {
      document.documentElement.classList.add("dark");
    }
  }, [settings.theme]);

  return <>{children}</>;
}
