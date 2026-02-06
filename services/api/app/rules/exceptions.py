from dataclasses import dataclass


@dataclass
class ExceptionHit:
    rule_type: str
    severity: str
    reason: str
    linked_entity_id: str


def detect_stockout_risk(sku_id: str, days_of_cover: float, threshold: float = 5.0) -> ExceptionHit | None:
    if days_of_cover >= threshold:
        return None
    sev = "high" if days_of_cover <= 3 else "medium"
    return ExceptionHit("stockout_risk", sev, f"DOC={days_of_cover}", sku_id)


def detect_late_confirmation(po_id: str, acknowledged: bool, sla_hours_elapsed: int, sla_hours: int = 24) -> ExceptionHit | None:
    if acknowledged or sla_hours_elapsed <= sla_hours:
        return None
    sev = "high" if sla_hours_elapsed > sla_hours * 2 else "medium"
    return ExceptionHit("late_confirmation", sev, f"No confirmation after {sla_hours_elapsed}h", po_id)


def detect_shipment_delay(shipment_id: str, eta_drift_hours: int, threshold: int = 6) -> ExceptionHit | None:
    if eta_drift_hours <= threshold:
        return None
    sev = "high" if eta_drift_hours > 24 else "medium"
    return ExceptionHit("shipment_delay", sev, f"ETA drift {eta_drift_hours}h", shipment_id)
