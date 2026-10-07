import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const statusVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium leading-none whitespace-nowrap",
  {
    variants: {
      status: {
        green:
          "bg-primary/15 text-primary",
        amber:
          "bg-warning/15 text-warning",
        red:
          "bg-error/15 text-error",
        blue:
          "bg-blue-500/15 text-blue-400",
        gray:
          "bg-muted/15 text-muted-foreground",
      },
    },
    defaultVariants: {
      status: "gray",
    },
  }
);

type StatusVariant = VariantProps<typeof statusVariants>["status"];

const STATUS_MAP: Record<string, StatusVariant> = {
  NEW: "green",
  ACTIVE: "green",
  ok: "green",
  connected: "green",
  AI_PENDING: "amber",
  SYNC_PENDING: "amber",
  WARNING: "amber",
  LOST: "red",
  ERROR: "red",
  disconnected: "red",
  QUALIFIED: "blue",
  CONTACTED: "blue",
  CONVERTED: "blue",
};

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const variant = STATUS_MAP[status] ?? "gray";

  return (
    <span className={cn(statusVariants({ status: variant }), className)}>
      {status}
    </span>
  );
}
