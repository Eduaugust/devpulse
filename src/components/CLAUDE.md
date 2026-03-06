# 📋 Components

Reusable UI components used across pages.

## 📁 Components

| Component           | Purpose                                          |
| ------------------- | ------------------------------------------------ |
| `AppShell`          | Main layout — Sidebar + Outlet + BackgroundTasks |
| `Sidebar`           | Navigation sidebar with drag-reorder support     |
| `TrayPanel`         | System tray popup — compact activity overview    |
| `EventCard`         | Renders a single `DevEvent` with icon + metadata |
| `StatusPill`        | Connection status badge (connected/disconnected) |
| `ConnectionCard`    | Integration config card (title, status, children)|
| `BackgroundTasks`   | Floating panel showing async task progress       |
| `ThemeProvider`     | Applies dark/light/system theme from settings    |
| `ToggleSwitch`      | Reusable toggle switch (on/off)                  |

## 🎯 Patterns

### AppShell

Wraps all main routes (not tray). Provides the sidebar + content layout:

```tsx
<div className="flex h-screen">
  <Sidebar />
  <main className="flex-1 overflow-auto p-4">
    <Outlet />
  </main>
  <BackgroundTasks />
</div>
```

### Sidebar

Uses `useSidebarOrder` hook for user-configurable ordering and visibility. The `navItems` array defines all routes with icons.

### ConnectionCard

Generic card that receives children for custom config inputs:

```tsx
<ConnectionCard
  title="Kimai"
  icon={<Timer className="h-4 w-4" />}
  status={kimai}
  onTest={async () => { ... }}
>
  <input placeholder="Kimai URL" ... />
  <input type="password" placeholder="API Token" ... />
</ConnectionCard>
```

### ToggleSwitch

Simple boolean toggle. Always use instead of writing inline toggle buttons:

```tsx
<ToggleSwitch
  enabled={value === "true"}
  onToggle={() => updateSetting(key, value === "true" ? "false" : "true")}
  disabled={false}  // optional
/>
```

## ⚠️ Common Mistakes

- **Don't create inline toggle buttons** — Use `ToggleSwitch` component
- **Don't hardcode sidebar order** — Use `useSidebarOrder` hook
- **Don't import `invoke` directly** — Components call `lib/tauri.ts` wrappers
