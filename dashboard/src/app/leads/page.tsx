"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  User,
  Phone,
  Mail,
  BriefcaseBusiness,
  MessageSquare,
  FileText,
  AlertTriangle,
  Inbox,
} from "lucide-react";
import { useLeads, useLead } from "@/hooks/use-leads";
import type { Lead, ExtractedData, Message } from "@/lib/types";
import { AnimatedCard } from "@/components/shared/animated-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { SalespersonSelect } from "@/components/shared/salesperson-select";
import { LoadingSkeleton } from "@/components/shared/loading-skeleton";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn, formatDate, formatPhone, formatRelativeTime } from "@/lib/utils";

const LEAD_STATUSES = [
  "All",
  "NEW",
  "AI_PENDING",
  "SYNC_PENDING",
  "QUALIFIED",
  "CONTACTED",
  "CONVERTED",
  "LOST",
] as const;

type SortField = "name" | "status" | "createdAt";

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function SortButton({
  field,
  activeSort,
  activeOrder,
  onSort,
}: {
  field: SortField;
  activeSort: string;
  activeOrder: string;
  onSort: (f: SortField) => void;
}) {
  const isActive = activeSort === field;
  return (
    <button
      onClick={() => onSort(field)}
      className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
    >
      {isActive ? (
        activeOrder === "asc" ? (
          <ArrowUp size={14} />
        ) : (
          <ArrowDown size={14} />
        )
      ) : (
        <ArrowUpDown size={14} />
      )}
    </button>
  );
}

function StatusFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex h-9 items-center gap-2 rounded-md border border-border bg-transparent px-3 text-sm text-foreground transition-colors hover:bg-accent"
        )}
      >
        {value === "All" ? "All Statuses" : value}
        <ChevronDown
          size={14}
          className={cn(
            "transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 z-30 mt-1 w-48 overflow-hidden rounded-lg border border-border bg-card shadow-xl"
          >
            {LEAD_STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => {
                  onChange(s);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
                  s === value
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground"
                )}
              >
                {s === "All" ? "All Statuses" : s}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="border-b border-border/50">
          {Array.from({ length: 7 }).map((_, j) => (
            <td key={j} className="px-4 py-3">
              <LoadingSkeleton className="h-4 rounded" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function EmptyState() {
  return (
    <tr>
      <td colSpan={7} className="px-4 py-16 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-full bg-accent/50 p-4">
            <Inbox className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">No leads found</p>
          <p className="text-xs text-muted-foreground">
            Try adjusting your search or filter criteria
          </p>
        </div>
      </td>
    </tr>
  );
}

function LeadRow({
  lead,
  onClick,
}: {
  lead: Lead;
  onClick: () => void;
}) {
  const data = lead.parsedExtractedData;
  return (
    <motion.tr
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClick}
      className="group cursor-pointer border-b border-border/50 transition-colors hover:bg-accent/50"
    >
      <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-foreground">
        {data?.name || lead.name || (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-sm text-muted-foreground">
        {formatPhone(data?.phone || lead.phoneNumber)}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-sm text-muted-foreground">
        {data?.requirements || <span className="text-muted-foreground">Pending clarification</span>}
      </td>
      <td className="px-4 py-3">
        <SalespersonSelect lead={lead} />
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <StatusBadge status={lead.status} />
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-sm text-muted-foreground">
        <span className="hidden sm:inline">{formatDate(lead.createdAt)}</span>
        <span className="sm:hidden">{formatRelativeTime(lead.createdAt)}</span>
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          className="opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
        >
          View
        </Button>
      </td>
    </motion.tr>
  );
}

function ExtractedDataPanel({ data }: { data: ExtractedData | null }) {
  if (!data) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <FileText className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          No extracted data available
        </p>
      </div>
    );
  }

  const fields: { key: keyof ExtractedData; label: string; icon: React.ElementType }[] = [
    { key: "name", label: "Name", icon: User },
    { key: "phone", label: "Phone No", icon: Phone },
    { key: "email", label: "Email", icon: Mail },
    { key: "requirements", label: "Requirements", icon: BriefcaseBusiness },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map(({ key, label, icon: Icon }) => (
          <div
            key={key}
            className="flex items-start gap-3 rounded-lg border border-border/50 bg-accent/30 px-3 py-2.5"
          >
            <Icon size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="truncate text-sm font-medium text-foreground">
                {data[key] || "—"}
              </p>
            </div>
          </div>
        ))}
      </div>
      {data.requirementDetails && (
        <div className="rounded-lg border border-border/50 bg-accent/30 px-4 py-3">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Requested service</p>
          <p className="whitespace-pre-wrap text-sm text-foreground">{data.requirementDetails}</p>
        </div>
      )}
      {data.notes && (
        <div className="rounded-lg border border-warning/20 bg-warning/5 px-4 py-3">
          <div className="mb-1 flex items-center gap-2">
            <FileText size={14} className="text-warning" />
            <span className="text-xs font-medium text-warning">Notes</span>
          </div>
          <p className="text-sm text-foreground whitespace-pre-wrap">{data.notes}</p>
        </div>
      )}
    </div>
  );
}

function ConversationPanel({ messages }: { messages: Message[] }) {
  if (!messages.length) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <MessageSquare className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          No messages in this conversation
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {messages.map((msg) => {
        const isInbound = msg.direction === "INBOUND";
        return (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className={cn("flex", isInbound ? "justify-start" : "justify-end")}
          >
            <div
              className={cn(
                "max-w-[80%] rounded-xl px-4 py-2.5",
                isInbound
                  ? "rounded-bl-sm bg-accent text-foreground"
                  : "rounded-br-sm bg-primary/90 text-primary-foreground"
              )}
            >
              <p className="text-xs font-medium opacity-70">
                {msg.sender || (isInbound ? "User" : "Bot")}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed">
                {msg.content}
              </p>
              <p
                className={cn(
                  "mt-1 text-[10px]",
                  isInbound
                    ? "text-muted-foreground"
                    : "text-primary-foreground/60"
                )}
              >
                {formatRelativeTime(msg.timestamp || msg.createdAt)}
              </p>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

function LeadDrawer({
  leadId,
  open,
  onClose,
}: {
  leadId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const { data: lead, isLoading } = useLead(leadId);
  const [activeTab, setActiveTab] = useState<"data" | "conversation">("data");

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={lead?.name || lead?.parsedExtractedData?.name || "Lead Detail"}
      width="max-w-lg"
    >
      {isLoading ? (
        <div className="space-y-4">
          <LoadingSkeleton className="h-20" />
          <div className="flex gap-2">
            <LoadingSkeleton className="h-8 w-32 rounded-md" />
            <LoadingSkeleton className="h-8 w-32 rounded-md" />
          </div>
          <LoadingSkeleton className="h-48" />
        </div>
      ) : !lead ? (
        <div className="flex flex-col items-center gap-3 py-12">
          <AlertTriangle className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Lead not found</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">
              {(lead.parsedExtractedData?.name || lead.name || "?")
                .charAt(0)
                .toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-base font-semibold text-foreground">
                  {lead.parsedExtractedData?.name || lead.name || "Unknown"}
                </h3>
                <StatusBadge status={lead.status} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Phone size={12} />
                  {formatPhone(lead.phoneNumber)}
                </span>
                {(lead.parsedExtractedData?.email || lead.email) && (
                  <span className="flex items-center gap-1">
                    <Mail size={12} />
                    {lead.parsedExtractedData?.email || lead.email}
                  </span>
                )}
                {lead.source && (
                  <span className="flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs">
                    {lead.source}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-2 rounded-lg border border-border/50 bg-accent/20 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Assigned salesperson</p>
            <SalespersonSelect lead={lead} />
          </div>

          <div className="flex gap-1 rounded-lg bg-accent/50 p-1">
            {(
              [
                { key: "data" as const, label: "Extracted Data" },
                { key: "conversation" as const, label: "Conversation" },
              ] as const
            ).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  activeTab === key
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, x: activeTab === "data" ? -8 : 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: activeTab === "data" ? 8 : -8 }}
              transition={{ duration: 0.15 }}
            >
              {activeTab === "data" ? (
                <ExtractedDataPanel data={lead.parsedExtractedData} />
              ) : (
                <ConversationPanel
                  messages={lead.conversation?.messages ?? []}
                />
              )}
            </motion.div>
          </AnimatePresence>

          <div className="space-y-2 rounded-lg border border-border/50 bg-accent/20 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Metadata
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-muted-foreground">Source: </span>
                <span className="font-medium text-foreground">
                  {lead.source || "—"}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Retries: </span>
                <span className="font-medium text-foreground">
                  {lead.retryCount}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Created: </span>
                <span className="font-medium text-foreground">
                  {formatDate(lead.createdAt)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Updated: </span>
                <span className="font-medium text-foreground">
                  {formatDate(lead.updatedAt)}
                </span>
              </div>
            </div>
            {lead.lastError && (
              <div className="mt-2 flex items-start gap-2 rounded-md border border-error/20 bg-error/5 px-3 py-2">
                <AlertTriangle
                  size={14}
                  className="mt-0.5 shrink-0 text-error"
                />
                <div>
                  <p className="text-xs font-medium text-error">Last Error</p>
                  <p className="mt-0.5 text-xs text-muted-foreground break-all">
                    {lead.lastError}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}

function LeadsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const [searchInput, setSearchInput] = useState(
    searchParams.get("search") || ""
  );
  const debouncedSearch = useDebounce(searchInput, 300);

  const page = Number(searchParams.get("page")) || 1;
  const limit = Number(searchParams.get("limit")) || 20;
  const search = searchParams.get("search") || "";
  const status = searchParams.get("status") || "All";
  const sort = searchParams.get("sort") || "createdAt";
  const order = searchParams.get("order") || "desc";

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([k, v]) => {
        if (v) {
          params.set(k, v);
        } else {
          params.delete(k);
        }
      });
      if (updates.search !== undefined || updates.status !== undefined) {
        params.set("page", "1");
      }
      router.push(`/leads?${params.toString()}`);
    },
    [router, searchParams]
  );

  useEffect(() => {
    if (debouncedSearch !== search) {
      updateParams({ search: debouncedSearch });
    }
  }, [debouncedSearch, search, updateParams]);

  const { data, isLoading, isError, error } = useLeads({
    page,
    limit,
    search: search || undefined,
    status: status !== "All" ? status : undefined,
    sort,
    order,
  });

  useEffect(() => {
    if (isError) {
      toast(
        error instanceof Error ? error.message : "Failed to load leads",
        "error"
      );
    }
  }, [isError, error, toast]);

  const handleSort = useCallback(
    (field: SortField) => {
      const newOrder =
        sort === field && order === "asc" ? "desc" : "asc";
      updateParams({ sort: field, order: newOrder });
    },
    [sort, order, updateParams]
  );

  const handleStatusFilter = useCallback(
    (value: string) => {
      updateParams({ status: value === "All" ? "" : value });
    },
    [updateParams]
  );

  const openLead = useCallback((id: string) => {
    setSelectedLeadId(id);
    setDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    setTimeout(() => setSelectedLeadId(null), 300);
  }, []);

  const leads = data?.leads ?? [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            Leads
            {pagination && (
              <span className="ml-2 text-lg font-normal text-muted-foreground">
                ({pagination.total})
              </span>
            )}
          </h2>
          <p className="text-sm text-muted-foreground">
            Manage Nexyrium tech, pitch deck, and design enquiries
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Search clients or requirements..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <AnimatedCard delay={0.05} className="p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <StatusFilter value={status} onChange={handleStatusFilter} />
          {status !== "All" && (
            <button
              onClick={() => handleStatusFilter("All")}
              className="flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5">
                    Name
                    <SortButton
                      field="name"
                      activeSort={sort}
                      activeOrder={order}
                      onSort={handleSort}
                    />
                  </span>
                </th>
                <th className="px-4 py-3">Phone No</th>
                <th className="px-4 py-3">Requirements</th>
                <th className="px-4 py-3">Salesperson</th>
                <th className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5">
                    Status
                    <SortButton
                      field="status"
                      activeSort={sort}
                      activeOrder={order}
                      onSort={handleSort}
                    />
                  </span>
                </th>
                <th className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5">
                    Date
                    <SortButton
                      field="createdAt"
                      activeSort={sort}
                      activeOrder={order}
                      onSort={handleSort}
                    />
                  </span>
                </th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeleton />
              ) : leads.length === 0 ? (
                <EmptyState />
              ) : (
                <AnimatePresence>
                  {leads.map((lead) => (
                    <LeadRow
                      key={lead.id}
                      lead={lead}
                      onClick={() => openLead(lead.id)}
                    />
                  ))}
                </AnimatePresence>
              )}
            </tbody>
          </table>
        </div>

        {pagination && pagination.totalPages > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
            <p className="text-xs text-muted-foreground">
              Showing {Math.min((page - 1) * limit + 1, pagination.total)}–
              {Math.min(page * limit, pagination.total)} of {pagination.total}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => updateParams({ page: String(page - 1) })}
              >
                <ChevronLeft size={14} />
                Previous
              </Button>
              <span className="px-2 text-sm text-muted-foreground">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pagination.totalPages}
                onClick={() => updateParams({ page: String(page + 1) })}
              >
                Next
                <ChevronRight size={14} />
              </Button>
            </div>
          </div>
        )}
      </AnimatedCard>

      <LeadDrawer
        key={selectedLeadId ?? "none"}
        leadId={selectedLeadId}
        open={drawerOpen}
        onClose={closeDrawer}
      />
    </div>
  );
}

export default function LeadsPage() {
  return (
    <Suspense fallback={<LoadingSkeleton className="h-96" />}>
      <LeadsPageContent />
    </Suspense>
  );
}
