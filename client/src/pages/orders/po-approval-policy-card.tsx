import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type ApprovalPolicyRow = {
  id: number;
  name: string;
  approvalLevel: number;
  amountMin: number;
  amountMax: number | null;
  approverRole: string | null;
};

export type SuggestedApprover = {
  userId: number;
  fullName?: string | null;
  username?: string | null;
  email?: string | null;
  approvalLevel: number;
  matchedPolicyName: string;
};

type PoApprovalPolicyCardProps = {
  policies: ApprovalPolicyRow[];
  suggestedApprovers: SuggestedApprover[];
};

export function PoApprovalPolicyCard({ policies, suggestedApprovers }: PoApprovalPolicyCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>PO approval policy & suggested approvers</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {policies.length > 0 ? (
          <div>
            <p className="text-sm text-muted-foreground mb-2">
              Active purchase-order policies (amount bands). Your approve action is logged against your account.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Level</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Amount range</TableHead>
                  <TableHead>Approver role</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {policies.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.approvalLevel}</TableCell>
                    <TableCell>{p.name}</TableCell>
                    <TableCell>
                      {p.amountMin}
                      {p.amountMax != null ? ` – ${p.amountMax}` : "+"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.approverRole ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
        {suggestedApprovers.length > 0 ? (
          <div>
            <p className="text-sm font-medium">Suggested approvers for this PO total</p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {suggestedApprovers.map((a) => (
                <li key={a.userId}>
                  <span className="text-foreground font-medium">{a.fullName || a.username}</span> ({a.email}) — level{" "}
                  {a.approvalLevel} · {a.matchedPolicyName}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No specific users matched policies for this amount; managers/planners may still approve per RBAC.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
