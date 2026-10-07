"use client";

import { motion } from "framer-motion";
import {
  Users,
  TrendingUp,
  Calendar,
  MessageCircle,
  Database,
  Brain,
  FileSpreadsheet,
  Clock,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useDashboardStats, useSystemStatus } from "@/hooks/use-dashboard";
import { useWhatsAppStatus } from "@/hooks/use-whatsapp";
import { AnimatedCard } from "@/components/shared/animated-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { LoadingSkeleton } from "@/components/shared/loading-skeleton";
import { formatRelativeTime } from "@/lib/utils";

function AnimatedNumber({ value, label, icon: Icon, delay = 0 }: {
  value: number | string | undefined;
  label: string;
  icon: React.ElementType;
  delay?: number;
}) {
  return (
    <AnimatedCard delay={delay}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <motion.p
            className="mt-2 text-3xl font-bold tracking-tight text-foreground"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: delay + 0.1 }}
          >
            {value ?? (
              <span className="inline-block h-8 w-16 animate-shimmer rounded" />
            )}
          </motion.p>
        </div>
        <div className="rounded-lg bg-primary/10 p-2.5">
          <Icon className="h-5 w-5 text-primary" />
        </div>
      </div>
    </AnimatedCard>
  );
}

function WhatsAppStatusCard() {
  const { data: waStatus, isLoading } = useWhatsAppStatus();
  const connected = waStatus?.connected ?? false;

  return (
    <AnimatedCard delay={0.1} className="col-span-full sm:col-span-2 lg:col-span-1">
      <div className="flex items-center gap-4">
        <motion.div
          className={`flex h-14 w-14 items-center justify-center rounded-xl ${
            connected ? "bg-primary/15" : "bg-error/15"
          }`}
          animate={connected ? { scale: [1, 1.05, 1] } : {}}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        >
          {connected ? (
            <Wifi className="h-7 w-7 text-primary" />
          ) : (
            <WifiOff className="h-7 w-7 text-error" />
          )}
        </motion.div>
        <div className="flex-1">
          <p className="text-sm text-muted-foreground">WhatsApp Status</p>
          {isLoading ? (
            <div className="mt-2 h-6 w-24 animate-shimmer rounded" />
          ) : (
            <p className={`mt-1 text-xl font-bold ${connected ? "text-primary" : "text-error"}`}>
              {connected ? "Connected" : "Disconnected"}
            </p>
          )}
        </div>
        <span className={`h-3 w-3 rounded-full ${connected ? "bg-primary" : "bg-error"}`} />
      </div>
    </AnimatedCard>
  );
}

function SystemStatusCard({ label, status, icon: Icon }: {
  label: string;
  status: string;
  icon: React.ElementType;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-accent/50 px-4 py-3">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <div className="flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium text-foreground">{status}</p>
      </div>
      <StatusBadge status={status} />
    </div>
  );
}

export default function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: status, isLoading: statusLoading } = useSystemStatus();

  if (statsLoading || statusLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <LoadingSkeleton key={i} className="h-28" />
          ))}
        </div>
        <LoadingSkeleton className="h-48" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <LoadingSkeleton key={i} className="h-16" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Overview</h2>
        <p className="text-sm text-muted-foreground">Monitor your WhatsApp lead pipeline</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AnimatedNumber
          value={stats?.totalLeads}
          label="Total Leads"
          icon={Users}
          delay={0}
        />
        <AnimatedNumber
          value={stats?.todayLeads}
          label="Today's Leads"
          icon={Calendar}
          delay={0.05}
        />
        <AnimatedNumber
          value={stats?.weekLeads}
          label="This Week"
          icon={TrendingUp}
          delay={0.1}
        />
        <WhatsAppStatusCard />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AnimatedCard delay={0.2} className="col-span-full">
          <h3 className="mb-4 text-sm font-semibold text-foreground">System Status</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SystemStatusCard
              label="WhatsApp"
              status={status?.whatsapp?.status ?? "unknown"}
              icon={MessageCircle}
            />
            <SystemStatusCard
              label="Database"
              status={status?.database?.status ?? "unknown"}
              icon={Database}
            />
            <SystemStatusCard
              label="Google Sheets"
              status={status?.sheets?.status ?? "unknown"}
              icon={FileSpreadsheet}
            />
            <SystemStatusCard
              label="AI Engine"
              status={status?.ai?.status ?? "unknown"}
              icon={Brain}
            />
          </div>
        </AnimatedCard>

        <AnimatedCard delay={0.3}>
          <h3 className="mb-4 text-sm font-semibold text-foreground">Lead Pipeline</h3>
          <div className="space-y-3">
            {stats?.leadsByStatus && Object.entries(stats.leadsByStatus).map(([statusName, count]) => (
              <div key={statusName} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusBadge status={statusName} />
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-2 w-24 overflow-hidden rounded-full bg-accent">
                    <motion.div
                      className="h-full rounded-full bg-primary"
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, ((count as number) / (stats?.totalLeads || 1)) * 100)}%` }}
                      transition={{ duration: 0.8, delay: 0.4 }}
                    />
                  </div>
                  <span className="w-8 text-right text-sm font-medium text-foreground">
                    {count as number}
                  </span>
                </div>
              </div>
            ))}
            {(!stats?.leadsByStatus || Object.keys(stats.leadsByStatus).length === 0) && (
              <p className="py-4 text-center text-sm text-muted-foreground">No leads yet</p>
            )}
          </div>
        </AnimatedCard>

        <AnimatedCard delay={0.35}>
          <h3 className="mb-4 text-sm font-semibold text-foreground">Quick Stats</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-border bg-accent/30 px-4 py-3">
              <span className="text-sm text-muted-foreground">Active Conversations</span>
              <span className="text-lg font-bold text-foreground">{stats?.activeConversations ?? 0}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-accent/30 px-4 py-3">
              <span className="text-sm text-muted-foreground">Total Messages</span>
              <span className="text-lg font-bold text-foreground">{stats?.totalMessages ?? 0}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-accent/30 px-4 py-3">
              <span className="text-sm text-muted-foreground">Total Conversations</span>
              <span className="text-lg font-bold text-foreground">{stats?.totalConversations ?? 0}</span>
            </div>
            {status?.lastSync && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>Last sync: {formatRelativeTime(status.lastSync)}</span>
              </div>
            )}
          </div>
        </AnimatedCard>
      </div>
    </div>
  );
}
