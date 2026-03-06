import { create } from "zustand";
import type { Setting } from "@/lib/types";
import * as commands from "@/lib/tauri";

interface SettingsStore {
  settings: Record<string, string>;
  loading: boolean;
  fetchSettings: () => Promise<void>;
  updateSetting: (key: string, value: string) => Promise<void>;
  getSetting: (key: string, defaultValue?: string) => string;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: {},
  loading: false,

  fetchSettings: async () => {
    set({ loading: true });
    try {
      const settingsList: Setting[] = await commands.getSettings();
      const settings: Record<string, string> = {};
      for (const s of settingsList) {
        settings[s.key] = s.value;
      }
      set({ settings, loading: false });
    } catch (e) {
      console.error("Failed to fetch settings:", e);
      set({ loading: false });
    }
  },

  updateSetting: async (key: string, value: string) => {
    try {
      await commands.updateSetting(key, value);
      set((state) => ({
        settings: { ...state.settings, [key]: value },
      }));
    } catch (e) {
      console.error("Failed to update setting:", e);
    }
  },

  getSetting: (key: string, defaultValue = "") => {
    return get().settings[key] ?? defaultValue;
  },
}));
