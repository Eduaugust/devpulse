# 📋 Hooks

Custom React hooks for shared logic.

## 📁 Hooks

### `useMonitorListener`

The core app-level hook. Runs in `MonitorListener` component (inside `main.tsx`).

**Responsibilities:**
- Auto-starts the Rust background monitor on app launch
- Requests notification permission at startup
- Listens for `monitor:new-events` → refreshes event + GitHub stores
- Listens for `monitor:last-notified-event` → navigates on window focus
- Listens for `monitor:auto-review` → runs AI review (with dedup)
- Listens for `monitor:auto-description` → generates PR description
- Listens for `monitor:auto-fixes` → opens Claude terminal with fix prompt

```typescript
// Only used in main.tsx — do not use elsewhere
function MonitorListener() {
  useMonitorListener();
  return null;
}
```

### `useSidebarOrder`

Provides sidebar item ordering and visibility, used by both `Sidebar` and `Settings`:

```typescript
const { orderItems, isVisible } = useSidebarOrder();

// Generic — works with any item shape
const ordered = orderItems(navItems, (item) => item.to);
const visible = ordered.filter((item) => isVisible(item.to));
```

**Key:** Uses a generic `orderItems<T>` function with a route extractor, so it works with both Sidebar's `{ to, icon, label }` and Settings' `{ route, label }` shapes.

## 🎯 When to Create a Hook

- Logic is shared between 2+ components → extract to a hook
- Complex effect setup (multiple `useEffect` with listeners) → extract for clarity
- **Don't** create hooks for single-use logic — keep it in the component
