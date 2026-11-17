import { useEffect,useMemo,useRef, useState } from "react";
import {useLocation,useSearch} from "wouter";
import {useQueryState} from "@/hooks/use-query-state";
import {parseDocumentView} from "@shared/document-query";
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
import { apiRequest, requestJson } from "@/lib/queryClient";
import { runRetentionJob, uploadDocumentFile } from "@/api/client";
import { useToast } from "@/hooks/use-toast";
import {useAuth} from "@/hooks/use-auth";
import {usePermissions} from "@/hooks/use-permissions";

type DocumentRow = {
  id: number;
  entityType: string;
  entityId: number;
  fileUrl: string;
  fileName: string;
  version: number;
  archivedAt?: string | null;
  uploadedAt?: string | null;
  fileAvailable?: boolean;
  fileStatus?: "available" | "missing" | "unverified";
  evidenceGuidance?:string|null;
  lifecycleStatus?: "active" | "archived";
  lastVerifiedAt?: string | null;
};
type DocumentPage = { items: DocumentRow[]; total: number; page: number; pageSize: number; hasNext: boolean; summary: { active: number; archived: number; missing: number } };

type ArchiveFilter = "exclude" | "include" | "only";
const VIEW_DEFAULTS={entityType:"",entityId:"",documentId:"",archived:"exclude",q:"",page:"1",pageSize:"25",fileStatus:"all",sort:"newest"};

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
  const {user}=useAuth(),{hasPermission}=usePermissions();
  const canRead=hasPermission("documents","read");
  const activeOrg=(user as typeof user&{activeOrganizationId?:number})?.activeOrganizationId;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [entityType, setEntityType] = useState("purchase_order");
  const [entityId, setEntityId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [archiveCandidate, setArchiveCandidate] = useState<DocumentRow | null>(null);
  const [retentionConfirmOpen, setRetentionConfirmOpen] = useState(false);
  const search=useSearch(),[,navigate]=useLocation();
  const {queryState:view,setQueryState:setView}=useQueryState(VIEW_DEFAULTS);
  const parsed=useMemo(()=>parseDocumentView(search),[search]);
  const filterEntityType=view.entityType||"__all__",filterEntityId=view.entityId,filterArchived=view.archived as ArchiveFilter,filterQuery=view.q;
  const page=parsed.success?parsed.data.page:1,pageSize=parsed.success?parsed.data.pageSize:25;
  const setPage=(value:number|((current:number)=>number))=>setView({page:String(typeof value==="function"?value(page):value)});
  const changeFilter=(updates:Partial<typeof VIEW_DEFAULTS>)=>setView({...updates,documentId:"",page:"1"});
  const focusIdentity=useRef("");
  useEffect(()=>{setFile(null);setEntityId("");setArchiveCandidate(null);setUploadDialogOpen(false);},[user?.id,activeOrg]);

  const normalizedEntityId = filterEntityId.trim();
  const normalizedQuery = filterQuery.trim();

  const {
    data: documentPage,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["/api/v2/documents",user?.id,activeOrg,user?.warehouseId,canRead,search],
    enabled:Boolean(user&&activeOrg&&canRead&&parsed.success),
    retry:false,
    queryFn: () => {
      if(!parsed.success)throw new Error("Document filters are invalid. Clear or correct them before loading evidence.");
      const params=new URLSearchParams();
      for(const [key,value]of Object.entries(parsed.data))if(value!==undefined)params.set(key,String(value));
      return requestJson<DocumentPage>("GET", `/api/v2/documents?${params}`);
    },
  });
  const documents = useMemo(() => canRead&&!isError&&parsed.success?documentPage?.items ?? []:[], [canRead,isError,parsed.success,documentPage?.items]);
  useEffect(()=>{
    const target=parsed.success?parsed.data.documentId:undefined;
    if(!target||!canRead||isError){focusIdentity.current="";return;}
    const identity=`${user?.id}:${activeOrg}:${search}`;
    if(focusIdentity.current===identity||!documents.some(row=>row.id===target))return;
    const row=document.getElementById(`document-row-${target}`);
    if(row){row.scrollIntoView({block:"center"});row.focus({preventScroll:true});focusIdentity.current=identity;}
  },[parsed,documents,canRead,isError,user?.id,activeOrg,search]);

  const documentStats = useMemo(() => {
    const archived = documentPage?.summary.archived ?? documents.filter((doc) => doc.archivedAt).length;
    return {
      total: documentPage?.total ?? documents.length,
      archived,
      active: documentPage?.summary.active ?? documents.length - archived,
    };
  }, [documentPage, documents]);

  const uploadReady =
    file != null &&
    Number.isFinite(Number(entityId)) &&
    Number(entityId) > 0;

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Select a file first");
      const id = Number(entityId);
      if (!Number.isFinite(id) || id <= 0) throw new Error("Entity ID must be a positive number");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("entityType", entityType);
      formData.append("entityId", String(id));
      return uploadDocumentFile(formData);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/v2/documents"] });
      setArchiveCandidate(null);
      setFile(null);
      setEntityId("");
      setUploadDialogOpen(false);
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
      await queryClient.invalidateQueries({ queryKey: ["/api/v2/documents"] });
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
      await queryClient.invalidateQueries({ queryKey: ["/api/v2/documents"] });
      setRetentionConfirmOpen(false);
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

  const reconcile = useMutation({
    mutationFn: () => requestJson<{ checked: number; missing: number;unverified:number }>("POST", "/api/documents/reconcile"),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/v2/documents"] });
      toast({ title: "Reconciliation complete", description: `${result.checked} authorized records checked; ${result.missing} missing, ${result.unverified} unverified. No history was changed.` });
    },
    onError: (reconcileError) => toast({ title: "Reconciliation failed", description: reconcileError instanceof Error ? reconcileError.message : String(reconcileError), variant: "destructive" }),
  });

  const reattach = async (doc: DocumentRow, replacement: File | null) => {
    if (!replacement) return;
    try {
      const formData = new FormData();
      formData.append("file", replacement);
      formData.append("entityType", doc.entityType);
      formData.append("entityId", String(doc.entityId));
      await uploadDocumentFile(formData);
      await queryClient.invalidateQueries({ queryKey: ["/api/v2/documents"] });
      toast({ title: "Replacement attached", description: `${replacement.name} was saved as a new version; the missing version remains in history.` });
    } catch (replacementError) {
      toast({ title: "Replacement failed", description: replacementError instanceof Error ? replacementError.message : String(replacementError), variant: "destructive" });
    }
  };

  const hasFilters =
    normalizedEntityId.length > 0
    || normalizedQuery.length > 0
    || filterEntityType !== "__all__"
    || filterArchived !== "exclude"||Boolean(view.documentId)||view.fileStatus!=="all"||view.sort!=="newest";

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Documents"
        subtitle="Controlled attachment history with versioning, filters, and archive review."
        actions={
          <div className="flex gap-2">
            <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to reconcile storage"><Button variant="outline" onClick={() => reconcile.mutate()} disabled={reconcile.isPending||!hasPermission("documents","verify")||!canRead}>Reconcile files</Button></Can>
            <Button variant="outline" onClick={() => void refetch()} className="gap-2"><RefreshCcw className="h-4 w-4" />Refresh</Button>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Visible documents</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{canRead&&!isError&&parsed.success?documentStats.total:"Unavailable"}</div>
            <p className="text-sm text-muted-foreground">Current result set after server-side filters.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Active history</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{canRead&&!isError&&parsed.success?documentStats.active:"Unavailable"}</div>
            <p className="text-sm text-muted-foreground">Unarchived records available to active workflows.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Archived history</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{canRead&&!isError&&parsed.success?documentStats.archived:"Unavailable"}</div>
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
              <Button variant="outline" onClick={() => setRetentionConfirmOpen(true)} disabled={runRetention.isPending}>
                Run retention
              </Button>
            </Can>
          </div>
        </CardContent>
      </Card>

      <Dialog open={retentionConfirmOpen} onOpenChange={setRetentionConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Run document retention?</DialogTitle>
            <DialogDescription>
              This archives only authorized source-linked documents in your current organization that are older than their configured retention period. Archived files remain in
              history, but active workflows will no longer include them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRetentionConfirmOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => runRetention.mutate()}
              disabled={runRetention.isPending}
            >
              Confirm retention run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={archiveCandidate !== null} onOpenChange={(open) => !open && setArchiveCandidate(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Archive document?</DialogTitle>
            <DialogDescription>
              {archiveCandidate
                ? `${archiveCandidate.fileName} (version ${archiveCandidate.version}) will be removed from active workflows and kept in archived history.`
                : "The document will be kept in archived history."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveCandidate(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={archiveDocument.isPending || archiveCandidate === null}
              onClick={() => archiveCandidate && archiveDocument.mutate(archiveCandidate.id)}
            >
              Archive document
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              The server verifies that this business record exists in your organization before creating a new version.
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
          {!canRead&&<p role="status">Document read access is required. Ask an authorized document steward to review this evidence.</p>}
          {!parsed.success&&<p role="alert">Document filters are invalid or unsupported. Correct them or clear all filters; no broader evidence was loaded.</p>}
          {view.documentId&&<div className="flex flex-wrap items-center gap-2"><p role="status">Selected document #{view.documentId}. Current source permissions still apply.</p><Button variant="outline" onClick={()=>setView({documentId:"",page:"1"})}>Show source history</Button></div>}
          {(hasFilters||!parsed.success)&&<Button variant="outline" onClick={()=>navigate("/admin/documents",{replace:true})}>Clear all document filters</Button>}
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
              <Select value={filterEntityType} onValueChange={(value) => changeFilter({entityType:value==="__all__"?"":value})}>
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
                onChange={(event) => changeFilter({entityId:event.target.value})}
              />
            </div>
            <div className="space-y-1 min-w-[200px]">
              <Label>Archive state</Label>
              <Select value={filterArchived} onValueChange={(value) => changeFilter({archived:value})}>
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
                maxLength={120}
                onChange={(event) => changeFilter({q:event.target.value})}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Showing {documents.length} of {documentPage?.total ?? 0} document(s). Results are ordered newest first and filtered on the server.
          </p>
          <div className="space-y-2">
            {isLoading ? <div className="text-sm text-muted-foreground">Loading document history...</div> : null}
            {canRead&&!isError&&!isLoading && documents.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                {!parsed.success?"Correct the invalid document filters to continue.":hasFilters ? "No documents match the current filters." : "No documents uploaded yet."}
              </div>
            ) : null}
            {documents.map((doc) => (
              <div key={doc.id} id={`document-row-${doc.id}`} tabIndex={-1} aria-label={`Document ${doc.fileName}, version ${doc.version}`} data-testid={`document-row-${doc.id}`} className="rounded border p-3 text-sm flex flex-wrap md:flex-nowrap items-center justify-between gap-4 focus:outline focus:outline-2 focus:outline-primary">
                <div className="min-w-0 flex-1">
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
                    <span className="break-all">{doc.fileName}</span>
                    {doc.fileStatus==="unverified"&&<p role="status" className="max-w-prose text-amber-700 dark:text-amber-300">{doc.evidenceGuidance}</p>}
                    {doc.archivedAt ? <span>Archived {new Date(doc.archivedAt).toLocaleString()}</span> : null}
                  </div>
                </div>
                <div className="flex w-full max-w-full flex-wrap items-center gap-2 md:w-auto">
                  {doc.fileAvailable ? (
                    <Button asChild size="sm" variant="outline">
                      <a href={`/api/documents/${doc.id}/download`}>Download</a>
                    </Button>
                  ) : (
                    <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to attach a replacement">
                      <label className="inline-flex min-h-9 max-w-full cursor-pointer items-center whitespace-normal rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                        File unavailable — reattach replacement
                        <input className="sr-only" type="file" aria-label={`Reattach replacement for ${doc.fileName}`} onChange={(event) => void reattach(doc, event.target.files?.[0] ?? null)} />
                      </label>
                    </Can>
                  )}
                  {!doc.archivedAt ? (
                    <Can roles={["manager", "admin"]} reason="Requires Manager or Admin to archive">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-2"
                        onClick={() => setArchiveCandidate(doc)}
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
            {!isLoading && (documentPage?.total ?? 0) > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-sm">
                <Select value={String(pageSize)} onValueChange={(value) => setView({pageSize:value,page:"1"})}><SelectTrigger className="w-32" aria-label="Documents per page"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="25">25 rows</SelectItem><SelectItem value="50">50 rows</SelectItem><SelectItem value="100">100 rows</SelectItem></SelectContent></Select>
                <div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(1)}>First</Button><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={!documentPage?.hasNext} onClick={() => setPage((value) => value + 1)}>Next</Button><Button size="sm" variant="outline" disabled={page >= Math.max(1, Math.ceil((documentPage?.total ?? 0) / pageSize))} onClick={() => setPage(Math.max(1, Math.ceil((documentPage?.total ?? 0) / pageSize)))}>Last</Button></div>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
