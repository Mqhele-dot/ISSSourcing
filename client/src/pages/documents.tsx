import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
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

  const { data: documents = [] } = useQuery({
    queryKey: ["/api/documents"],
    queryFn: () => requestJson<DocumentRow[]>("GET", "/api/documents"),
  });

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
      setFile(null);
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

      <Card>
        <CardHeader>
          <CardTitle>Upload document</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="doc-entity-type">Entity type</Label>
            <Input id="doc-entity-type" value={entityType} onChange={(e) => setEntityType(e.target.value)} />
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
            <Button onClick={() => upload.mutate()} disabled={upload.isPending}>
              Upload
            </Button>
            <Button variant="outline" onClick={() => runRetention.mutate()} disabled={runRetention.isPending}>
              Run retention
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Latest documents</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {documents.slice(0, 50).map((doc) => (
              <div key={doc.id} className="rounded border p-3 text-sm flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium">
                    {doc.entityType} #{doc.entityId} - v{doc.version}
                  </div>
                  <div className="text-muted-foreground">{doc.fileName}</div>
                </div>
                <a className="text-primary underline" href={doc.fileUrl} target="_blank" rel="noreferrer">
                  Open
                </a>
              </div>
            ))}
            {documents.length === 0 ? (
              <div className="text-sm text-muted-foreground">No documents uploaded yet.</div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
