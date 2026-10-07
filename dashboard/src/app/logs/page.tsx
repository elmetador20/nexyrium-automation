"use client";

import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  XCircle,
  AlertTriangle,
  Info,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Search,
  RotateCw,
} from "lucide-react";
import { AnimatedCard } from "@/components/shared/animated-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { LoadingSkeleton } from "@/components/shared/loading-skeleton";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

type LogType = "error" | "warning" | "info";

const TABS: { key: LogType | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "error", label: "Errors" },
  { key: "warning", label: "Warnings" },
  { key: "info", label: "Info" },
];

const TYPE_CONFIG: Record<
  LogType,
  { icon: typeof XCircle; color: string; bg: string }
> = {
  error: {
    icon: XCircle,
    color: "text-error",
    bg: "bg-error/10",
  },
  warning: {
    icon: AlertTriangle,
    color: "text-yellow-500",
    bg: "bg-yellow-500/10",
  },
  info: {
    icon: Info,
    color: "text-primary",
    bg: "bg-primary/10",
  },
};

function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diff = now - then;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function formatDate(timestamp: string): string {
  return new Date(timestamp).toLocaleString();
}

export default function LogsPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<LogType | "all">("all");
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["logs", activeTab, page, limit],
    queryFn: () =>
      api.logs.list({
        page,
        limit,
        level: activeTab === "all" ? undefined : activeTab,
      }),
    refetchInterval: 30_000,
  });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const handleRefresh = useCallback(() => {
    refetch();
    toast("Logs updated.", "success");
  }, [refetch, toast]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Activity Logs</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {total} total entries
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefetching}
        >
          <RefreshCw
            className={cn(
              "h-4 w-4 mr-2",
              isRefetching && "animate-spin"
            )}
          />
          Refresh
        </Button>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1 p-1 bg-card rounded-lg border border-border w-fit">
        {TABS.map((tab) => {
          return (
            <button
              key={tab.key}
              onClick={() => {
                setActiveTab(tab.key);
                setPage(1);
              }}
              className={cn(
                "px-4 py-2 text-sm font-medium rounded-md transition-all",
                activeTab === tab.key
                  ? "bg-primary text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <LoadingSkeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && logs.length === 0 && (
        <AnimatedCard className="flex flex-col items-center justify-center py-16 text-center">
          <div className="p-4 rounded-full bg-accent mb-4">
            <Search className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="text-lg font-medium text-foreground">No logs found</p>
          <p className="text-sm text-muted-foreground mt-1">
            {activeTab !== "all"
              ? `No ${activeTab} logs to display.`
              : "Activity will appear here as leads are processed."}
          </p>
        </AnimatedCard>
      )}

      {/* Log Entries */}
      {!isLoading && logs.length > 0 && (
        <div className="space-y-2">
          {logs.map((log, idx) => {
            const config = TYPE_CONFIG[log.type];
            const Icon = config.icon;
            return (
              <AnimatedCard key={log.id} delay={idx * 30}>
                <div className="flex items-start gap-4 p-4">
                  {/* Type Icon */}
                  <div
                    className={cn(
                      "flex-shrink-0 p-2 rounded-lg",
                      config.bg
                    )}
                  >
                    <Icon className={cn("h-5 w-5", config.color)} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground leading-relaxed">
                      {log.message}
                    </p>
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      {log.phone && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-accent text-muted-foreground border border-border">
                          {log.phone}
                        </span>
                      )}
                      <StatusBadge status={log.status} />
                      {log.retryCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs text-yellow-500">
                          <RotateCw className="h-3 w-3" />
                          {log.retryCount} retries
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Timestamp */}
                  <div className="flex-shrink-0 text-right">
                    <p
                      className="text-xs text-muted-foreground"
                      title={formatDate(log.timestamp)}
                    >
                      {formatRelativeTime(log.timestamp)}
                    </p>
                  </div>
                </div>
              </AnimatedCard>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {!isLoading && totalPages > 1 && (
        <div className="flex items-center justify-between pt-4">
          <p className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => {
              const start = Math.max(1, Math.min(page - 2, totalPages - 4));
              const pageNum = start + i;
              if (pageNum > totalPages) return null;
              return (
                <Button
                  key={pageNum}
                  variant={pageNum === page ? "default" : "outline"}
                  size="sm"
                  onClick={() => setPage(pageNum)}
                  className={cn(
                    pageNum === page &&
                      "bg-primary text-white"
                  )}
                >
                  {pageNum}
                </Button>
              );
            })}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
