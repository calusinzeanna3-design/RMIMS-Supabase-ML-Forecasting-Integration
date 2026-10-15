import os
import re

base_dir = r"c:\Users\Zeanna\Downloads\RMIMS-AI-BASED-FORECASTING-INTEGRATED\RMIMS-DASHBOARD-VIEW-3D-SUGAR-APPLIED\RMIMS-Supabase-ML-Forecasting-Integration\RMIMS"

# 1. Update RMIMS/manager/dashboard.html
dashboard_html_path = os.path.join(base_dir, "manager", "dashboard.html")
with open(dashboard_html_path, "r", encoding="utf-8") as f:
    content = f.read()

# Replace .smart-alerts-list content
smart_alerts_regex = r'<div class="smart-alerts-list">.*?</div>\s*</div>\s*<!-- 3\. Forecast Summary'
replacement_smart_alerts = '''<div class="smart-alerts-list">
            <!-- Dynamically populated from real raw materials requiring restock -->
          </div>
        </div>

        <!-- 3. Forecast Summary'''
content = re.sub(smart_alerts_regex, replacement_smart_alerts, content, flags=re.DOTALL)

# Replace transaction review modal hardcoded defaults
content = content.replace(
    '<span style="font-family:\'Inter\', sans-serif; font-size:13px; font-weight:600; color:#0F2A1B;" id="reviewRefNum">REC-2026-00125</span>',
    '<span style="font-family:\'Inter\', sans-serif; font-size:13px; font-weight:600; color:#0F2A1B;" id="reviewRefNum">--</span>'
)
content = content.replace(
    '<span style="font-size:13.5px; font-weight:700; color:#0F2A1B;" id="reviewStaff">John Reyes</span>',
    '<span style="font-size:13.5px; font-weight:700; color:#0F2A1B;" id="reviewStaff">--</span>'
)
content = content.replace(
    '<span style="font-size:13.5px; font-weight:700; color:#15803D;" id="reviewActivity">Receive</span>',
    '<span style="font-size:13.5px; font-weight:700; color:#15803D;" id="reviewActivity">--</span>'
)
content = content.replace(
    '<span style="font-size:13.5px; font-weight:700; color:#0F2A1B;" id="reviewMaterial">Sugar</span>',
    '<span style="font-size:13.5px; font-weight:700; color:#0F2A1B;" id="reviewMaterial">--</span>'
)
content = content.replace(
    '<span style="font-size:13.5px; font-weight:700; color:#0F2A1B;" id="reviewQuantity">20 kg</span>',
    '<span style="font-size:13.5px; font-weight:700; color:#0F2A1B;" id="reviewQuantity">--</span>'
)
content = content.replace(
    '<span style="font-size:12.5px; font-weight:500; color:#334155;" id="reviewDate">Today, 10:25 AM</span>',
    '<span style="font-size:12.5px; font-weight:500; color:#334155;" id="reviewDate">--</span>'
)
content = content.replace(
    '<span class="mgr-status-pill status-pending" id="reviewStatusBadge">Pending</span>',
    '<span class="mgr-status-pill status-pending" id="reviewStatusBadge">--</span>'
)
content = content.replace(
    '<div style="background:#F8FAFC; border:1px solid #E2E8F0; padding:10px 14px; border-radius:8px; font-size:13px; color:#334155;" id="reviewNotes">New delivery from Northern Cane Mills</div>',
    '<div style="background:#F8FAFC; border:1px solid #E2E8F0; padding:10px 14px; border-radius:8px; font-size:13px; color:#334155;" id="reviewNotes">No extra notes provided.</div>'
)

with open(dashboard_html_path, "w", encoding="utf-8") as f:
    f.write(content)
print("Updated manager/dashboard.html successfully.")

# 2. Update RMIMS/manager/staff-activity.html
staff_html_path = os.path.join(base_dir, "manager", "staff-activity.html")
with open(staff_html_path, "r", encoding="utf-8") as f:
    s_content = f.read()

# Replace hardcoded counter values
s_content = re.sub(r'<span class="staff-kpi-value" id="kpiStaffTotal">\d+</span>', '<span class="staff-kpi-value" id="kpiStaffTotal">0</span>', s_content)
s_content = re.sub(r'<span class="staff-kpi-value" style="color:#D97706;" id="kpiStaffPending">\d+</span>', '<span class="staff-kpi-value" style="color:#D97706;" id="kpiStaffPending">0</span>', s_content)
s_content = re.sub(r'<span class="staff-kpi-value" style="color:#15803D;" id="kpiStaffApproved">\d+</span>', '<span class="staff-kpi-value" style="color:#15803D;" id="kpiStaffApproved">0</span>', s_content)
s_content = re.sub(r'<span class="staff-kpi-value" style="color:#DC2626;" id="kpiStaffRejected">\d+</span>', '<span class="staff-kpi-value" style="color:#DC2626;" id="kpiStaffRejected">0</span>', s_content)
s_content = re.sub(r'id="staffCountLabel">Showing \d+ records<', 'id="staffCountLabel">Showing 0 records<', s_content)

# Replace staff member options with clean default
staff_select_regex = r'<select class="staff-filter-select" id="staffMemberFilter" aria-label="Filter by Staff">.*?</select>'
staff_select_repl = '''<select class="staff-filter-select" id="staffMemberFilter" aria-label="Filter by Staff">
            <option value="all" selected>All Staff Members</option>
          </select>'''
s_content = re.sub(staff_select_regex, staff_select_repl, s_content, flags=re.DOTALL)

# Modal placeholders in staff-activity.html
s_content = s_content.replace('id="reviewRefNum">REC-2026-00125<', 'id="reviewRefNum">--<')
s_content = s_content.replace('id="reviewStaff">John Reyes<', 'id="reviewStaff">--<')
s_content = s_content.replace('id="reviewActivity">Receive<', 'id="reviewActivity">--<')
s_content = s_content.replace('id="reviewMaterial">Sugar<', 'id="reviewMaterial">--<')
s_content = s_content.replace('id="reviewQuantity">20 kg<', 'id="reviewQuantity">--<')
s_content = s_content.replace('id="reviewDate">Today, 10:25 AM<', 'id="reviewDate">--<')
s_content = s_content.replace('id="reviewNotes">New delivery from Northern Cane Mills<', 'id="reviewNotes">No extra notes provided.<')

with open(staff_html_path, "w", encoding="utf-8") as f:
    f.write(s_content)
print("Updated manager/staff-activity.html successfully.")
