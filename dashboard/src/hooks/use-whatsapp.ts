import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, getPollingInterval } from "@/lib/api";

const WA_KEY = ["whatsapp"] as const;

export function useWhatsAppStatus({ poll = true }: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: [...WA_KEY, "status"],
    queryFn: api.whatsapp.status,
    refetchInterval: poll
      ? (query) => getPollingInterval(10_000, query.state.error, query.state.fetchFailureCount)
      : false,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchIntervalInBackground: false,
  });
}

export function useWhatsAppQR({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [...WA_KEY, "qr"],
    queryFn: api.whatsapp.qr,
    enabled,
    refetchInterval: enabled
      ? (query) => getPollingInterval(5_000, query.state.error, query.state.fetchFailureCount)
      : false,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchIntervalInBackground: false,
  });
}

export function useReconnectWhatsApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.whatsapp.reconnect,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WA_KEY });
    },
  });
}

export function useDisconnectWhatsApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.whatsapp.disconnect,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WA_KEY });
    },
  });
}
