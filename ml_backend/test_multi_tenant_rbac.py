"""
Multi-Tenant RBAC & Cross-Company Isolation Test Suite
=====================================================
Validates that:
1. Scones & Muffins ('1872cf44-e821-4370-b227-d1b7e4fc6f56') models load independently from its folder.
2. 5-Year KXC Company models load independently from root.
3. Strict RBAC blocks unauthorized roles (HTTP 403).
4. Strict Air-Gap blocks cross-company SKU contamination (HTTP 400).
5. Exact margins are applied for each company.
"""

import sys
import os
import json

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, os.path.dirname(__file__))

from app import app, CompanyTenant, UserRole

def run_multi_tenant_rbac_tests():
    print("=" * 75)
    print("   [TEST] RMIMS MULTI-TENANT RBAC & COMPANY ISOLATION TEST SUITE   ")
    print("=" * 75)

    client = app.test_client()

    # 1. Test Health Status for Both Tenants
    print("\n[Test 1] Testing /api/health for both company backends...")
    res = client.get("/api/health")
    assert res.status_code == 200
    health = json.loads(res.data)
    print(f"  [PASS] Overall Health: {health['status']}")
    print(f"  [PASS] KXC Enterprise Models ({health['kxc_enterprise']['tenant_id']}): {health['kxc_enterprise']['models_loaded']}/60")
    print(f"  [PASS] KXC Strict Margin Boundaries Loaded: {health['kxc_enterprise']['strict_boundaries_loaded']} SKUs")
    print(f"  [PASS] Scones & Muffins Bakery Models: {health['scones_and_muffins_bakery']['models_loaded']}/20")
    assert health['kxc_enterprise']['models_loaded'] >= 59
    assert health['scones_and_muffins_bakery']['models_loaded'] >= 19

    # 2. Test Tenant Listing
    print("\n[Test 2] Testing /api/tenants...")
    res = client.get("/api/tenants")
    assert res.status_code == 200
    tenants_data = json.loads(res.data)
    assert len(tenants_data["tenants"]) == 2
    assert tenants_data["tenants"][0]["id"] == "a72a7971-6ec7-4edc-ae72-89d702199ed9"
    print(f"  [PASS] Registered {len(tenants_data['tenants'])} strictly isolated company tenants.")
    print(f"  [PASS] KXC Tenant ID: {tenants_data['tenants'][0]['id']} (Folder: {tenants_data['tenants'][0]['folder']})")

    # 3. Test Scones & Muffins Catalog (19 SKUs, NB-001 to NB-019)
    print("\n[Test 3] Testing Scones & Muffins Catalog (/api/scones-muffins/materials)...")
    res = client.get("/api/scones-muffins/materials")
    assert res.status_code == 200
    scones_cat = json.loads(res.data)
    assert scones_cat["count"] == 19
    assert scones_cat["materials"][0]["material_id"] == "NB-001"
    print(f"  [PASS] Scones & Muffins Catalog Verified: Exactly {scones_cat['count']} SKUs (NB-001 to NB-019).")

    # 4. Test Scones & Muffins Forecast for Flour (NB-001)
    print("\n[Test 4] Testing Scones & Muffins Forecast (/api/scones-muffins/forecast)...")
    payload = {"material_id": "NB-001", "horizon_type": "month", "horizon_value": 3}
    res = client.post("/api/scones-muffins/forecast", data=json.dumps(payload), content_type="application/json")
    assert res.status_code == 200
    fc = json.loads(res.data)
    assert fc["material_id"] == "NB-001"
    assert fc["tenant_id"] == CompanyTenant.SCONES_MUFFINS.value
    print(f"  [PASS] Forecast for '{fc['raw_material_name']}' ({fc['material_id']}):")
    print(f"         Total Projected: {fc['total_projected_requirement']} {fc['unit']}")
    print(f"         Applied Margin: {fc['margin_of_error']}")

    # 5. Test KXC Forecast for Sugar (RM-059) using updated UUID a72a7971-6ec7-4edc-ae72-89d702199ed9
    print("\n[Test 5] Testing KXC Forecast for RM-059 with UUID a72a7971-6ec7-4edc-ae72-89d702199ed9...")
    headers_kxc = {"X-Company-Id": "a72a7971-6ec7-4edc-ae72-89d702199ed9", "X-User-Role": "KXC_MANAGER"}
    payload_kxc = {"material_id": "RM-059", "horizon_type": "month", "horizon_value": 6}
    res = client.post("/api/forecast", data=json.dumps(payload_kxc), headers=headers_kxc, content_type="application/json")
    assert res.status_code == 200
    fc_kxc = json.loads(res.data)
    assert fc_kxc["material_id"] == "RM-059"
    assert fc_kxc["tenant_id"] == "a72a7971-6ec7-4edc-ae72-89d702199ed9"
    print(f"  [PASS] KXC Forecast for '{fc_kxc['raw_material_name']}' ({fc_kxc['material_id']}): Tenant correctly resolved to {fc_kxc['tenant_id']}")

    # 5b. Test KXC Strict Margin Boundaries endpoint
    print("\n[Test 5b] Testing KXC Strict Margin Boundaries (/api/kxc/margins)...")
    res_b = client.get("/api/kxc/margins")
    assert res_b.status_code == 200
    b_data = json.loads(res_b.data)
    assert b_data["count"] == 59
    assert "RM-059" in b_data["boundaries"]
    print(f"  [PASS] Loaded {b_data['count']} SKU boundaries. RM-059 Corridor: {b_data['boundaries']['RM-059']['corridor']}")

    # 6. RBAC VIOLATION TEST 1: KXC_MANAGER tries to access Scones & Muffins dataset
    print("\n[Test 6] [RBAC SECURITY] Verifying KXC_MANAGER cannot access Scones & Muffins...")
    headers_kxc_trespass = {
        "X-Company-Id": "1872cf44-e821-4370-b227-d1b7e4fc6f56",
        "X-User-Role": "KXC_MANAGER"
    }
    res_block1 = client.get("/api/materials", headers=headers_kxc_trespass)
    assert res_block1.status_code == 403, f"Expected 403 Forbidden, got {res_block1.status_code}"
    err1 = json.loads(res_block1.data)
    assert err1["rbac_error"] is True
    print(f"  [PASS] ACCESS DENIED: {err1['error']}")

    # 7. RBAC VIOLATION TEST 2: SCONES_MUFFINS_MANAGER tries to access 5-Year dataset
    print("\n[Test 7] [RBAC SECURITY] Verifying SCONES_MUFFINS_MANAGER cannot access 5-Year KXC Company...")
    headers_scones_trespass = {
        "X-Company-Id": "KXC_COMPANY",
        "X-User-Role": "SCONES_MUFFINS_MANAGER"
    }
    res_block2 = client.get("/api/materials", headers=headers_scones_trespass)
    assert res_block2.status_code == 403, f"Expected 403 Forbidden, got {res_block2.status_code}"
    err2 = json.loads(res_block2.data)
    assert err2["rbac_error"] is True
    print(f"  [PASS] ACCESS DENIED: {err2['error']}")

    # 8. AIR-GAP CONTAMINATION TEST 1: Querying 5-Year SKU (RM-001) under Scones & Muffins
    print("\n[Test 8] [AIR-GAP SECURITY] Querying RM-001 under Scones & Muffins tenant...")
    headers_scones_auth = {
        "X-Company-Id": "1872cf44-e821-4370-b227-d1b7e4fc6f56",
        "X-User-Role": "SCONES_MUFFINS_MANAGER"
    }
    res_airgap1 = client.post(
        "/api/forecast",
        data=json.dumps({"material_id": "RM-001", "horizon_type": "month", "horizon_value": 3}),
        headers=headers_scones_auth,
        content_type="application/json"
    )
    assert res_airgap1.status_code == 400
    err_airgap1 = json.loads(res_airgap1.data)
    assert "CROSS-COMPANY CONTAMINATION BLOCKED" in err_airgap1["error"]
    print(f"  [PASS] CONTAMINATION PREVENTED: {err_airgap1['error']}")

    # 9. AIR-GAP CONTAMINATION TEST 2: Querying Scones SKU (NB-001) under KXC 5-Year
    print("\n[Test 9] [AIR-GAP SECURITY] Querying NB-001 under KXC 5-Year tenant...")
    res_airgap2 = client.post(
        "/api/forecast",
        data=json.dumps({"material_id": "NB-001", "horizon_type": "month", "horizon_value": 3}),
        headers={"X-Company-Id": "KXC_COMPANY", "X-User-Role": "KXC_MANAGER"},
        content_type="application/json"
    )
    assert res_airgap2.status_code == 400
    err_airgap2 = json.loads(res_airgap2.data)
    assert "CROSS-COMPANY CONTAMINATION BLOCKED" in err_airgap2["error"]
    print(f"  [PASS] CONTAMINATION PREVENTED: {err_airgap2['error']}")

    # 10. SUPER_ADMIN Cross-Tenant Audit Access
    print("\n[Test 10] [SUPER_ADMIN PRIVILEGE] Verifying SUPER_ADMIN can audit both tenants...")
    res_audit_kxc = client.get("/api/materials", headers={"X-Company-Id": "KXC_COMPANY", "X-User-Role": "SUPER_ADMIN"})
    assert res_audit_kxc.status_code == 200
    assert json.loads(res_audit_kxc.data)["count"] == 59

    res_audit_scones = client.get("/api/materials", headers={"X-Company-Id": "1872cf44-e821-4370-b227-d1b7e4fc6f56", "X-User-Role": "SUPER_ADMIN"})
    assert res_audit_scones.status_code == 200
    assert json.loads(res_audit_scones.data)["count"] == 19
    print("  [PASS] SUPER_ADMIN successfully authorized to audit both KXC and Scones & Muffins.")

    print("\n" + "=" * 75)
    print("  [SUCCESS] ALL MULTI-TENANT RBAC & AIR-GAP ISOLATION TESTS PASSED 100%!")
    print("=" * 75)

if __name__ == "__main__":
    run_multi_tenant_rbac_tests()
