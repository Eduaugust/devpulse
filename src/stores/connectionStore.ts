import { create } from "zustand";
import type { ConnectionStatus } from "@/lib/types";
import * as commands from "@/lib/tauri";
import { getCredential } from "@/lib/credentials";

interface ConnectionStore {
  github: ConnectionStatus;
  kimai: ConnectionStatus;
  calendar: ConnectionStatus;
  claude: ConnectionStatus;
  checkGitHub: () => Promise<void>;
  checkKimai: () => Promise<void>;
  checkCalendar: () => Promise<void>;
  checkClaude: () => Promise<void>;
  checkAll: () => Promise<void>;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  github: { status: "disconnected" },
  kimai: { status: "disconnected" },
  calendar: { status: "disconnected" },
  claude: { status: "disconnected" },

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
      const result = await commands.testCalendarConnection(creds);
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

  checkAll: async () => {
    const store = useConnectionStore.getState();
    await Promise.all([
      store.checkGitHub(),
      store.checkKimai(),
      store.checkCalendar(),
      store.checkClaude(),
    ]);
  },
}));
