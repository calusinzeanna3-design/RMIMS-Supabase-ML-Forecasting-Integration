# scripts/update_disburse_html.py
import re

file_path = 'RMIMS/manager/disburse.html'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('<span class="mgr-tx-kpi-value" id="kpiDisbToday">28 kg</span>', '<span class="mgr-tx-kpi-value" id="kpiDisbToday">0 kg</span>')
content = content.replace('<span class="mgr-tx-kpi-sub">Across 3 production runs</span>', '<span class="mgr-tx-kpi-sub" id="kpiDisbTodaySub">Across 0 production runs</span>')

content = content.replace('<span class="mgr-tx-kpi-value" id="kpiDisbMonth">860 kg</span>', '<span class="mgr-tx-kpi-value" id="kpiDisbMonth">0 kg</span>')
content = content.replace('<span class="mgr-tx-kpi-sub">42 production batches</span>', '<span class="mgr-tx-kpi-sub" id="kpiDisbMonthSub">0 production batches</span>')

content = content.replace('<span class="mgr-tx-kpi-value" id="kpiDisbTotalCount">45</span>', '<span class="mgr-tx-kpi-value" id="kpiDisbTotalCount">0</span>')

content = content.replace('<span class="mgr-tx-kpi-value" style="font-size:18px;" id="kpiDisbTopTarget">Pandesal Batch</span>', '<span class="mgr-tx-kpi-value" style="font-size:18px;" id="kpiDisbTopTarget">--</span>')
content = content.replace('<span class="mgr-tx-kpi-sub">340 kg raw materials</span>', '<span class="mgr-tx-kpi-sub" id="kpiDisbTopTargetSub">0 kg raw materials</span>')

content = content.replace('<span id="recLedgerCount">Showing 1 to 5 of 4 disbursements</span>', '<span id="recLedgerCount">Showing 0 disbursements</span>')
content = content.replace('<span class="mgr-ref-code" id="mgrDisbRefDisplay">DIS-2026-00092</span>', '<span class="mgr-ref-code" id="mgrDisbRefDisplay">--</span>')

empty_state = '''<tbody id="mgrDisburseHistoryTbody">
                <tr>
                  <td colspan="8" style="text-align:center; padding:36px 16px; color:#5C7A68; font-size:13px;">
                    <div style="font-weight:700; color:#0F2A1B; margin-bottom:4px;">No disbursements recorded yet</div>
                    <div style="font-size:12px; color:#94A3B8;">Outward raw material usage recorded for production will appear here automatically.</div>
                  </td>
                </tr>
              </tbody>'''
content = re.sub(r'<tbody id="mgrDisburseHistoryTbody">[\s\S]*?</tbody>', empty_state, content)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Updated RMIMS/manager/disburse.html successfully.")
