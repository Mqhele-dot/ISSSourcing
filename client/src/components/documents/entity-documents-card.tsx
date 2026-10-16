import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { requestJson, queryClient } from "@/lib/queryClient";
import { uploadDocumentFile } from "@/api/client";
import { useToast } from "@/hooks/use-toast";

type DocumentRow = {
  id: number;
  fileName: string;
  fileUrl: string;
  version: number;
  uploadedAt?: string | null;
  archivedAt?: string | null;
};

export function EntityDocumentsCard({
  entityType,
  entityId,
  title = "Documents",
}: {
  entityType: string;
  entityId: number | null | undefined;
  title?: string;
}) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);

  const queryKey = ["/api/documents", entityType, entityId ?? 0];
  const { data: docs = [] } = useQuery({
    queryKey,
    enabled: Number(entityId) > 0,
    queryFn: () =>
      requestJson<DocumentRow[]>(
        "GET",
        `/api/documents?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(String(entityId))}`,
      ),
  });

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Select a file");
      if (!entityId || entityId <= 0) throw new Error("Entity must be saved first");
      const form = new FormData();
      form.append("file", file);
      form.append("entityType", entityType);
      form.append("entityId", String(entityId));
      return uploadDocumentFile(form);
    },
    onSuccess: async () => {
      setFile(null);
      await queryClient.invalidateQueries({ queryKey });
      toast({ title: "Document uploaded", description: "A new version has been attached." });
    },
    onError: (error) => {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor={`doc-file-${entityType}-${entityId ?? "new"}`}>Attach file</Label>
            <Input
              id={`doc-file-${entityType}-${entityId ?? "new"}`}
              type="file"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>
          <Button
            onClick={() => upload.mutate()}
            disabled={upload.isPending || !file || !(Number(entityId) > 0)}
          >
            Upload
          </Button>
        </div>
        <div className="space-y-2">
          {docs
            .filter((doc) => !doc.archivedAt)
            .slice()
            .sort((a, b) => b.version - a.version)
            .map((doc) => (
              <div key={doc.id} className="rounded border p-2 text-sm flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{doc.fileName}</div>
                  <div className="text-muted-foreground">Version {doc.version}</div>
                </div>
                <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="text-primary underline">
                  Open
                </a>
              </div>
            ))}
          {docs.filter((doc) => !doc.archivedAt).length === 0 ? (
            <div className="text-sm text-muted-foreground">No documents attached.</div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
