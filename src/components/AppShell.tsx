import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { BackgroundTasks } from "./BackgroundTasks";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function AppShell() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).closest("button, a")) return;
            e.preventDefault();
            getCurrentWindow().startDragging();
          }}
          className="h-10 flex items-center justify-end px-4 border-b bg-background shrink-0"
        >
          <BackgroundTasks />
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
