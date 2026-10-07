"use client";

import { useState } from "react";
import {
  Bot,
  Table2,
  MessageCircle,
  Cog,
  Zap,
  RefreshCw,
  Wifi,
  WifiOff,
  AlertTriangle,
  Eye,
  EyeOff,
  RotateCcw,
  Clock,
  Hash,
  Timer,
} from "lucide-react";
import { AnimatedCard } from "@/components/shared/animated-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { LoadingSkeleton } from "@/components/shared/loading-skeleton";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  useSettings,
  useTestAi,
  useSyncSheets,
  useReconnectWhatsApp,
  useRestartWorker,
} from "@/hooks/use-settings";

export default function SettingsPage() {
  const { toast } = useToast();
  const { data: settings, isLoading } = useSettings();

  const testAi = useTestAi();
  const syncSheets = useSyncSheets();
  const reconnectWa = useReconnectWhatsApp();
  const restartWorker = useRestartWorker();

  const [apiKeyVisible, setApiKeyVisible] = useState(false);

  const handleTestAi = () => {
    testAi.mutate(undefined, {
      onSuccess: (res) => {
        if (res.success) {
          toast("AI Test Passed - Connection successful.", "success");
        } else {
          toast(`AI Test Failed: ${res.error ?? "Unknown error."}`, "error");
        }
      },
      onError: (err) => {
        toast(`AI Test Error: ${err.message}`, "error");
      },
    });
  };

  const handleSync = () => {
    syncSheets.mutate(undefined, {
      onSuccess: (res) => {
        toast(`${res.synced} of ${res.total} leads synced.`, "success");
      },
      onError: (err) => {
        toast(`Sync Failed: ${err.message}`, "error");
      },
    });
  };

  const handleReconnect = () => {
    reconnectWa.mutate(undefined, {
      onSuccess: (res) => {
        toast(res.message, res.success ? "success" : "error");
      },
      onError: (err) => {
        toast(`Reconnect Error: ${err.message}`, "error");
      },
    });
  };

  const handleRestart = () => {
    restartWorker.mutate(undefined, {
      onSuccess: (res) => {
        toast(res.message, res.success ? "success" : "error");
      },
      onError: (err) => {
        toast(`Restart Error: ${err.message}`, "error");
      },
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <LoadingSkeleton className="h-10 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <LoadingSkeleton key={i} className="h-64 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-primary">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure and manage your automation pipeline
        </p>
      </div>

      {/* Settings Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* OpenRouter AI Card */}
        <AnimatedCard delay={0}>
          <div className="p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2.5 rounded-lg bg-primary/10">
                <Bot className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">
                  OpenRouter AI
                </h3>
                <p className="text-xs text-muted-foreground">
                  AI processing engine
                </p>
              </div>
            </div>

            <div className="space-y-3 mb-6">
              <div className="flex items-center justify-between py-2 border-b border-border">
                <span className="text-sm text-muted-foreground">Model</span>
                <span className="text-sm font-mono text-foreground">
                  {settings?.openrouter.model ?? "N/A"}
                </span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-border">
                <span className="text-sm text-muted-foreground">
                  API Key
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono text-foreground">
                    {settings?.openrouter.hasApiKey
                      ? apiKeyVisible
                        ? "sk-...shown"
                        : "••••••••"
                      : "Not set"}
                  </span>
                  {settings?.openrouter.hasApiKey && (
                    <button
                      onClick={() => setApiKeyVisible(!apiKeyVisible)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {apiKeyVisible ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-muted-foreground">Status</span>
                <StatusBadge
                  status={
                    settings?.openrouter.hasApiKey ? "connected" : "disconnected"
                  }
                />
              </div>
            </div>

            <Button
              onClick={handleTestAi}
              disabled={testAi.isPending}
              className="w-full"
              variant="outline"
            >
              {testAi.isPending ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Zap className="h-4 w-4 mr-2" />
              )}
              {testAi.isPending ? "Testing..." : "Test AI Connection"}
            </Button>
          </div>
        </AnimatedCard>

        {/* Google Sheets Card */}
        <AnimatedCard delay={100}>
          <div className="p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2.5 rounded-lg bg-primary/10">
                <Table2 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">
                  Google Sheets
                </h3>
                <p className="text-xs text-muted-foreground">
                  Lead data source
                </p>
              </div>
            </div>

            <div className="space-y-3 mb-6">
              <div className="flex items-center justify-between py-2 border-b border-border">
                <span className="text-sm text-muted-foreground">
                  Spreadsheet
                </span>
                <span className="text-sm font-mono text-foreground truncate max-w-[180px]">
                  {settings?.googleSheets.spreadsheetId ?? "N/A"}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-muted-foreground">
                  Credentials
                </span>
                <StatusBadge
                  status={
                    settings?.googleSheets.hasCredentials
                      ? "connected"
                      : "disconnected"
                  }
                />
              </div>
            </div>

            <Button
              onClick={handleSync}
              disabled={syncSheets.isPending}
              className="w-full"
              variant="outline"
            >
              {syncSheets.isPending ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              {syncSheets.isPending ? "Syncing..." : "Sync Now"}
            </Button>
          </div>
        </AnimatedCard>

        {/* WhatsApp Card */}
        <AnimatedCard delay={200}>
          <div className="p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2.5 rounded-lg bg-primary/10">
                <MessageCircle className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">WhatsApp</h3>
                <p className="text-xs text-muted-foreground">
                  Messaging service
                </p>
              </div>
            </div>

            <div className="space-y-3 mb-6">
              <div className="flex items-center justify-between py-2 border-b border-border">
                <span className="text-sm text-muted-foreground">
                  Session Path
                </span>
                <span className="text-sm font-mono text-foreground truncate max-w-[180px]">
                  {settings?.whatsapp.sessionPath ?? "N/A"}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-muted-foreground">Status</span>
                <StatusBadge status="connected" />
              </div>
            </div>

            <Button
              onClick={handleReconnect}
              disabled={reconnectWa.isPending}
              className="w-full"
              variant="outline"
            >
              {reconnectWa.isPending ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Wifi className="h-4 w-4 mr-2" />
              )}
              {reconnectWa.isPending ? "Reconnecting..." : "Reconnect"}
            </Button>
          </div>
        </AnimatedCard>

        {/* Worker Card */}
        <AnimatedCard delay={300}>
          <div className="p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2.5 rounded-lg bg-primary/10">
                <Cog className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">
                  Worker Process
                </h3>
                <p className="text-xs text-muted-foreground">
                  Background task runner
                </p>
              </div>
            </div>

            <div className="space-y-3 mb-6">
              <div className="flex items-center justify-between py-2 border-b border-border">
                <span className="text-sm text-muted-foreground">
                  Cron Schedule
                </span>
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-sm font-mono text-foreground">
                    {settings?.worker.cronSchedule ?? "N/A"}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-border">
                <span className="text-sm text-muted-foreground">
                  Max Retries
                </span>
                <div className="flex items-center gap-1.5">
                  <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-sm font-mono text-foreground">
                    {settings?.worker.maxRetries ?? "N/A"}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-muted-foreground">
                  Retry Delay
                </span>
                <div className="flex items-center gap-1.5">
                  <Timer className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-sm font-mono text-foreground">
                    {settings?.worker.retryDelayMs
                      ? `${settings.worker.retryDelayMs / 1000}s`
                      : "N/A"}
                  </span>
                </div>
              </div>
            </div>

            <Button
              onClick={handleRestart}
              disabled={restartWorker.isPending}
              className="w-full"
              variant="outline"
            >
              {restartWorker.isPending ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4 mr-2" />
              )}
              {restartWorker.isPending
                ? "Restarting..."
                : "Restart Worker"}
            </Button>
          </div>
        </AnimatedCard>
      </div>

      {/* Danger Zone */}
      <AnimatedCard delay={400}>
        <div className="p-6 border border-error/30 bg-error/5">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2.5 rounded-lg bg-error/10">
              <AlertTriangle className="h-5 w-5 text-error" />
            </div>
            <div>
              <h3 className="font-semibold text-error">Danger Zone</h3>
              <p className="text-xs text-muted-foreground">
                Irreversible or disruptive actions
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              onClick={handleReconnect}
              disabled={reconnectWa.isPending}
              variant="outline"
              className="flex-1 border-error/30 text-error hover:bg-error/10 hover:text-error"
            >
              <WifiOff className="h-4 w-4 mr-2" />
              Disconnect WhatsApp
            </Button>
            <Button
              onClick={handleRestart}
              disabled={restartWorker.isPending}
              variant="outline"
              className="flex-1 border-error/30 text-error hover:bg-error/10 hover:text-error"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Force Restart Worker
            </Button>
          </div>
        </div>
      </AnimatedCard>
    </div>
  );
}
