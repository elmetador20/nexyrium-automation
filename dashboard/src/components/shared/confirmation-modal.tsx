"use client";

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, Info, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConfirmationModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "warning" | "default";
}

const variantConfig = {
  danger: {
    icon: Trash2,
    iconClass: "text-error",
    buttonClass:
      "bg-error text-white hover:bg-error/90",
  },
  warning: {
    icon: AlertTriangle,
    iconClass: "text-warning",
    buttonClass:
      "bg-warning text-black hover:bg-warning/90",
  },
  default: {
    icon: Info,
    iconClass: "text-primary",
    buttonClass:
      "bg-primary text-primary-foreground hover:bg-primary/90",
  },
};

export function ConfirmationModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "default",
}: ConfirmationModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const config = variantConfig[variant];
  const Icon = config.icon;

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;

    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <dialog
          ref={dialogRef}
          onClose={onClose}
          className="fixed inset-0 z-50 m-auto h-fit w-full max-w-md rounded-lg border border-border bg-card p-0 shadow-xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="p-6"
          >
            <div className="flex items-start gap-4">
              <div
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent",
                  config.iconClass
                )}
              >
                <Icon size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold text-foreground">
                  {title}
                </h2>
                {description && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {description}
                  </p>
                )}
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={onClose}
                className="rounded-md border border-border bg-accent px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-border"
              >
                {cancelText}
              </button>
              <button
                onClick={() => {
                  onConfirm();
                  onClose();
                }}
                className={cn(
                  "rounded-md px-4 py-2 text-sm font-medium transition-colors",
                  config.buttonClass
                )}
              >
                {confirmText}
              </button>
            </div>
          </motion.div>
        </dialog>
      )}
    </AnimatePresence>
  );
}
