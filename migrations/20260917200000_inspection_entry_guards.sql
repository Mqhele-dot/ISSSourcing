-- Unknown supplier provenance cannot silently bypass a supplier inspection rule.
CREATE OR REPLACE FUNCTION assert_unlinked_receipt_inspection(p_org integer,p_item integer)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock_shared(hashtextextended(p_org::text||':inspection-policy',0));
 IF EXISTS(SELECT 1 FROM inventory_inspection_rules WHERE organization_id=p_org AND required
   AND ((subject_type='item' AND subject_id=p_item) OR subject_type='supplier')) THEN
   RAISE EXCEPTION 'STOCK_INSPECTION_RECEIPT_REQUIRED' USING ERRCODE='P0001',
     HINT='Use PO receiving with supplier provenance so inspection evidence is recorded.';
 END IF;
END $$;
