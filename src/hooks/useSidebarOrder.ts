import { useMemo, useCallback } from "react";
import { useSettingsStore } from "@/stores/settingsStore";

export function useSidebarOrder() {
  const { getSetting } = useSettingsStore();
  const orderJson = getSetting("sidebar_order", "[]");
  const savedOrder: string[] = useMemo(() => {
    try { return JSON.parse(orderJson); } catch { return []; }
  }, [orderJson]);

  const orderItems = useCallback(<T,>(items: T[], getRoute: (item: T) => string): T[] => {
    if (savedOrder.length === 0) return items;
    return savedOrder
      .map((route) => items.find((i) => getRoute(i) === route))
      .filter((v): v is T => v != null)
      .concat(items.filter((i) => !savedOrder.includes(getRoute(i))));
  }, [savedOrder]);

  const isVisible = useCallback((route: string) =>
    getSetting(`sidebar_visible_${route}`, "true") === "true",
  [getSetting]);

  return { savedOrder, orderItems, isVisible };
}
