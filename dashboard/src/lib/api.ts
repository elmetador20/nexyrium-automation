const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:10000";
const tokenKey = "nexyrium-admin-token";
let tokenPrompt: Promise<string | null> | null = null;

const MAX_RETRY_AFTER_MS = 120_000;

export class ApiError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;
  readonly cause?: unknown;

  constructor(message: string, status: number, retryAfterMs: number | null = null, cause?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.cause = cause;
  }
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, seconds * 1_000));
  }

  const retryAt = Date.parse(value);
  if (!Number.isNaN(retryAt)) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, retryAt - Date.now()));
  }

  return null;
}

function getApiErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  if (typeof body === "string" && body.trim()) return body.trim();
  return fallback;
}

export function getApiErrorStatus(error: unknown): number | null {
  return error instanceof ApiError ? error.status : null;
}

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  const status = getApiErrorStatus(error);
  if (status !== null && [401, 403, 429, 502, 503].includes(status)) return false;
  return failureCount < 1;
}

export function getPollingInterval(
  baseIntervalMs: number,
  error: unknown,
  failureCount = 0,
): number | false {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;

  const status = getApiErrorStatus(error);
  if (status === 401 || status === 403) return false;

  if (!error) return baseIntervalMs;

  if (status === 429 && error instanceof ApiError && error.retryAfterMs !== null) {
    return Math.max(baseIntervalMs, error.retryAfterMs);
  }

  const exponent = Math.min(4, Math.max(0, failureCount - 1));
  return Math.min(MAX_RETRY_AFTER_MS, baseIntervalMs * (2 ** exponent));
}

function requestAdminToken(): Promise<string | null> {
  if (tokenPrompt) return tokenPrompt;

  const prompt = Promise.resolve().then(() => {
    const token = window.prompt("Enter the Render backend ADMIN_API_TOKEN to access the bot dashboard.")?.trim() || null;
    if (token) window.sessionStorage.setItem(tokenKey, token);
    return token;
  });
  tokenPrompt = prompt;
  void prompt.then(
    () => { if (tokenPrompt === prompt) tokenPrompt = null; },
    () => { if (tokenPrompt === prompt) tokenPrompt = null; },
  );
  return prompt;
}

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const storedToken = typeof window !== "undefined" ? window.sessionStorage.getItem(tokenKey) : null;
  const request = async (token: string | null) => {
    const headers = new Headers(options?.headers);
    headers.set("Content-Type", "application/json");
    headers.delete("Authorization");
    if (token) headers.set("Authorization", `Bearer ${token}`);

    try {
      return await fetch(`${API_BASE}${path}`, {
        ...options,
        cache: "no-store",
        headers,
      });
    } catch (error) {
      throw new ApiError("Unable to reach the backend", 0, null, error);
    }
  };

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
    const body = await res.text().then((text) => {
      if (!text.trim()) return null;
      try { return JSON.parse(text) as unknown; } catch { return text; }
    });
    throw new ApiError(
      getApiErrorMessage(body, `HTTP ${res.status}`),
      res.status,
      parseRetryAfter(res.headers.get("retry-after")),
    );
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
