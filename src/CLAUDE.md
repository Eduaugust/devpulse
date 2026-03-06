# 📋 Frontend — React + TypeScript

## 🏗️ Architecture

Single-page app with React Router v7, Zustand for state, and Tailwind CSS 4 for styling.

```
src/
├── components/     # Reusable UI (AppShell, Sidebar, EventCard, etc.)
├── pages/          # Route pages (Dashboard, PrReview, Settings, etc.)
├── stores/         # Zustand state stores (events, settings, github, etc.)
├── hooks/          # Custom hooks (useMonitorListener, useSidebarOrder)
├── lib/            # Utilities (tauri wrappers, credentials, types, platform)
└── main.tsx        # Entry point — routing + MonitorListener
```

## 🎯 Key Conventions

### Imports

All imports use the `@/` alias (mapped to `src/`):

```typescript
import { EventCard } from "@/components/EventCard";
import { useEventStore } from "@/stores/eventStore";
import type { DevEvent } from "@/lib/types";
```

### Component Pattern

Functional components with named exports:

```typescript
// ✅ Named export
export function Dashboard() { ... }

// ❌ Default export
export default function Dashboard() { ... }
```

### Styling

Tailwind CSS utility classes with `cn()` helper for conditionals:

```typescript
import { cn } from "@/lib/utils";

<div className={cn(
  "flex items-center gap-2 px-3 py-2 rounded-md text-sm",
  isActive ? "bg-sidebar-accent font-medium" : "text-sidebar-foreground"
)} />
```

### Toggle Switches

Use the shared `ToggleSwitch` component:

```typescript
// ✅ Use ToggleSwitch
import { ToggleSwitch } from "@/components/ToggleSwitch";
<ToggleSwitch
  enabled={settings.notify_prs === "true"}
  onToggle={() => updateSetting("notify_prs", ...)}
  disabled={false}
/>

// ❌ Don't write inline toggle buttons
<button className={`relative w-9 h-5 rounded-full ...`}>
```

### Terminal Options

Platform-specific terminal lists live in `lib/platform.ts`:

```typescript
import { getTerminalOptions, getPlatform } from "@/lib/platform";
const os = await getPlatform();
const options = getTerminalOptions(os);
```

## 🔧 Entry Point — `main.tsx`

```
ReactDOM.createRoot → ThemeProvider → BrowserRouter
  ├── MonitorListener (invisible — runs useMonitorListener hook)
  └── Routes
      ├── /tray → TrayPanel
      └── AppShell (Sidebar + content)
          ├── / → Dashboard
          ├── /history → History
          ├── /claude-code → ClaudeCode
          ├── /pr-review → PrReview
          ├── /commands → Commands
          ├── /connections → Connections
          ├── /settings → Settings
          └── /reports → ReportGenerator
```

The `MonitorListener` component handles:
- Auto-starting the background monitor
- Listening for `monitor:*` events from the Rust backend
- Auto-review, auto-description, and auto-fix PR workflows
- Notification click → navigation routing

## 📚 Related Documentation

- `components/CLAUDE.md` — UI components
- `pages/CLAUDE.md` — Application pages
- `stores/CLAUDE.md` — State management
- `hooks/CLAUDE.md` — Custom hooks
- `lib/CLAUDE.md` — Utilities and types
