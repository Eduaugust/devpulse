import { create } from "zustand";
import type { ConnectionStatus } from "@/lib/types";
import * as commands from "@/lib/tauri";
import { getCredential } from "@/lib/credentials";
import { useSettingsStore } from "./settingsStore";

interface ConnectionStore {
  github: ConnectionStatus;
  gitlab: ConnectionStatus;
  azure: ConnectionStatus;
  bitbucket: ConnectionStatus;
  kimai: ConnectionStatus;
  calendar: ConnectionStatus;
  claude: ConnectionStatus;
  claudeCli: ConnectionStatus;
  checkGitHub: () => Promise<void>;
  checkGitLab: () => Promise<void>;
  checkAzure: () => Promise<void>;
  checkBitbucket: () => Promise<void>;
  checkKimai: () => Promise<void>;
  checkCalendar: () => Promise<void>;
  checkClaude: () => Promise<void>;
  checkClaudeCli: () => Promise<void>;
  checkAll: () => Promise<void>;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  github: { status: "disconnected" },
  gitlab: { status: "disconnected" },
  azure: { status: "disconnected" },
  bitbucket: { status: "disconnected" },
  kimai: { status: "disconnected" },
  calendar: { status: "disconnected" },
  claude: { status: "disconnected" },
  claudeCli: { status: "disconnected" },

  checkGitHub: async () => {
    set({ github: { status: "checking" } });
    try {
      const ok = await commands.checkGhAuth();
      set({
        github: {
          status: ok ? "connected" : "disconnected",
          message: ok ? "Authenticated via gh CLI" : "Not authenticated",
        },
      });
    } catch (e) {
      set({
        github: {
          status: "disconnected",
          message: `Error: ${e}`,
        },
      });
    }
  },

  checkGitLab: async () => {
    set({ gitlab: { status: "checking" } });
    try {
      const ok = await commands.checkGlabAuth();
      set({
        gitlab: {
          status: ok ? "connected" : "disconnected",
          message: ok ? "Authenticated via glab CLI" : "Not authenticated",
        },
      });
    } catch (e) {
      set({
        gitlab: {
          status: "disconnected",
          message: `Error: ${e}`,
        },
      });
    }
  },

  checkAzure: async () => {
    set({ azure: { status: "checking" } });
    try {
      const ok = await commands.checkAzAuth();
      set({
        azure: {
          status: ok ? "connected" : "disconnected",
          message: ok ? "Authenticated via az CLI" : "Not authenticated",
        },
      });
    } catch (e) {
      set({
        azure: {
          status: "disconnected",
          message: `Error: ${e}`,
        },
      });
    }
  },

  checkBitbucket: async () => {
    set({ bitbucket: { status: "checking" } });
    try {
      const username = await getCredential("bb_username");
      const appPassword = await getCredential("bb_app_password");
      if (!username || !appPassword) {
        set({
          bitbucket: { status: "disconnected", message: "Not configured" },
        });
        return;
      }
      const user = await commands.checkBbAuth(username, appPassword);
      set({
        bitbucket: {
          status: "connected",
          message: `Authenticated as ${user.display_name}`,
        },
      });
    } catch (e) {
      set({
        bitbucket: {
          status: "disconnected",
          message: `Error: ${e}`,
        },
      });
    }
  },

  checkKimai: async () => {
    set({ kimai: { status: "checking" } });
    try {
      const url = await getCredential("kimai_url");
      const token = await getCredential("kimai_token");
      if (!url || !token) {
        set({
          kimai: { status: "disconnected", message: "Not configured" },
        });
        return;
      }
      const result = await commands.testKimaiConnection(url, token);
      set({
        kimai: {
          status: result.connected ? "connected" : "disconnected",
          message: result.message,
        },
      });
    } catch (e) {
      set({
        kimai: { status: "disconnected", message: `Error: ${e}` },
      });
    }
  },

  checkCalendar: async () => {
    set({ calendar: { status: "checking" } });
    try {
      const creds = await getCredential("calendar_credentials");
      if (!creds) {
        set({
          calendar: { status: "disconnected", message: "Not configured" },
        });
        return;
      }
      const calendarEmail = await getCredential("calendar_email");
      const result = await commands.testCalendarConnection(creds, calendarEmail || undefined);
      set({
        calendar: {
          status: result.connected ? "connected" : "disconnected",
          message: result.message,
        },
      });
    } catch (e) {
      set({
        calendar: { status: "disconnected", message: `Error: ${e}` },
      });
    }
  },

  checkClaude: async () => {
    set({ claude: { status: "checking" } });
    try {
      const key = await getCredential("claude_api_key");
      if (!key) {
        set({
          claude: { status: "disconnected", message: "Not configured" },
        });
        return;
      }
      const result = await commands.testClaudeConnection(key);
      set({
        claude: {
          status: result.connected ? "connected" : "disconnected",
          message: result.message,
        },
      });
    } catch (e) {
      set({
        claude: { status: "disconnected", message: `Error: ${e}` },
      });
    }
  },

  checkClaudeCli: async () => {
    set({ claudeCli: { status: "checking" } });
    try {
      const result = await commands.testClaudeCli();
      set({
        claudeCli: {
          status: result.connected ? "connected" : "disconnected",
          message: result.message,
        },
      });
    } catch (e) {
      set({
        claudeCli: { status: "disconnected", message: `Error: ${e}` },
      });
    }
  },

  checkAll: async () => {
    const store = useConnectionStore.getState();
    const { getSetting } = useSettingsStore.getState();
    const on = (key: string) => getSetting(`conn_${key}`, "true") === "true";
    await Promise.all([
      on("github") ? store.checkGitHub() : Promise.resolve(),
      on("gitlab") ? store.checkGitLab() : Promise.resolve(),
      on("azure") ? store.checkAzure() : Promise.resolve(),
      on("bitbucket") ? store.checkBitbucket() : Promise.resolve(),
      on("kimai") ? store.checkKimai() : Promise.resolve(),
      on("calendar") ? store.checkCalendar() : Promise.resolve(),
      on("claude") ? store.checkClaude() : Promise.resolve(),
      on("claude_cli") ? store.checkClaudeCli() : Promise.resolve(),
    ]);
  },
}));
