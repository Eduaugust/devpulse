import { create } from "zustand";
import type { DevEvent, EventFilters } from "@/lib/types";
import * as commands from "@/lib/tauri";

interface EventStore {
  events: DevEvent[];
  recentEvents: DevEvent[];
  loading: boolean;
  filters: EventFilters;
  fetchEvents: (filters?: EventFilters) => Promise<void>;
  fetchRecentEvents: () => Promise<void>;
  setFilters: (filters: EventFilters) => void;
}

export const useEventStore = create<EventStore>((set, get) => ({
  events: [],
  recentEvents: [],
  loading: false,
  filters: {},

  fetchEvents: async (filters?: EventFilters) => {
    set({ loading: true });
    try {
      const f = filters || get().filters;
      const events = await commands.getEvents(f);
      set({ events, loading: false });
    } catch (e) {
      console.error("Failed to fetch events:", e);
      set({ loading: false });
    }
  },

  fetchRecentEvents: async () => {
    try {
      const recentEvents = await commands.getRecentEvents();
      set({ recentEvents });
    } catch (e) {
      console.error("Failed to fetch recent events:", e);
    }
  },

  setFilters: (filters: EventFilters) => {
    set({ filters });
  },
}));
