import { create } from "zustand";

interface ReportStore {
  generatedPrompt: string;
  aiResult: string;
  gathering: boolean;
  generating: boolean;
  setGeneratedPrompt: (prompt: string) => void;
  setAiResult: (result: string) => void;
  setGathering: (v: boolean) => void;
  setGenerating: (v: boolean) => void;
  reset: () => void;
}

export const useReportStore = create<ReportStore>((set) => ({
  generatedPrompt: "",
  aiResult: "",
  gathering: false,
  generating: false,
  setGeneratedPrompt: (prompt) => set({ generatedPrompt: prompt }),
  setAiResult: (result) => set({ aiResult: result }),
  setGathering: (v) => set({ gathering: v }),
  setGenerating: (v) => set({ generating: v }),
  reset: () => set({ generatedPrompt: "", aiResult: "", gathering: false, generating: false }),
}));
