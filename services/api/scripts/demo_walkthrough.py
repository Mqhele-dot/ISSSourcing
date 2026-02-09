#!/usr/bin/env python3
import json
import urllib.request

BASE = "http://127.0.0.1:8000"


def req(path: str, method: str = "GET", body: dict | None = None, token: str | None = None):
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(f"{BASE}{path}", data=data, headers=headers, method=method)
    with urllib.request.urlopen(r, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    print("health:", req("/health"))
    login = req("/auth/login", method="POST", body={"username": "planner", "password": "demo"})
    token = login["token"]
    print("login ok")

    detect = req("/exceptions/detect", method="POST", token=token)
    print("detect created:", detect.get("created"), "items:", len(detect.get("items", [])))

    purchase = req("/purchase/orders", token=token)
    items = purchase.get("items", [])
    if not items:
        raise SystemExit("no purchase orders")
    po = items[0]["po_number"]
    print("using po:", po)

    detail = req(f"/purchase/orders/{po}", token=token)
    lines = [{"sku": l.get("sku"), "qty": int(l.get("qty", 0))} for l in detail.get("lines", [])]
    if detail.get("status") == "open":
        req(f"/purchase/orders/{po}/status", method="POST", body={"status": "approved"}, token=token)
    receive = req(f"/purchase/orders/{po}/receive", method="POST", body={"lines": lines}, token=token)
    print("receive changed:", {k: len(v) for k, v in receive.get("changed", {}).items()})

    inv = req("/inventory", token=token)
    if not inv.get("items"):
        raise SystemExit("no inventory rows")
    sku = inv["items"][0]["sku"]
    sku_detail = req(f"/inventory/{sku}", token=token)
    print("inventory movements for", sku, ":", len(sku_detail.get("movements", [])))


if __name__ == "__main__":
    main()
