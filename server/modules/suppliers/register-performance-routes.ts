import type { Express } from "express";
import { z } from "zod";
import { pool } from "../../db";
import { getTenantContext } from "../../organization-context";
import { sendError, sendOk, resolveRequestId } from "../../api-response";
import { recordServerDiagnosticEvent } from "../../diagnostics/server-diagnostics-store";
import { supplierPerformanceEvidence, supplierPerformanceReadResources } from "../../../shared/supplier-performance-evidence";
import type { AuthBundle } from "../procurement/types";
import { hasCompanySupplierObservationScope } from "./observation-access";

const querySchema = z.object({ ids: z.string().max(1100).regex(/^\d+(,\d+)*$/)
  .transform(value => value.split(",").map(Number))
  .pipe(z.array(z.number().int().positive().max(2147483647)).min(1).max(100)) }).strict();

/** Compatibility URLs share one bounded query. This legacy proxy is not contract-price compliance. */
export function registerSupplierPerformanceRoutes(app: Express, auth: AuthBundle) {
  app.get(["/api/suppliers/performance", "/api/v2/suppliers/performance"], auth.ensureAuthenticated,
    ...supplierPerformanceReadResources.map(resource => auth.ensurePermission(resource, "read")), async (req, res) => {
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) return sendError(res, 400, "INVALID_SUPPLIER_IDS", "Choose between 1 and 100 comma-separated supplier IDs. Unsupported filters cannot be used.",
        { hint: "Request the current supplier page's IDs. The legacy unbounded company scan is no longer supported." });
      const actor = getTenantContext();
      let client;
      try {
        client = await pool.connect();
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        await client.query("SET LOCAL statement_timeout='5s'");
        if (!await hasCompanySupplierObservationScope(client, actor)) {
          await client.query("ROLLBACK");
          return sendError(res, 403, "SUPPLIER_PERFORMANCE_SCOPE_DENIED", "An active membership with organization-wide warehouse access is required for the combined supplier rating.");
        }
        const result = await client.query(`WITH selected AS MATERIALIZED (
          SELECT id,name FROM suppliers WHERE organization_id=$1 AND id=ANY($2::int[])
        ), receipts AS (
          SELECT po.id,po.supplier_id,po.expected_delivery_date,
            min(coalesce(m.received_at,m.timestamp)) AS first_receipt
          FROM purchase_orders po JOIN selected s ON s.id=po.supplier_id
          JOIN stock_movements m ON m.organization_id=po.organization_id
            AND m.reference_type='purchase_order' AND m.reference_id=po.id AND m.type='RECEIPT'
          WHERE po.organization_id=$1 AND po.expected_delivery_date IS NOT NULL
          GROUP BY po.id,po.supplier_id,po.expected_delivery_date
        ), delivery AS (
          SELECT supplier_id,count(*)::int AS measured,
            count(*) FILTER (WHERE first_receipt<=expected_delivery_date)::int AS on_time
          FROM receipts GROUP BY supplier_id
        ), billing AS (
          SELECT i.supplier_id,count(*)::int AS measured,
            count(*) FILTER (WHERE upper(i.status::text)='DISPUTED')::int AS disputed
          FROM invoices i JOIN selected s ON s.id=i.supplier_id
          WHERE i.organization_id=$1 GROUP BY i.supplier_id
        ) SELECT s.id,s.name,coalesce(d.measured,0) AS orders,coalesce(d.on_time,0) AS on_time,
          coalesce(b.measured,0) AS invoices,coalesce(b.disputed,0) AS disputed
          FROM selected s LEFT JOIN delivery d ON d.supplier_id=s.id
          LEFT JOIN billing b ON b.supplier_id=s.id ORDER BY s.id`, [actor.organizationId, parsed.data.ids]);
        await client.query("COMMIT");
        const rows = result.rows.map(row => ({ supplierId: row.id, supplierName: row.name,
          ...supplierPerformanceEvidence(Number(row.orders), Number(row.on_time), Number(row.invoices), Number(row.disputed)) }));
        res.setHeader("Cache-Control", "private, no-store");
        if (req.path.startsWith("/api/v2/")) return sendOk(res, rows);
        res.setHeader("Deprecation", "true");
        res.setHeader("Link", `</api/v2/suppliers/performance?ids=${parsed.data.ids.join(",")}>; rel="successor-version"`);
        return res.json(rows);
      } catch {
        if (client) await client.query("ROLLBACK").catch(() => undefined);
        recordServerDiagnosticEvent({ severity: "error", source: "request", title: "Supplier rating unavailable",
          message: "Supplier rating sources could not be read. Retry and review correlated dependencies.",
          route: "/api/v2/suppliers/performance", method: "GET", status: 503,
          details: { organizationId: actor.organizationId, requestId: resolveRequestId(res) } });
        return sendError(res, 503, "SUPPLIER_PERFORMANCE_UNAVAILABLE", "Supplier ratings could not be loaded. Retry; if the problem continues, contact your administrator with the request ID.");
      } finally { client?.release(); }
    });
}
