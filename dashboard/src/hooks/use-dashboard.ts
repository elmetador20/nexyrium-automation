import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useDashboardStats() {
  return useQuery({
    queryKey: ["dashboard", "stats"],
    queryFn: api.dashboard.stats,
    refetchInterval: 30_000,
  });
}

export function useSystemStatus() {
  return useQuery({
    queryKey: ["dashboard", "status"],
    queryFn: api.dashboard.status,
    refetchInterval: 10_000,
  });
}
