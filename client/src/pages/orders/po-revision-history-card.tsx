import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type PoRevisionRow = {
  id: number;
  revisionNumber: number;
  createdBy: number | null;
  createdAt: string | null;
};

type PoRevisionHistoryCardProps = {
  revisions: PoRevisionRow[];
  formatDateTime: (value: string | null) => string;
};

export function PoRevisionHistoryCard({ revisions, formatDateTime }: PoRevisionHistoryCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Revision history</CardTitle>
      </CardHeader>
      <CardContent>
        {revisions.length === 0 ? (
          <div className="text-sm text-muted-foreground">No revisions found.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Revision</TableHead>
                <TableHead>Created by</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {revisions
                .slice()
                .sort((a, b) => b.revisionNumber - a.revisionNumber)
                .map((revision) => (
                  <TableRow key={revision.id}>
                    <TableCell>#{revision.revisionNumber}</TableCell>
                    <TableCell>{revision.createdBy ? `User #${revision.createdBy}` : "-"}</TableCell>
                    <TableCell>{formatDateTime(revision.createdAt)}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
