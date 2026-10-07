"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastVariant = "success" | "error" | "info" | "warning";

interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const variantConfig: Record<
  ToastVariant,
  { icon: typeof CheckCircle2; class: string }
> = {
  success: {
    icon: CheckCircle2,
    class: "border-primary/30 bg-primary/10 text-primary",
  },
  error: {
    icon: XCircle,
    class: "border-error/30 bg-error/10 text-error",
  },
  info: {
    icon: Info,
    class: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  },
  warning: {
    icon: AlertTriangle,
    class: "border-warning/30 bg-warning/10 text-warning",
  },
};

let counter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (message: string, variant: ToastVariant = "info") => {
      const id = `toast-${++counter}`;
      setToasts((prev) => [...prev, { id, message, variant }]);

      const timer = setTimeout(() => dismiss(id), 5000);
      timers.current.set(id, timer);
    },
    [dismiss]
  );

  const ctx = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => {
            const config = variantConfig[t.variant];
            const Icon = config.icon;
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 16, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className={cn(
                  "flex items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium shadow-lg backdrop-blur-sm",
                  config.class
                )}
              >
                <Icon size={16} className="shrink-0" />
                <span className="flex-1">{t.message}</span>
                <button
                  onClick={() => dismiss(t.id)}
                  className="shrink-0 rounded p-0.5 opacity-70 transition-opacity hover:opacity-100"
                  aria-label="Dismiss"
                >
                  <X size={14} />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a <ToastProvider>");
  }
  return ctx;
}
