import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { requestJson } from "@/lib/queryClient";
import { runRetentionJob, uploadDocumentFile } from "@/api/client";
import { useToast } from "@/hooks/use-toast";

type DocumentRow = {
  id: number;
  entityType: string;
  entityId: number;
  fileUrl: string;
  fileName: string;
  version: number;
  archivedAt?: string | null;
  uploadedAt?: string | null;
};

export default function DocumentsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [entityType, setEntityType] = useState("purchase_order");
  const [entityId, setEntityId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [processingReference, setProcessingReference] = useState("");
  const [processingNotes, setProcessingNotes] = useState("");
  const [filterEntityType, setFilterEntityType] = useState<string>("__all__");
  const [filterEntityId, setFilterEntityId] = useState("");

  const { data: documents = [] } = useQuery({
    queryKey: ["/api/documents"],
    queryFn: () => requestJson<DocumentRow[]>("GET", "/api/documents"),
  });

  const filteredDocuments = useMemo(() => {
    const idFilter = filterEntityId.trim();
    const idNum = idFilter ? Number(idFilter) : NaN;
    return documents.filter((doc) => {
      if (filterEntityType !== "__all__" && doc.entityType !== filterEntityType) return false;
      if (idFilter && (Number.isNaN(idNum) || doc.entityId !== idNum)) return false;
      return true;
    });
  }, [documents, filterEntityType, filterEntityId]);

  const ENTITY_PRESETS = [
    { value: "__all__", label: "All types" },
    { value: "purchase_order", label: "Purchase order" },
    { value: "requisition", label: "Requisition" },
    { value: "invoice", label: "Invoice" },
    { value: "supplier", label: "Supplier" },
    { value: "warehouse", label: "Warehouse" },
  ] as const;

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Select a file first");
      const id = Number(entityId);
      if (!Number.isFinite(id) || id <= 0) throw new Error("Entity ID must be a positive number");
      const ref = processingReference.trim();
      if (!ref) throw new Error("Enter a processing reference (line 1) before upload.");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("entityType", entityType);
      formData.append("entityId", String(id));
      return uploadDocumentFile(formData);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      setFile(null);
      setUploadDialogOpen(false);
      setProcessingReference("");
      setProcessingNotes("");
      toast({ title: "Uploaded", description: "Document version was saved successfully." });
    },
    onError: (error) => {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const runRetention = useMutation({
    mutationFn: runRetentionJob,
    onSuccess: (result) => {
      toast({
        title: "Retention run completed",
        description: `Archived ${result.archivedCount} document(s).`,
      });
    },
    onError: (error) => {
      toast({
        title: "Retention run failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Documents" subtitle="Upload, version, and retain attachments across entities." />

      <Card data-tour="documents-upload">
        <CardHeader>
          <CardTitle>Upload document</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="doc-entity-type">Entity type</Label>
            <Select value={entityType} onValueChange={setEntityType}>
              <SelectTrigger id="doc-entity-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENTITY_PRESETS.filter((p) => p.value !== "__all__").map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="doc-entity-id">Entity ID</Label>
            <Input id="doc-entity-id" value={entityId} onChange={(e) => setEntityId(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="doc-file">File</Label>
            <Input id="doc-file" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="flex items-end gap-2">
            <Button type="button" onClick={() => setUploadDialogOpen(true)} disabled={upload.isPending}>
              Upload…
            </Button>
            <Button variant="outline" onClick={() => runRetention.mutate()} disabled={runRetention.isPending}>
              Run retention
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Process document</DialogTitle>
            <DialogDescription>
              Fill the checklist below so uploads are intentional and traceable. Reference and notes are kept in this
              session only (not stored on the server unless you add that field later).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <div>
                <span className="text-muted-foreground">Entity:</span>{" "}
                <span className="font-medium">{ENTITY_PRESETS.find((p) => p.value === entityType)?.label ?? entityType}</span>
              </div>
              <div>
                <span className="text-muted-foreground">ID:</span>{" "}
                <span className="font-mono">{entityId.trim() || "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">File:</span>{" "}
                <span className="font-medium">{file?.name ?? "None selected"}</span>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="doc-processing-ref">
                Line 1 — Reference / tracking ID <span className="text-destructive">*</span>
              </Label>
              <Input
                id="doc-processing-ref"
                placeholder="e.g. PO-12345, contract amendment, ticket #"
                value={processingReference}
                onChange={(e) => setProcessingReference(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="doc-processing-notes">Line 2 — Handling notes (optional)</Label>
              <Textarea
                id="doc-processing-notes"
                placeholder="Who requested this, what changed, retention hint…"
                rows={3}
                value={processingNotes}
                onChange={(e) => setProcessingNotes(e.target.value)}
                className="resize-none"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setUploadDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => upload.mutate()} disabled={upload.isPending}>
              {upload.isPending ? "Uploading…" : "Confirm upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card data-tour="documents-library">
        <CardHeader>
          <CardTitle>Document timeline</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1 min-w-[200px]">
              <Label>Filter by entity type</Label>
              <Select value={filterEntityType} onValueChange={setFilterEntityType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_PRESETS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 w-40">
              <Label htmlFor="doc-filter-id">Entity ID</Label>
              <Input
                id="doc-filter-id"
                placeholder="Any"
                value={filterEntityId}
                onChange={(e) => setFilterEntityId(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Showing {filteredDocuments.length} of {documents.length} document(s). Newest uploads appear first in the full list.
          </p>
          <div className="space-y-2">
            {filteredDocuments.slice(0, 50).map((doc) => (
              <div key={doc.id} className="rounded border p-3 text-sm flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium">
                    {doc.entityType} #{doc.entityId} — v{doc.version}
                    {doc.uploadedAt ? (
                      <span className="ml-2 font-normal text-muted-foreground">
                        · {new Date(doc.uploadedAt).toLocaleString()}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-muted-foreground">{doc.fileName}</div>
                </div>
                <a className="text-primary underline shrink-0" href={doc.fileUrl} target="_blank" rel="noreferrer">
                  Open
                </a>
              </div>
            ))}
            {documents.length === 0 ? (
              <div className="text-sm text-muted-foreground">No documents uploaded yet.</div>
            ) : filteredDocuments.length === 0 ? (
              <div className="text-sm text-muted-foreground">No documents match the current filters.</div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
