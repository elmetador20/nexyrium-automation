"use client";

import type { Lead } from "@/lib/types";
import { useAssignLead, useSalespeople } from "@/hooks/use-leads";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";

export function SalespersonSelect({ lead }: { lead: Lead }) {
  const roster = useSalespeople();
  const assignment = useAssignLead(lead.id);
  const { toast } = useToast();
  const salespeople = roster.data?.salespeople ?? [];
  const current = lead.assignedSalesperson ?? "";
  const value = assignment.isPending ? assignment.variables : current;
  const currentIsListed = salespeople.includes(current);

  return (
    <div className="min-w-40 space-y-1" onClick={(event) => event.stopPropagation()}>
      <select
        aria-label={`Assigned salesperson for ${lead.name || lead.phoneNumber}`}
        value={value}
        disabled={assignment.isPending || roster.isLoading || !salespeople.length}
        onChange={(event) => {
          assignment.mutate(event.target.value, {
            onSuccess: (result) => toast(
              result.synced
                ? `Lead assigned to ${result.lead.assignedSalesperson}.`
                : "Assignment saved. Spreadsheet sync is pending and will retry automatically.",
              result.synced ? "success" : "info"
            ),
            onError: (error) => toast(error.message, "error"),
          });
        }}
        className="h-9 w-full rounded-md border border-border bg-card px-2 text-sm text-foreground disabled:opacity-60"
      >
        <option value="" disabled>{roster.isLoading ? "Loading salespeople..." : "Unassigned"}</option>
        {current && !currentIsListed && <option value={current} disabled>{current} (current)</option>}
        {salespeople.map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
      {assignment.isPending && <p className="text-xs text-muted-foreground">Saving assignment...</p>}
      {lead.assignmentSyncPending && <p className="text-xs text-warning" title={lead.assignmentError || undefined}>Sheet sync pending</p>}
      {roster.isError && (
        <Button variant="ghost" size="sm" onClick={() => void roster.refetch()}>
          Retry loading salespeople
        </Button>
      )}
      {!roster.isLoading && !roster.isError && !salespeople.length && (
        <p className="text-xs text-muted-foreground">Add names to the sheet dropdown.</p>
      )}
    </div>
  );
}
