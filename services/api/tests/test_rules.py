from app.rules.exceptions import detect_stockout_risk, detect_late_confirmation, detect_shipment_delay


def test_stockout_rule():
    hit = detect_stockout_risk('SKU', 2.0)
    assert hit and hit.severity == 'high'
    assert detect_stockout_risk('SKU', 9.0) is None


def test_late_confirmation_rule():
    assert detect_late_confirmation('PO', False, 30)
    assert detect_late_confirmation('PO', True, 30) is None


def test_shipment_delay_rule():
    assert detect_shipment_delay('S', 12)
    assert detect_shipment_delay('S', 2) is None
