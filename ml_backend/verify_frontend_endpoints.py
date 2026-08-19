import urllib.request
import json
import os
import sys

def test_endpoints():
    endpoints = [
        "http://127.0.0.1:5500/RMIMS/admin/dashboard.html",
        "http://127.0.0.1:5500/RMIMS/user/dashboard.html",
        "http://127.0.0.1:5500/RMIMS/admin/forecasting.html",
        "http://127.0.0.1:5500/RMIMS/admin/analytics.html",
        "http://127.0.0.1:5500/RMIMS/user/analytics.html",
        "http://127.0.0.1:5500/RMIMS/admin/reports.html",
        "http://127.0.0.1:5500/RMIMS/user/reports.html",
        "http://127.0.0.1:5500/RMIMS/admin/inventory.html",
        "http://127.0.0.1:5500/RMIMS/user/inventory.html",
        "http://127.0.0.1:5500/RMIMS/js/dashboard.js",
        "http://127.0.0.1:5500/RMIMS/js/user-dashboard.js",
        "http://127.0.0.1:5500/RMIMS/js/forecasting.js",
        "http://127.0.0.1:5500/RMIMS/js/analytics.js",
        "http://127.0.0.1:5500/RMIMS/js/user-analytics.js",
        "http://127.0.0.1:5500/RMIMS/js/reports.js",
        "http://127.0.0.1:5500/RMIMS/js/user-reports.js",
        "http://127.0.0.1:5500/RMIMS/js/inventory.js",
        "http://127.0.0.1:5500/RMIMS/js/user-inventory.js",
        "http://127.0.0.1:5500/RMIMS/js/finished-product-setup.js"
    ]
    
    print("Testing Vite dev server endpoints:")
    all_ok = True
    for url in endpoints:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=5) as response:
                code = response.getcode()
                content = response.read().decode('utf-8')
                print(f"[OK] {url} -> HTTP {code} ({len(content)} bytes)")
        except Exception as e:
            print(f"[FAIL] {url} -> {e}")
            all_ok = False
            
    return all_ok

if __name__ == "__main__":
    success = test_endpoints()
    sys.exit(0 if success else 1)
