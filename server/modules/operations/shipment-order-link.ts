/** Shared by Logistics, dashboards, supplier guidance and exports.
 * Canonical ID wins. A legacy number may link only within the same explicit
 * tenant and only when the number is globally unambiguous. Legacy ownership may
 * have been inferred by older code; ambiguous references require reconciliation.
 */
function validateAliases(shipmentAlias:string,orderAlias:string){
  if(![shipmentAlias,orderAlias].every(alias=>/^[a-z][a-z0-9_]*$/.test(alias))||shipmentAlias===orderAlias)throw new Error("Invalid internal shipment join aliases.");
}
export function shipmentOrderLinkSql(shipmentAlias:string,orderAlias:string){
  validateAliases(shipmentAlias,orderAlias);
  return `${shipmentAlias}.organization_id=${orderAlias}.organization_id AND (
    ${shipmentAlias}.purchase_order_id=${orderAlias}.id OR (
      ${shipmentAlias}.purchase_order_id IS NULL AND ${shipmentAlias}.po_number=${orderAlias}.order_number
      AND NOT EXISTS(SELECT 1 FROM purchase_orders link_duplicate WHERE link_duplicate.order_number=${orderAlias}.order_number AND link_duplicate.id<>${orderAlias}.id)))`;
}

/** Set-wise equivalent for large observations. Use the returned relation AND
 * predicate together: the relation proves legacy-number uniqueness once, so
 * the predicate need not rescan the PO table for each legacy shipment. It is
 * not an authorization grant; callers still apply source permissions/filters.
 */
export function shipmentOrderCandidateJoinSql(shipmentAlias:string,orderAlias:string,organizationParameter=1){
  validateAliases(shipmentAlias,orderAlias);
  if(!Number.isSafeInteger(organizationParameter)||organizationParameter<1||organizationParameter>100)throw new Error('Invalid internal organization parameter.');
  return {
    relation:`(SELECT owned.*,COALESCE(owned.purchase_order_id,unique_po.id) AS _compact_po_candidate
      FROM shipments owned LEFT JOIN (SELECT order_number,min(id) AS id FROM purchase_orders GROUP BY order_number HAVING count(*)=1) unique_po
      ON owned.purchase_order_id IS NULL AND owned.po_number=unique_po.order_number WHERE owned.organization_id=$${organizationParameter}) ${shipmentAlias}`,
    predicate:`${shipmentAlias}.organization_id=${orderAlias}.organization_id AND ${orderAlias}.id=${shipmentAlias}._compact_po_candidate`,
  };
}
