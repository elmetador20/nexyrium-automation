"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Sidebar } from "./sidebar";
import { Navbar } from "./navbar";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center border-b border-border bg-card lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-4 text-muted-foreground hover:text-primary"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>

        <Navbar />

        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
