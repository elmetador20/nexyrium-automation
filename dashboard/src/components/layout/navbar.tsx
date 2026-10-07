"use client";

import { usePathname } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWhatsAppStatus } from "@/hooks/use-whatsapp";

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/connections": "Connections",
  "/leads": "Leads",
  "/logs": "Logs",
  "/settings": "Settings",
};

function resolveTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  const segment = pathname.split("/").filter(Boolean)[0];
  return segment ? segment.charAt(0).toUpperCase() + segment.slice(1) : "Dashboard";
}

export function Navbar() {
  const pathname = usePathname();
  const { data: status, refetch, isFetching } = useWhatsAppStatus();
  const connected = status?.connected ?? false;

  return (
    <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-border bg-card/80 px-6 backdrop-blur-md">
      <h1 className="text-lg font-semibold text-primary">
        {resolveTitle(pathname)}
      </h1>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              connected ? "bg-primary" : "bg-red-500"
            )}
          />
          <span className="hidden sm:inline">
            {connected ? "Connected" : "Disconnected"}
          </span>
        </div>

        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-primary disabled:opacity-50"
        >
          <RefreshCw
            className={cn("h-4 w-4", isFetching && "animate-spin")}
          />
        </button>
      </div>
    </header>
  );
}
