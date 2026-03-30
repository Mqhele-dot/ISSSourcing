import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PurchaseRequisition, User } from "@shared/schema";
import type { UseMutationResult } from "@tanstack/react-query";
import { formatRequisitionDate } from "@/pages/requisitions/requisitions-helpers";

export type ApprovalHistoryEntry = {
  id: number;
  action: string;
  level: number;
  performedBy: number;
  comment: string | null;
  previousStatus: string | null;
  newStatus: string | null;
  performedAt: string;
};

type ApproverHints = {
  suggestedApprovers: Array<{
    userId: number;
    fullName?: string | null;
    username?: string | null;
    email?: string | null;
    approvalLevel: number;
    matchedPolicyName: string;
    role?: string | null;
  }>;
};

type RequisitionsDialogsProps = {
  shareOpen: boolean;
  setShareOpen: (v: boolean) => void;
  selectedReq: PurchaseRequisition | null;
  users: User[];
  shareUserIds: number[];
  setShareUserIds: (ids: number[] | ((prev: number[]) => number[])) => void;
  shareMutation: UseMutationResult<unknown, Error, { id: number; userIds: number[] }, unknown>;

  rejectDialogReq: PurchaseRequisition | null;
  setRejectDialogReq: (r: PurchaseRequisition | null) => void;
  rejectReason: string;
  setRejectReason: (s: string) => void;
  rejectMutation: UseMutationResult<unknown, Error, { id: number; reason: string }, unknown>;

  approverHelpAmount: number | null;
  setApproverHelpAmount: (n: number | null) => void;
  reqApproverHints: ApproverHints | undefined;
  approverHintsLoading: boolean;

  historyDialogReq: PurchaseRequisition | null;
  setHistoryDialogReq: (r: PurchaseRequisition | null) => void;
  approvalHistory: ApprovalHistoryEntry[];
  historyLoading: boolean;
};

export function RequisitionsDialogs(p: RequisitionsDialogsProps) {
  return (
    <>
      <Dialog open={p.shareOpen} onOpenChange={p.setShareOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share Requisition</DialogTitle>
            <DialogDescription>
              Share {p.selectedReq?.requisitionNumber} with team members. Selected users will have access to view this
              requisition.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Share with users</Label>
              <Select
                value=""
                onValueChange={(v) => {
                  const id = Number(v);
                  if (id && !p.shareUserIds.includes(id)) {
                    p.setShareUserIds([...p.shareUserIds, id]);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select user to add..." />
                </SelectTrigger>
                <SelectContent>
                  {p.users
                    .filter((u) => !p.shareUserIds.includes(u.id))
                    .map((u) => (
                      <SelectItem key={u.id} value={String(u.id)}>
                        {u.fullName || u.username}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {p.shareUserIds.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {p.shareUserIds.map((uid) => {
                    const u = p.users.find((x) => x.id === uid);
                    return (
                      <Badge
                        key={uid}
                        variant="secondary"
                        className="cursor-pointer"
                        onClick={() => p.setShareUserIds(p.shareUserIds.filter((id) => id !== uid))}
                      >
                        {(u?.fullName || u?.username || "User #" + uid) + " ×"}
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => p.setShareOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!p.selectedReq) return;
                p.shareMutation.mutate({ id: p.selectedReq.id, userIds: p.shareUserIds });
              }}
              disabled={p.shareMutation.isPending || p.shareUserIds.length === 0}
            >
              {p.shareMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Share
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={p.rejectDialogReq !== null}
        onOpenChange={(open) => {
          if (!open) {
            p.setRejectDialogReq(null);
            p.setRejectReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject requisition</DialogTitle>
            <DialogDescription>
              {p.rejectDialogReq
                ? "Reject " + p.rejectDialogReq.requisitionNumber + "? You can optionally provide a reason."
                : "Provide an optional reason for rejection."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="reject-reason">Reason (optional)</Label>
              <Input
                id="reject-reason"
                value={p.rejectReason}
                onChange={(e) => p.setRejectReason(e.target.value)}
                placeholder="e.g. Budget hold"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                p.setRejectDialogReq(null);
                p.setRejectReason("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (p.rejectDialogReq) {
                  p.rejectMutation.mutate(
                    { id: p.rejectDialogReq.id, reason: p.rejectReason },
                    { onSettled: () => { p.setRejectDialogReq(null); p.setRejectReason(""); } },
                  );
                }
              }}
              disabled={p.rejectMutation.isPending}
            >
              {p.rejectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={p.approverHelpAmount !== null}
        onOpenChange={(open) => {
          if (!open) p.setApproverHelpAmount(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suggested approvers</DialogTitle>
            <DialogDescription>
              From active requisition approval policies for total amount ${p.approverHelpAmount?.toFixed(2) ?? "0.00"}.
              Approval still runs as the signed-in user; policies may require a specific role or user.
            </DialogDescription>
          </DialogHeader>
          {p.approverHintsLoading ? (
            <div className="text-sm text-muted-foreground">Loading suggestions…</div>
          ) : (p.reqApproverHints?.suggestedApprovers?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">
              No users matched configured policies for this amount. Check Approval policies or use an admin account.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {p.reqApproverHints!.suggestedApprovers.map((a) => (
                <li key={a.userId} className="rounded border p-2">
                  <div className="font-medium">{a.fullName || a.username}</div>
                  <div className="text-muted-foreground text-xs">{a.email}</div>
                  <div className="text-xs mt-1">
                    Level {a.approvalLevel} · {a.matchedPolicyName}
                    {a.role ? ` · role ${a.role}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => p.setApproverHelpAmount(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={p.historyDialogReq !== null}
        onOpenChange={(open) => {
          if (!open) p.setHistoryDialogReq(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approval history</DialogTitle>
            <DialogDescription>
              {p.historyDialogReq ? `History for ${p.historyDialogReq.requisitionNumber}` : "Approval history"}
            </DialogDescription>
          </DialogHeader>
          {p.historyLoading ? (
            <div className="text-sm text-muted-foreground">Loading history...</div>
          ) : p.approvalHistory.length === 0 ? (
            <div className="text-sm text-muted-foreground">No approval history found for this requisition.</div>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {p.approvalHistory.map((entry) => (
                <div key={entry.id} className="rounded border p-2 text-sm">
                  <div className="font-medium">
                    {entry.action.toUpperCase()} (Level {entry.level})
                  </div>
                  <div className="text-muted-foreground">
                    By user #{entry.performedBy} on {formatRequisitionDate(entry.performedAt)}
                  </div>
                  <div className="text-muted-foreground">
                    {entry.previousStatus ?? "-"} {"->"} {entry.newStatus ?? "-"}
                  </div>
                  {entry.comment ? <div className="mt-1">{entry.comment}</div> : null}
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => p.setHistoryDialogReq(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
