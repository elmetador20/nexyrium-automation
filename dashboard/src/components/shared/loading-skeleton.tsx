import { cn } from "@/lib/utils";

interface LoadingSkeletonProps {
  className?: string;
  variant?: "rectangular" | "circular" | "text";
  width?: number | string;
  height?: number | string;
}

export function LoadingSkeleton({
  className,
  variant = "rectangular",
  width,
  height,
}: LoadingSkeletonProps) {
  const variantClasses: Record<string, string> = {
    rectangular: "rounded-lg",
    circular: "rounded-full",
    text: "rounded h-4",
  };

  return (
    <div
      className={cn("animate-shimmer", variantClasses[variant], className)}
      style={{
        width: width ?? "100%",
        height: height ?? (variant === "text" ? undefined : "100%"),
      }}
      aria-hidden="true"
    />
  );
}
