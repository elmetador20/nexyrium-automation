"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageCircle,
  Smartphone,
  RefreshCw,
  Unlink,
  CheckCircle2,
  QrCode,
  Loader2,
  User,
  Phone,
  Globe,
  Clock,
} from "lucide-react";
import { useWhatsAppStatus, useWhatsAppQR, useReconnectWhatsApp, useDisconnectWhatsApp } from "@/hooks/use-whatsapp";
import { AnimatedCard } from "@/components/shared/animated-card";
import { LoadingSkeleton } from "@/components/shared/loading-skeleton";
import { Button } from "@/components/ui/button";
import { ConfirmationModal } from "@/components/shared/confirmation-modal";
import { useToast } from "@/components/ui/toast";
import { cn, formatRelativeTime, formatPhone } from "@/lib/utils";

function ConnectedPulseDot() {
  return (
    <span className="relative flex h-3 w-3">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
      <span className="relative inline-flex h-3 w-3 rounded-full bg-primary" />
    </span>
  );
}

function DisconnectedDot() {
  return <span className="inline-flex h-3 w-3 rounded-full bg-error" />;
}

function ConnectionInfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string | null | undefined;
}) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-accent/30 px-4 py-3">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium text-foreground">{value}</p>
      </div>
    </div>
  );
}

function WhatsAppConnectionCard() {
  const { data: status, isLoading } = useWhatsAppStatus();
  useWhatsAppQR();
  const reconnect = useReconnectWhatsApp();
  const disconnect = useDisconnectWhatsApp();
  const { toast } = useToast();
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  const connected = status?.connected ?? false;

  const handleReconnect = () => {
    reconnect.mutate(undefined, {
      onSuccess: (res) => {
        toast(res.message || "Reconnecting...", "success");
      },
      onError: () => {
        toast("Failed to reconnect", "error");
      },
    });
  };

  const handleDisconnect = () => {
    disconnect.mutate(undefined, {
      onSuccess: (res) => {
        toast(res?.message || "WhatsApp disconnected", "success");
      },
      onError: () => {
        toast("Failed to disconnect", "error");
      },
    });
  };

  return (
    <AnimatedCard delay={0.1} className="flex flex-col">
      <div className="flex flex-col items-center text-center">
        <motion.div
          className={cn(
            "mb-4 flex h-16 w-16 items-center justify-center rounded-2xl",
            connected ? "bg-primary/15" : "bg-error/15"
          )}
          animate={connected ? { scale: [1, 1.06, 1] } : {}}
          transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
        >
          <MessageCircle
            className={cn("h-8 w-8", connected ? "text-primary" : "text-error")}
          />
        </motion.div>

        <h3 className="text-lg font-semibold text-foreground">WhatsApp Connection</h3>

        {isLoading ? (
          <div className="mt-3 space-y-2">
            <LoadingSkeleton className="mx-auto h-5 w-32" variant="text" />
            <LoadingSkeleton className="mx-auto h-4 w-24" variant="text" />
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2">
            {connected ? <ConnectedPulseDot /> : <DisconnectedDot />}
            <span
              className={cn(
                "text-sm font-medium",
                connected ? "text-primary" : "text-error"
              )}
            >
              {connected ? "Connected" : "Disconnected"}
            </span>
          </div>
        )}

        {!isLoading && !connected && (
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">
            Scan a QR code with your WhatsApp app to connect.
          </p>
        )}
      </div>

      {!isLoading && connected && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="mt-6 space-y-3"
        >
          <ConnectionInfoRow
            icon={Phone}
            label="Phone Number"
            value={status?.phoneNumber ? formatPhone(status.phoneNumber) : null}
          />
          <ConnectionInfoRow icon={User} label="Name" value={status?.name ?? null} />
          <ConnectionInfoRow icon={Globe} label="Platform" value={status?.platform ?? null} />
          {status?.connected && (
            <div className="flex items-center gap-2 px-1 pt-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>Connected {formatRelativeTime(new Date())}</span>
            </div>
          )}
        </motion.div>
      )}

      <div className="mt-auto flex flex-col gap-3 pt-6">
        <Button
          variant="outline"
          size="md"
          onClick={handleReconnect}
          disabled={reconnect.isPending}
          className="w-full"
        >
          {reconnect.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Reconnect
        </Button>
        <Button
          variant="destructive"
          size="md"
          onClick={() => setShowDisconnectConfirm(true)}
          disabled={disconnect.isPending || !connected}
          className="w-full"
        >
          {disconnect.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Unlink className="h-4 w-4" />
          )}
          Disconnect
        </Button>
      </div>

      <ConfirmationModal
        open={showDisconnectConfirm}
        onClose={() => setShowDisconnectConfirm(false)}
        onConfirm={handleDisconnect}
        title="Disconnect WhatsApp?"
        description="The client will stop. Its remotely saved session is retained for the next reconnect."
        confirmText="Disconnect"
        cancelText="Cancel"
        variant="danger"
      />
    </AnimatedCard>
  );
}

