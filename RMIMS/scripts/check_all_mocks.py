# scripts/check_all_mocks.py
import re
import os

files = [
    'RMIMS/manager/receive.html',
    'RMIMS/manager/disburse.html',
    'RMIMS/manager/usage.html',
    'RMIMS/js/manager-receive.js',
    'RMIMS/js/manager-disburse.js',
    'RMIMS/js/manager-usage.js',
    'RMIMS/js/analytics-engine.js'
]

mock_patterns = [
    r'REC-2026-00125',
    r'DIS-2026-00091',
    r'INITIAL_MGR_RECEIPTS',
    r'INITIAL_MGR_DISBURSEMENTS',
    r'DEFAULT_DISBURSEMENTS',
    r'seed-rec-',
    r'seed-disb-',
    r'Northern Cane Mills',
    r'Dairy Crest',
    r'Golden Wheat Mills',
    r'Sunrise Oil'
]

for f in files:
    if not os.path.exists(f):
        print(f, 'NOT FOUND')
        continue
    with open(f, 'r', encoding='utf-8') as fh:
        text = fh.read()
    print('===', f, '===')
    for pat in mock_patterns:
        matches = re.findall(pat, text)
        if matches:
            print(f'  Pattern "{pat}": {len(matches)} matches')
