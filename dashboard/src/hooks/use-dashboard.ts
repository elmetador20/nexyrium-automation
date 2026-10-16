import { useQuery } from "@tanstack/react-query";
import { api, getPollingInterval } from "@/lib/api";

export function useDashboardStats() {
  return useQuery({
    queryKey: ["dashboard", "stats"],
    queryFn: api.dashboard.stats,
    refetchInterval: (query) => getPollingInterval(30_000, query.state.error, query.state.fetchFailureCount),
    retry: false,
  });
}

export function useSystemStatus() {
  return useQuery({
    queryKey: ["dashboard", "status"],
    queryFn: api.dashboard.status,
    refetchInterval: (query) => getPollingInterval(10_000, query.state.error, query.state.fetchFailureCount),
    retry: false,
  });
}
