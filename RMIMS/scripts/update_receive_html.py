# scripts/update_receive_html.py
import re

file_path = 'RMIMS/manager/receive.html'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace KPI values
content = content.replace('<span class="mgr-tx-kpi-value" id="kpiRecToday">45 kg</span>', '<span class="mgr-tx-kpi-value" id="kpiRecToday">0 kg</span>')
content = content.replace('<span class="mgr-tx-kpi-sub">Across 2 shipments</span>', '<span class="mgr-tx-kpi-sub" id="kpiRecTodaySub">Across 0 shipments</span>')

content = content.replace('<span class="mgr-tx-kpi-value" id="kpiRecMonth">1,240 kg</span>', '<span class="mgr-tx-kpi-value" id="kpiRecMonth">0 kg</span>')
content = content.replace('<span class="mgr-tx-kpi-sub">18 verified deliveries</span>', '<span class="mgr-tx-kpi-sub" id="kpiRecMonthSub">0 verified deliveries</span>')

content = content.replace('<span class="mgr-tx-kpi-value" id="kpiRecTotalCount">32</span>', '<span class="mgr-tx-kpi-value" id="kpiRecTotalCount">0</span>')

content = content.replace('<span class="mgr-tx-kpi-value" style="font-size:20px;" id="kpiRecTopMaterial">Flour</span>', '<span class="mgr-tx-kpi-value" style="font-size:20px;" id="kpiRecTopMaterial">--</span>')
content = content.replace('<span class="mgr-tx-kpi-sub">480 kg total inward</span>', '<span class="mgr-tx-kpi-sub" id="kpiRecTopMaterialSub">0 kg total inward</span>')

content = content.replace('<span id="recLedgerCount">Showing 1 to 5 of 4 receipts</span>', '<span id="recLedgerCount">Showing 0 receipts</span>')
content = content.replace('<span class="mgr-ref-code" id="mgrRecRefDisplay">REC-2026-00126</span>', '<span class="mgr-ref-code" id="mgrRecRefDisplay">--</span>')

# Empty state in tbody
empty_state = '''<tbody id="mgrReceiveHistoryTbody">
                <tr>
                  <td colspan="8" style="text-align:center; padding:36px 16px; color:#5C7A68; font-size:13px;">
                    <div style="font-weight:700; color:#0F2A1B; margin-bottom:4px;">No receipts recorded yet</div>
                    <div style="font-size:12px; color:#94A3B8;">Incoming raw material deliveries recorded will appear here automatically.</div>
                  </td>
                </tr>
              </tbody>'''
content = re.sub(r'<tbody id="mgrReceiveHistoryTbody">[\s\S]*?</tbody>', empty_state, content)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Updated RMIMS/manager/receive.html successfully.")