function QRCodeCard() {
  const { data: status } = useWhatsAppStatus();
  const { data: qrData, isLoading: qrLoading } = useWhatsAppQR();

  const connected = status?.connected ?? false;
  const qrAvailable = qrData?.available ?? false;
  const qrString = qrData?.qr ?? null;

  return (
    <AnimatedCard delay={0.2} className="flex flex-col">
      <div className="flex items-center gap-2 mb-4">
        <QrCode className="h-5 w-5 text-muted-foreground" />
        <h3 className="text-lg font-semibold text-foreground">QR Code</h3>
      </div>

      <AnimatePresence mode="wait">
        {connected ? (
          <motion.div
            key="connected"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="flex flex-1 flex-col items-center justify-center py-12"
          >
            <motion.div
              className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/15"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 15 }}
            >
              <CheckCircle2 className="h-8 w-8 text-primary" />
            </motion.div>
            <p className="text-sm font-medium text-foreground">
              WhatsApp is connected
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              No QR code needed.
            </p>
          </motion.div>
        ) : qrLoading ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-1 flex-col items-center justify-center py-12"
          >
            <Loader2 className="mb-4 h-10 w-10 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Waiting for QR code...
            </p>
          </motion.div>
        ) : qrAvailable && qrString ? (
          <motion.div
            key="qr"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="flex flex-col items-center"
          >
            <motion.div
              className="relative rounded-2xl border border-border bg-white p-4"
              animate={{
                boxShadow: [
                  "0 0 0 0px rgba(34,197,94,0.0)",
                  "0 0 0 4px rgba(34,197,94,0.15)",
                  "0 0 0 0px rgba(34,197,94,0.0)",
                ],
              }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            >
              <img
                src={qrString}
                alt="WhatsApp QR Code"
                className="h-64 w-64"
                style={{ imageRendering: "pixelated" }}
              />
              <div className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-primary/15">
                <Smartphone className="h-3 w-3 text-primary" />
              </div>
            </motion.div>

            <p className="mt-5 text-sm font-medium text-foreground">
              Scan this QR code with WhatsApp
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Open WhatsApp &rarr; Settings &rarr; Linked Devices &rarr; Link a Device
            </p>

            <div className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Auto-refreshes every 5 seconds</span>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="waiting"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-1 flex-col items-center justify-center py-12"
          >
            <motion.div
              className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-accent"
              animate={{ scale: [1, 1.08, 1] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
            >
              <QrCode className="h-8 w-8 text-muted-foreground" />
            </motion.div>
            <p className="text-sm font-medium text-foreground">
              Waiting for QR code...
            </p>
            <p className="mt-1 max-w-xs text-center text-xs text-muted-foreground">
              The QR code will appear here automatically. This may take a few seconds.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </AnimatedCard>
  );
}

export default function ConnectionsPage() {
  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <h2 className="text-2xl font-bold tracking-tight text-foreground">
          Connections
        </h2>
        <p className="text-sm text-muted-foreground">
          Manage your WhatsApp connection and scan QR codes
        </p>
      </motion.div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <WhatsAppConnectionCard />
        <QRCodeCard />
      </div>
    </div>
  );
}
