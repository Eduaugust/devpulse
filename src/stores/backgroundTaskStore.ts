import { create } from "zustand";
import type { BackgroundTask, BackgroundTaskType } from "@/lib/types";

interface BackgroundTaskStore {
  tasks: BackgroundTask[];
  addTask: (type: BackgroundTaskType, label: string, meta?: { repo?: string; prNumber?: number }) => string;
  updateTask: (id: string, updates: Partial<Pick<BackgroundTask, "status" | "result" | "error" | "finishedAt">>) => void;
  removeTask: (id: string) => void;
  clearCompleted: () => void;
  getRunningCount: () => number;
}

let taskCounter = 0;

export const useBackgroundTaskStore = create<BackgroundTaskStore>((set, get) => ({
  tasks: [],

  addTask: (type, label, meta) => {
    const id = `bg-${++taskCounter}-${Date.now()}`;
    const task: BackgroundTask = {
      id,
      type,
      label,
      status: "running",
      repo: meta?.repo,
      prNumber: meta?.prNumber,
      startedAt: Date.now(),
    };
    set((state) => ({ tasks: [task, ...state.tasks] }));
    return id;
  },

  updateTask: (id, updates) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id ? { ...t, ...updates } : t,
      ),
    }));
  },

  removeTask: (id) => {
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== id),
    }));
  },

  clearCompleted: () => {
    set((state) => ({
      tasks: state.tasks.filter((t) => t.status === "running"),
    }));
  },

  getRunningCount: () => {
    return get().tasks.filter((t) => t.status === "running").length;
  },
}));
