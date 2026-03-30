import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Supplier } from "@shared/schema";
import type { RequisitionFieldErrors } from "@/pages/requisitions/use-requisition-form";

type Dept = { id: number; code: string; name: string };

export function RequisitionHeaderFields({
  suppliers,
  departments,
  projects = [],
  supplierId,
  departmentId,
  projectId,
  requiredDate,
  justification,
  notes,
  fieldErrors,
  onSupplierChange,
  onDepartmentChange,
  onProjectChange,
  onRequiredDateChange,
  onJustificationChange,
  onNotesChange,
}: {
  suppliers: Supplier[];
  departments: Dept[];
  /** From `/api/extensions/projects` when extensions are enabled */
  projects?: { id: number; code: string; name: string }[];
  supplierId: number | "";
  departmentId: number | "";
  projectId: number | "";
  requiredDate: string;
  justification: string;
  notes: string;
  fieldErrors: RequisitionFieldErrors;
  onSupplierChange: (v: number | "") => void;
  onDepartmentChange: (v: number | "") => void;
  onProjectChange: (v: number | "") => void;
  onRequiredDateChange: (v: string) => void;
  onJustificationChange: (v: string) => void;
  onNotesChange: (v: string) => void;
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="req-supplier">Supplier *</Label>
          <Select value={String(supplierId)} onValueChange={(v) => onSupplierChange(v ? Number(v) : "")}>
            <SelectTrigger id="req-supplier" aria-label="Select supplier">
              <SelectValue placeholder="Select supplier..." />
            </SelectTrigger>
            <SelectContent>
              {suppliers.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fieldErrors.supplierId ? <p className="text-xs text-destructive">{fieldErrors.supplierId}</p> : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="req-department">Department</Label>
          <Select value={String(departmentId)} onValueChange={(v) => onDepartmentChange(v ? Number(v) : "")}>
            <SelectTrigger id="req-department" aria-label="Select department">
              <SelectValue placeholder="Select department..." />
            </SelectTrigger>
            <SelectContent>
              {departments.map((d) => (
                <SelectItem key={d.id} value={String(d.id)}>
                  {d.code} - {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fieldErrors.departmentId ? <p className="text-xs text-destructive">{fieldErrors.departmentId}</p> : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="req-required-date">Required date *</Label>
          <Input
            id="req-required-date"
            aria-label="Required date"
            type="date"
            value={requiredDate}
            onChange={(e) => onRequiredDateChange(e.target.value)}
          />
          {fieldErrors.requiredDate ? <p className="text-xs text-destructive">{fieldErrors.requiredDate}</p> : null}
        </div>
        {projects.length > 0 ? (
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="req-project">Project (optional)</Label>
            <Select
              value={projectId === "" ? "__none__" : String(projectId)}
              onValueChange={(v) => onProjectChange(v === "__none__" ? "" : Number(v))}
            >
              <SelectTrigger id="req-project" aria-label="Project">
                <SelectValue placeholder="No project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No project</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.code} — {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldErrors.projectId ? <p className="text-xs text-destructive">{fieldErrors.projectId}</p> : null}
          </div>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="req-justification">Justification</Label>
        <Textarea
          id="req-justification"
          aria-label="Requisition justification"
          value={justification}
          onChange={(e) => onJustificationChange(e.target.value)}
          rows={2}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="req-notes">Notes</Label>
        <Textarea id="req-notes" aria-label="Requisition notes" value={notes} onChange={(e) => onNotesChange(e.target.value)} rows={3} />
      </div>
    </>
  );
}
