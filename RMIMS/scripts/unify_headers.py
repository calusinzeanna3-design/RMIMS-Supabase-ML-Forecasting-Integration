import os
import re

gear_svg = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'

logout_svg = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>'

def get_replacement(role):
    if role == 'admin':
        avatar = 'A'
        name = 'Admin'
        subrole = 'Main Admin'
        title = 'Signed in as Main Admin'
        extra_class = ''
        extra_item_class = ''
    elif role == 'manager':
        avatar = 'M'
        name = 'Manager'
        subrole = 'Manager'
        title = 'Signed in as Manager'
        extra_class = ''
        extra_item_class = ''
    else:
        avatar = 'SS'
        name = 'Store Staff'
        subrole = 'Staff'
        title = 'Signed in as Staff'
        extra_class = ''
        extra_item_class = ''

    return f'''          <!-- Notification Bell -->
          <div class="rmsme-popover-anchor" id="notifAnchor">
            <button class="topbar-icon-btn" id="notificationBtn" aria-label="Notifications" title="Notifications">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              <span class="bell-badge" id="notifBadge" hidden></span>
            </button>
          </div>

          <!-- Profile Pill & Dropdown -->
          <div class="rmsme-popover-anchor" id="profileAnchor">
            <div class="topbar-profile" id="profileBtn" role="button" tabindex="0" title="{title}" style="cursor: pointer;">
              <div class="profile-avatar" data-shell-avatar id="topbarProfileAvatar">{avatar}</div>
              <div class="profile-meta">
                <span class="profile-name" data-shell-name id="topbarProfileName">{name}</span>
                <span class="profile-role" data-shell-role id="topbarProfileRole">{subrole}</span>
              </div>
            </div>
            <div class="rmsme-popover mgr-profile-dropdown{extra_class}" id="profileDropdown" hidden>
              <div class="mgr-profile-head">
                <div class="mgr-online-badge">
                  <span class="mgr-status-indicator"></span>
                  <div>
                    <strong data-shell-name id="dropdownUserName">{name}</strong>
                    <small data-shell-role id="dropdownUserRole" style="display:block; color:#5C7A68; font-size:11.5px;">{subrole}</small>
                  </div>
                </div>
              </div>
              <div class="mgr-popover-divider"></div>
              <a href="settings.html" class="mgr-popover-item{extra_item_class}" id="headerAccountLink">
                {gear_svg}
                Account
              </a>
              <div class="mgr-popover-divider"></div>
              <button type="button" class="mgr-popover-item{extra_item_class} text-danger" id="headerLogoutBtn">
                {logout_svg}
                Logout
              </button>
            </div>
          </div>'''

def process_file(filepath, role):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Pattern to match from Notification Bell comment or <div class="rmsme-popover-anchor" id="(mgrNotifAnchor|notifAnchor)">
    # through the end of the profile anchor block right before </header>
    pattern = r'([ \t]*<!-- Notification Bell -->[\s\S]*?)(?=[ \t]*</div>\s*</header>)'
    
    rep = get_replacement(role)
    
    if re.search(pattern, content):
        new_content = re.sub(pattern, rep + '\n        ', content, count=1)
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"Updated {filepath}")
    else:
        # Fallback pattern matching notification anchor to profile anchor
        alt_pattern = r'([ \t]*<div class="rmsme-popover-anchor" id="(?:mgrNotifAnchor|notifAnchor)"[\s\S]*?)(?=[ \t]*</div>\s*</header>)'
        if re.search(alt_pattern, content):
            new_content = re.sub(alt_pattern, rep + '\n        ', content, count=1)
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(new_content)
            print(f"Updated (alt) {filepath}")
        else:
            print(f"COULD NOT MATCH {filepath}")

base_dir = r"c:\Users\Zeanna\Downloads\RMIMS-AI-BASED-FORECASTING-INTEGRATED\RMIMS-DASHBOARD-VIEW-3D-SUGAR-APPLIED\RMIMS-Supabase-ML-Forecasting-Integration\RMIMS"

for p in os.listdir(os.path.join(base_dir, 'admin')):
    if p.endswith('.html'):
        process_file(os.path.join(base_dir, 'admin', p), 'admin')

for p in os.listdir(os.path.join(base_dir, 'manager')):
    if p.endswith('.html'):
        process_file(os.path.join(base_dir, 'manager', p), 'manager')

for p in os.listdir(os.path.join(base_dir, 'user')):
    if p.endswith('.html'):
        process_file(os.path.join(base_dir, 'user', p), 'staff')
