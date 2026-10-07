const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
const tokenKey = "nexyrium-admin-token";
let tokenPrompt: Promise<string | null> | null = null;

function requestAdminToken(): Promise<string | null> {
  tokenPrompt ??= Promise.resolve().then(() => {
    const token = window.prompt("Enter the Render backend ADMIN_API_TOKEN to access the bot dashboard.")?.trim() || null;
    if (token) window.sessionStorage.setItem(tokenKey, token);
    return token;
  });
  return tokenPrompt;
}

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const storedToken = typeof window !== "undefined" ? window.sessionStorage.getItem(tokenKey) : null;
  const request = (token: string | null) => fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });

  let res = await request(storedToken);
  if (res.status === 401 && typeof window !== "undefined") {
    // Never build the private admin token into NEXT_PUBLIC_* variables.
    const latest = window.sessionStorage.getItem(tokenKey);
    const token = latest && latest !== storedToken ? latest : await requestAdminToken();
    if (token) {
      res = await request(token);
      if (res.status === 401 && window.sessionStorage.getItem(tokenKey) === token) {
        window.sessionStorage.removeItem(tokenKey);
        tokenPrompt = null;
      }
    }
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  return res.json();
}

export const api = {
  dashboard: {
    stats: () => fetchApi<import("./types").DashboardStats>("/api/dashboard/stats"),
    status: () => fetchApi<import("./types").SystemStatus>("/api/dashboard/status"),
  },
  whatsapp: {
    status: () => fetchApi<import("./types").WhatsAppStatus>("/api/whatsapp/status"),
    qr: () => fetchApi<import("./types").QRResponse>("/api/whatsapp/qr"),
    reconnect: () => fetchApi<{ success: boolean; message: string }>("/api/whatsapp/reconnect", { method: "POST" }),
    disconnect: () => fetchApi<{ success: boolean; message: string }>("/api/whatsapp/disconnect", { method: "POST" }),
  },
  leads: {
    list: (params?: { page?: number; limit?: number; search?: string; status?: string; sort?: string; order?: string }) => {
      const searchParams = new URLSearchParams();
      if (params?.page) searchParams.set("page", String(params.page));
      if (params?.limit) searchParams.set("limit", String(params.limit));
      if (params?.search) searchParams.set("search", params.search);
      if (params?.status) searchParams.set("status", params.status);
      if (params?.sort) searchParams.set("sort", params.sort);
      if (params?.order) searchParams.set("order", params.order);
      const qs = searchParams.toString();
      return fetchApi<import("./types").PaginatedLeads>(`/api/leads${qs ? `?${qs}` : ""}`);
    },
    get: (id: string) => fetchApi<import("./types").Lead>(`/api/leads/${id}`),
    salespeople: () => fetchApi<{ salespeople: string[] }>("/api/leads/salespeople"),
    assign: (id: string, assignedSalesperson: string) =>
      fetchApi<{ lead: import("./types").Lead; synced: boolean }>(`/api/leads/${id}/assignment`, {
        method: "PATCH",
        body: JSON.stringify({ assignedSalesperson }),
      }),
    conversation: (id: string) => fetchApi<import("./types").Conversation>(`/api/conversations/${id}`),
  },
  settings: {
    get: () => fetchApi<import("./types").Settings>("/api/settings"),
    testAi: () => fetchApi<{ success: boolean; result?: unknown; error?: string }>("/api/settings/test-ai", { method: "POST" }),
    syncSheets: () => fetchApi<{ success: boolean; synced: number; total: number }>("/api/settings/sync-sheets", { method: "POST" }),
    reconnectWhatsApp: () => fetchApi<{ success: boolean; message: string }>("/api/settings/reconnect-whatsapp", { method: "POST" }),
    restartWorker: () => fetchApi<{ success: boolean; message: string }>("/api/settings/restart-worker", { method: "POST" }),
  },
  logs: {
    list: (params?: { page?: number; limit?: number; level?: string }) => {
      const searchParams = new URLSearchParams();
      if (params?.page) searchParams.set("page", String(params.page));
      if (params?.limit) searchParams.set("limit", String(params.limit));
      if (params?.level) searchParams.set("level", params.level);
      const qs = searchParams.toString();
      return fetchApi<{ logs: import("./types").LogEntry[]; total: number; page: number; limit: number }>(`/api/logs${qs ? `?${qs}` : ""}`);
    },
  },
};
