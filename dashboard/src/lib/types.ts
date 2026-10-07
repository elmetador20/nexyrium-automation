export interface DashboardStats {
  totalLeads: number;
  todayLeads: number;
  weekLeads: number;
  totalConversations: number;
  activeConversations: number;
  totalMessages: number;
  leadsByStatus: Record<string, number>;
}

export interface SystemStatus {
  whatsapp: { status: string; phoneNumber: string | null };
  database: { status: string };
  sheets: { status: string };
  ai: { status: string; model: string };
  lastSync: string;
}

export interface Lead {
  id: string;
  phoneNumber: string;
  name: string | null;
  email: string | null;
  company: string | null;
  context: string | null;
  extractedData: string | null;
  parsedExtractedData: ExtractedData | null;
  source: string;
  status: string;
  retryCount: number;
  lastError: string | null;
  conversationId: string | null;
  assignedSalesperson: string | null;
  assignmentSyncPending: boolean;
  assignmentError: string | null;
  createdAt: string;
  updatedAt: string;
  conversation?: Conversation | null;
}

export interface ExtractedData {
  name: string | null;
  phone: string | null;
  requirements: "Tech" | "Pitch Deck" | null;
  requirementDetails: string | null;
  email: string | null;
  notes: string | null;
}

export interface Conversation {
  id: string;
  chatId: string;
  phone: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
  lead?: Lead | null;
}

export interface Message {
  id: string;
  content: string;
  direction: string;
  sender: string;
  chatId: string;
  timestamp: string;
  conversationId: string;
  createdAt: string;
}

export interface WhatsAppStatus {
  connected: boolean;
  phoneNumber: string | null;
  name: string | null;
  platform: string | null;
  state?: string;
  qrRequired?: boolean;
  remoteSessionSavedAt?: string | null;
  authStrategy?: string;
}

export interface QRResponse {
  qr: string | null;
  available: boolean;
}

export interface PaginatedLeads {
  leads: Lead[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface Settings {
  openrouter: { model: string; hasApiKey: boolean };
  googleSheets: { spreadsheetId: string | null; hasCredentials: boolean };
  whatsapp: { sessionPath: string | null };
  worker: { cronSchedule: string; maxRetries: number; retryDelayMs: number };
}

export interface LogEntry {
  id: string;
  type: "error" | "warning" | "info";
  message: string;
  phone: string;
  status: string;
  retryCount: number;
  timestamp: string;
}
