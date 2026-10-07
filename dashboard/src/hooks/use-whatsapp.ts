import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

const WA_KEY = ["whatsapp"] as const;

export function useWhatsAppStatus() {
  return useQuery({
    queryKey: [...WA_KEY, "status"],
    queryFn: api.whatsapp.status,
    refetchInterval: 10_000,
  });
}

export function useWhatsAppQR() {
  return useQuery({
    queryKey: [...WA_KEY, "qr"],
    queryFn: api.whatsapp.qr,
    refetchInterval: 5_000,
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
