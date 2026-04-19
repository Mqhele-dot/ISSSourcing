import { useCallback, useEffect, useMemo, useState } from "react";
import { parseApIntakeForSubmit } from "./validation";

export type ApIntakeFormFields = {
  supplierId: string;
  source: string;
  invoiceNumber: string;
  totalAmountRaw: string;
  confidenceRaw: string;
  notes: string;
};

/**
 * Client-side AP intake validation state: errors after submit attempt, and derived canSubmit / disabledReasons.
 */
export function useApIntakeFormState(fields: ApIntakeFormFields) {
  const [intakeErrors, setIntakeErrors] = useState<string[]>([]);

  useEffect(() => {
    setIntakeErrors([]);
  }, [
    fields.supplierId,
    fields.source,
    fields.invoiceNumber,
    fields.totalAmountRaw,
    fields.confidenceRaw,
    fields.notes,
  ]);

  const preview = useMemo(
    () =>
      parseApIntakeForSubmit({
        supplierId: fields.supplierId,
        totalAmountRaw: fields.totalAmountRaw,
        confidenceRaw: fields.confidenceRaw,
      }),
    [fields.supplierId, fields.totalAmountRaw, fields.confidenceRaw],
  );

  const canSubmit = preview.ok;
  const disabledReasons = preview.ok ? [] : preview.errors;

  const validateForSubmit = useCallback((): boolean => {
    const r = parseApIntakeForSubmit({
      supplierId: fields.supplierId,
      totalAmountRaw: fields.totalAmountRaw,
      confidenceRaw: fields.confidenceRaw,
    });
    if (!r.ok) {
      setIntakeErrors(r.errors);
      return false;
    }
    setIntakeErrors([]);
    return true;
  }, [fields.supplierId, fields.totalAmountRaw, fields.confidenceRaw]);

  return { intakeErrors, setIntakeErrors, validateForSubmit, canSubmit, disabledReasons };
}
