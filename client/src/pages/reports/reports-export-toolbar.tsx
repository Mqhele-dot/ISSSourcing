import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DocumentType } from "@shared/schema";
import type { PdfTemplateVariant } from "./reports-types";

type Props = {
  exportFormat: DocumentType;
  onExportFormatChange: (v: DocumentType) => void;
  pdfTemplate: PdfTemplateVariant;
  onPdfTemplateChange: (v: PdfTemplateVariant) => void;
  customTemplateFile: File | null;
  uploadingTemplate: boolean;
  onTemplateFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  exporting: boolean;
  onExport: () => void;
};

export function ReportsExportToolbar({
  exportFormat,
  onExportFormatChange,
  pdfTemplate,
  onPdfTemplateChange,
  customTemplateFile,
  uploadingTemplate,
  onTemplateFileChange,
  exporting,
  onExport,
}: Props) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 shadow-sm" data-tour="reports-section">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-[11rem]">
          <span className="text-xs font-medium text-muted-foreground">Format</span>
          <Select value={exportFormat} onValueChange={(value) => onExportFormatChange(value as DocumentType)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select format" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pdf">PDF Report</SelectItem>
              <SelectItem value="docx">Word Document</SelectItem>
              <SelectItem value="csv">Raw CSV</SelectItem>
              <SelectItem value="excel">Excel Analysis</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {exportFormat === "pdf" ? (
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-[13rem]">
            <span className="text-xs font-medium text-muted-foreground">PDF layout</span>
            <Select value={pdfTemplate} onValueChange={(v) => onPdfTemplateChange(v as PdfTemplateVariant)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="PDF template" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">Standard (uniform)</SelectItem>
                <SelectItem value="compact">Compact</SelectItem>
                <SelectItem value="custom">Custom (uploaded)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <Button type="button" className="w-full shrink-0 sm:w-auto" onClick={onExport} disabled={exporting}>
          <FileDown className="mr-2 h-4 w-4" />
          {exporting ? "Exporting…" : "Export report"}
        </Button>
      </div>

      {exportFormat === "pdf" && pdfTemplate === "custom" ? (
        <div className="flex flex-col gap-1 border-t border-border pt-3">
          <label className="text-xs font-medium text-muted-foreground">
            Custom PDF cover/header (optional)
          </label>
          <input
            type="file"
            accept=".pdf,application/pdf"
            className="text-sm file:mr-2 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-primary-foreground"
            onChange={onTemplateFileChange}
            disabled={uploadingTemplate}
          />
          {customTemplateFile ? (
            <p className="text-xs text-muted-foreground">Using: {customTemplateFile.name}</p>
          ) : (
            <p className="text-xs text-amber-600 dark:text-amber-500">
              Upload a PDF to prepend as cover/header, or export uses the standard layout.
            </p>
          )}
        </div>
      ) : null}

      <p className="text-xs leading-snug text-muted-foreground">
        {exportFormat === "pdf"
          ? "PDFs use the InvTrack layout; custom files add pages before the data."
          : exportFormat === "docx"
            ? "Word export uses narrative layout with aligned tables."
            : exportFormat === "csv"
              ? "CSV is raw table data for spreadsheets."
              : "Excel workbook is optimized for filters and pivots."}
      </p>
    </div>
  );
}
