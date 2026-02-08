from app.services.exceptions import detect_demo_exceptions, detect_response


def test_exceptions_detect_200_empty():
    items = detect_demo_exceptions({"inventory_position": [], "purchase_order": [], "shipment": []})
    assert detect_response(items) == {"items": [], "message": "No open exceptions"}


def test_exceptions_detect_returns_items_when_demo_exception_present():
    records = {
        "inventory_position": [{"sku": "SKU-1", "available": 10}],
        "purchase_order": [{"po_number": "PO-1", "status": "open", "requested_date": "2000-01-01"}],
        "shipment": [{"shipment_id": "SHIP-1", "eta_drift_hours": 12}],
    }
    items = detect_demo_exceptions(records)
    response = detect_response(items)

    assert len(items) >= 2
    assert "items" in response
    assert response["items"] == items
