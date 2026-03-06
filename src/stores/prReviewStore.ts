import { create } from "zustand";
import type { MonitoredRepo, PrDetail, ReviewResult } from "@/lib/types";

type ReviewStep = "select-repo" | "select-pr" | "reviewing" | "results" | "posting" | "posted";
type PageTab = "review" | "fixes";

interface PrReviewStore {
  activeTab: PageTab;
  step: ReviewStep;
  selectedRepo: MonitoredRepo | null;
  selectedPr: PrDetail | null;
  openPrs: PrDetail[];
  reviewResult: ReviewResult | null;
  postResult: string;
  error: string;
  setActiveTab: (tab: PageTab) => void;
  setStep: (step: ReviewStep) => void;
  setSelectedRepo: (repo: MonitoredRepo | null) => void;
  setSelectedPr: (pr: PrDetail | null) => void;
  setOpenPrs: (prs: PrDetail[]) => void;
  setReviewResult: (result: ReviewResult | null) => void;
  setPostResult: (result: string) => void;
  setError: (error: string) => void;
  reset: () => void;
}

export const usePrReviewStore = create<PrReviewStore>((set) => ({
  activeTab: "review",
  step: "select-repo",
  selectedRepo: null,
  selectedPr: null,
  openPrs: [],
  reviewResult: null,
  postResult: "",
  error: "",

  setActiveTab: (activeTab) => set({ activeTab }),
  setStep: (step) => set({ step }),
  setSelectedRepo: (selectedRepo) => set({ selectedRepo }),
  setSelectedPr: (selectedPr) => set({ selectedPr }),
  setOpenPrs: (openPrs) => set({ openPrs }),
  setReviewResult: (reviewResult) => set({ reviewResult }),
  setPostResult: (postResult) => set({ postResult }),
  setError: (error) => set({ error }),
  reset: () =>
    set({
      step: "select-repo",
      selectedRepo: null,
      selectedPr: null,
      openPrs: [],
      reviewResult: null,
      postResult: "",
      error: "",
    }),
}));
