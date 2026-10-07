import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

const SETTINGS_KEY = ["settings"] as const;

export function useSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: api.settings.get,
  });
}

export function useTestAi() {
  return useMutation({
    mutationFn: api.settings.testAi,
  });
}

export function useSyncSheets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.settings.syncSheets,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useReconnectWhatsApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.settings.reconnectWhatsApp,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["whatsapp"] });
    },
  });
}

export function useRestartWorker() {
  return useMutation({
    mutationFn: api.settings.restartWorker,
  });
}
