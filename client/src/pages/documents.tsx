import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, FileText, RefreshCcw } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Can } from "@/components/auth/can";
import { PanelInlineError } from "@/components/panel-inline-error";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { apiRequest, requestJson } from "@/lib/queryClient";
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

type ArchiveFilter = "exclude" | "include" | "only";

const ENTITY_PRESETS = [
  { value: "__all__", label: "All types" },
  { value: "purchase_order", label: "Purchase order" },
  { value: "requisition", label: "Requisition" },
  { value: "invoice", label: "Invoice" },
  { value: "supplier", label: "Supplier" },
  { value: "warehouse", label: "Warehouse" },
  { value: "contract", label: "Contract" },
] as const;

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
  const [filterArchived, setFilterArchived] = useState<ArchiveFilter>("exclude");
  const [filterQuery, setFilterQuery] = useState("");

  const normalizedEntityId = filterEntityId.trim();
  const normalizedQuery = filterQuery.trim();

  const {
    data: documents = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["/api/documents", filterEntityType, normalizedEntityId, filterArchived, normalizedQuery],
    queryFn: () => {
      const search = new URLSearchParams();
      if (filterEntityType !== "__all__") search.set("entityType", filterEntityType);
      if (normalizedEntityId) search.set("entityId", normalizedEntityId);
      if (filterArchived !== "exclude") search.set("archived", filterArchived);
      if (normalizedQuery) search.set("q", normalizedQuery);
      search.set("limit", "100");
      return requestJson<DocumentRow[]>("GET", `/api/documents?${search.toString()}`);
    },
  });

  const documentStats = useMemo(() => {
    const archived = documents.filter((doc) => doc.archivedAt).length;
    return {
      total: documents.length,
      archived,
      active: documents.length - archived,
    };
  }, [documents]);

  const uploadReady =
    file != null &&
    Number.isFinite(Number(entityId)) &&
    Number(entityId) > 0 &&
    processingReference.trim().length > 0;

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Select a file first");
      const id = Number(entityId);
      if (!Number.isFinite(id) || id <= 0) throw new Error("Entity ID must be a positive number");
      const ref = processingReference.trim();
      if (!ref) throw new Error("Enter a processing reference before upload.");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("entityType", entityType);
      formData.append("entityId", String(id));
      return uploadDocumentFile(formData);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      setFile(null);
      setEntityId("");
      setUploadDialogOpen(false);
      setProcessingReference("");
      setProcessingNotes("");
      toast({ title: "Uploaded", description: "Document version was saved successfully." });
    },
    onError: (uploadError) => {
      toast({
        title: "Upload failed",
        description: uploadError instanceof Error ? uploadError.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const archiveDocument = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("DELETE", `/api/documents/${id}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({ message: "Failed to archive document" }));
        throw new Error(body.message || "Failed to archive document");
      }
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      toast({
        title: "Document archived",
        description: "The document remains available in archived history.",
      });
    },
    onError: (archiveError) => {
      toast({
        title: "Archive failed",
        description: archiveError instanceof Error ? archiveError.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const runRetention = useMutation({
    mutationFn: runRetentionJob,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      toast({
        title: "Retention run completed",
        description: `Archived ${result.archivedCount} document(s).`,
      });
    },
    onError: (retentionError) => {
      toast({
        title: "Retention run failed",
        description: retentionError instanceof Error ? retentionError.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const hasFilters =
    normalizedEntityId.length > 0
    || normalizedQuery.length > 0
    || filterEntityType !== "__all__"
    || filterArchived !== "exclude";

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Documents"
        subtitle="Controlled attachment history with versioning, filters, and archive review."
        actions={
          <Button variant="outline" onClick={() => void refetch()} className="gap-2">
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Visible documents</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{documentStats.total}</div>
            <p className="text-sm text-muted-foreground">Current result set after server-side filters.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Active history</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{documentStats.active}</div>
            <p className="text-sm text-muted-foreground">Unarchived records available to active workflows.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Archived history</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{documentStats.archived}</div>
            <p className="text-sm text-muted-foreground">Retained rows removed from live operational views.</p>
          </CardContent>
        </Card>
      </div>

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
                {ENTITY_PRESETS.filter((preset) => preset.value !== "__all__").map((preset) => (
                  <SelectItem key={preset.value} value={preset.value}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="doc-entity-id">Entity ID</Label>
            <Input
              id="doc-entity-id"
              value={entityId}
              inputMode="numeric"
              placeholder="e.g. 1024"
              onChange={(event) => setEntityId(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="doc-file">File</Label>
            <Input id="doc-file" type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </div>
          <div className="flex items-end gap-2">
            <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to upload documents">
              <Button type="button" onClick={() => setUploadDialogOpen(true)} disabled={upload.isPending || !file}>
                Upload...
              </Button>
            </Can>
            <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to run retention">
              <Button variant="outline" onClick={() => runRetention.mutate()} disabled={runRetention.isPending}>
                Run retention
              </Button>
            </Can>
          </div>
        </CardContent>
      </Card>

      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Process document</DialogTitle>
            <DialogDescription>
              Confirm the business reference before creating a new version. This blocks accidental uploads and keeps
              each file tied to a real business record.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <div>
                <span className="text-muted-foreground">Entity:</span>{" "}
                <span className="font-medium">
                  {ENTITY_PRESETS.find((preset) => preset.value === entityType)?.label ?? entityType}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">ID:</span>{" "}
                <span className="font-mono">{entityId.trim() || "-"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">File:</span>{" "}
                <span className="font-medium">{file?.name ?? "None selected"}</span>
              </div>
            </div>
            <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
              Uploads create a new version for this entity. Archive later when a document must stay retained but should
              no longer appear in active operational history.
            </div>
            <div className="space-y-1">
              <Label htmlFor="doc-processing-ref">
                Reference / tracking ID <span className="text-destructive">*</span>
              </Label>
              <Input
                id="doc-processing-ref"
                placeholder="e.g. PO-12345, contract amendment, ticket #"
                value={processingReference}
                onChange={(event) => setProcessingReference(event.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="doc-processing-notes">Handling notes (optional)</Label>
              <Textarea
                id="doc-processing-notes"
                placeholder="Who requested this, what changed, retention hint..."
                rows={3}
                value={processingNotes}
                onChange={(event) => setProcessingNotes(event.target.value)}
                className="resize-none"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setUploadDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => upload.mutate()} disabled={upload.isPending || !uploadReady}>
              {upload.isPending ? "Uploading..." : "Confirm upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card data-tour="documents-library">
        <CardHeader>
          <CardTitle>Document timeline</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isError ? (
            <PanelInlineError
              title="Document history unavailable"
              description={error instanceof Error ? error.message : "Could not load document history."}
              onRetry={() => void refetch()}
            />
          ) : null}
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1 min-w-[200px]">
              <Label>Filter by entity type</Label>
              <Select value={filterEntityType} onValueChange={setFilterEntityType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_PRESETS.map((preset) => (
                    <SelectItem key={preset.value} value={preset.value}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 w-40">
              <Label htmlFor="doc-filter-id">Entity ID</Label>
              <Input
                id="doc-filter-id"
                inputMode="numeric"
                placeholder="Any"
                value={filterEntityId}
                onChange={(event) => setFilterEntityId(event.target.value)}
              />
            </div>
            <div className="space-y-1 min-w-[200px]">
              <Label>Archive state</Label>
              <Select value={filterArchived} onValueChange={(value) => setFilterArchived(value as ArchiveFilter)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="exclude">Active only</SelectItem>
                  <SelectItem value="include">Active + archived</SelectItem>
                  <SelectItem value="only">Archived only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 min-w-[260px]">
              <Label htmlFor="doc-filter-q">Search</Label>
              <Input
                id="doc-filter-q"
                placeholder="File name or entity type"
                value={filterQuery}
                onChange={(event) => setFilterQuery(event.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Showing {documents.length} document(s). Results are ordered newest first and filtered on the server.
          </p>
          <div className="space-y-2">
            {isLoading ? <div className="text-sm text-muted-foreground">Loading document history...</div> : null}
            {!isLoading && documents.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                {hasFilters ? "No documents match the current filters." : "No documents uploaded yet."}
              </div>
            ) : null}
            {documents.map((doc) => (
              <div key={doc.id} className="rounded border p-3 text-sm flex items-center justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2 font-medium">
                    <span>
                      {doc.entityType} #{doc.entityId} - v{doc.version}
                    </span>
                    <Badge variant={doc.archivedAt ? "secondary" : "default"}>
                      {doc.archivedAt ? "Archived" : "Active"}
                    </Badge>
                    {doc.uploadedAt ? (
                      <span className="font-normal text-muted-foreground">
                        Uploaded {new Date(doc.uploadedAt).toLocaleString()}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
                    <FileText className="h-4 w-4" />
                    <span>{doc.fileName}</span>
                    {doc.archivedAt ? <span>Archived {new Date(doc.archivedAt).toLocaleString()}</span> : null}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button asChild size="sm" variant="outline">
                    <a href={doc.fileUrl} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  </Button>
                  {!doc.archivedAt ? (
                    <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to archive">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-2"
                        onClick={() => archiveDocument.mutate(doc.id)}
                        disabled={archiveDocument.isPending}
                      >
                        <Archive className="h-4 w-4" />
                        Archive
                      </Button>
                    </Can>
                  ) : null}
                </div>
              </div>
            ))}
            {!isLoading && documents.length >= 100 ? (
              <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                Showing the first 100 rows. Narrow the filters to review a specific document trail.
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
