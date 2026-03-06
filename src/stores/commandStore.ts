import { create } from "zustand";
import type { CommandDef, CommandRun } from "@/lib/types";
import * as commands from "@/lib/tauri";

interface CommandStore {
  commands: CommandDef[];
  runs: CommandRun[];
  loading: boolean;
  fetchCommands: () => Promise<void>;
  fetchRuns: (commandId?: number) => Promise<void>;
  saveCommand: (command: CommandDef) => Promise<number>;
  deleteCommand: (id: number) => Promise<void>;
  getCommandBySlug: (slug: string) => Promise<CommandDef | null>;
}

export const useCommandStore = create<CommandStore>((set) => ({
  commands: [],
  runs: [],
  loading: false,

  fetchCommands: async () => {
    set({ loading: true });
    try {
      const cmds = await commands.getCommands();
      set({ commands: cmds, loading: false });
    } catch (e) {
      console.error("Failed to fetch commands:", e);
      set({ loading: false });
    }
  },

  fetchRuns: async (commandId?: number) => {
    try {
      const runs = await commands.getCommandRuns(commandId);
      set({ runs });
    } catch (e) {
      console.error("Failed to fetch command runs:", e);
    }
  },

  saveCommand: async (command: CommandDef) => {
    const id = await commands.saveCommand(command);
    const cmds = await commands.getCommands();
    set({ commands: cmds });
    return id;
  },

  deleteCommand: async (id: number) => {
    await commands.deleteCommand(id);
    const cmds = await commands.getCommands();
    set({ commands: cmds });
  },

  getCommandBySlug: async (slug: string) => {
    return commands.getCommandBySlug(slug);
  },
}));
