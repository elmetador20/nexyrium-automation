import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PaginatedLeads } from "@/lib/types";

export interface LeadsParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  sort?: string;
  order?: string;
}

export function useLeads(params: LeadsParams = {}) {
  const { page, limit, search, status, sort, order } = params;
  return useQuery<PaginatedLeads>({
    queryKey: ["leads", { page, limit, search, status, sort, order }],
    queryFn: () => api.leads.list({ page, limit, search, status, sort, order }),
    placeholderData: (prev) => prev,
    refetchInterval: 30_000,
  });
}

export function useLead(id: string | null) {
  return useQuery({
    queryKey: ["leads", id],
    queryFn: () => api.leads.get(id!),
    enabled: !!id,
    refetchInterval: 30_000,
  });
}

export function useSalespeople() {
  return useQuery({
    queryKey: ["salespeople"],
    queryFn: () => api.leads.salespeople(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useAssignLead(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.leads.assign(id, name),
    onSuccess: (result) => {
      queryClient.setQueryData(["leads", id], (previous: import("@/lib/types").Lead | undefined) => ({
        ...previous, ...result.lead,
      }));
      queryClient.setQueriesData<PaginatedLeads>({
        queryKey: ["leads"],
        predicate: (query) => typeof query.queryKey[1] === "object",
      }, (previous) => previous && ({
        ...previous,
        leads: previous.leads.map((lead) => lead.id === id ? { ...lead, ...result.lead } : lead),
      }));
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
