// RMIMS Admin Branch Stores Controller
// Implements:
// 1. Location Divider Architecture (Location Boxes e.g. TIAONG BRANCH, LUCENA BRANCH)
// 2. View Branches Popup Modal (Displays small store boxes under that location with role counts, NO revenue)
// 3. Store Personnel List Modal (Separate roles for Branch Managers and Staff & Employees with access codes 🔑, NO revenue)
// 4. Destructive Branch Deletion & Dynamic Add Branch

// Default Stores Data Seed (Authentic active branch stores)
const DEFAULT_STORES_DATA = {
  "scones-lucena": {
    id: "scones-lucena",
    name: "Scones & Muffins Bakery",
    location: "Lucena",
    locKey: "lucena",
    companyId: "1872cf44-e821-4370-b227-d1b7e4fc6f56",
    code: "NB-LUC",
    category: "Bakery & Production Hub",
    managers: [
      { name: "Aizel", username: "Scones_manager", email: "zeannapatty@gmail.com", accessCode: "MGR-LUC-01", status: "APPROVED" }
    ],
    staff: [
      { name: "Staff_1", username: "Scones_Staff_1", email: "Sconesandmuffins@gmail.com", accessCode: "STF-LUC-01", status: "APPROVED" },
      { name: "Staff_2", username: "Staff_Scones_2", email: "scone2@gmail.com", accessCode: "STF-LUC-02", status: "APPROVED" }
    ]
  },
  "kxc-tiaong": {
    id: "kxc-tiaong",
    name: "KXC 5-Year Enterprise",
    location: "Tiaong",
    locKey: "tiaong",
    companyId: "a72a7971-6ec7-4edc-ae72-89d702199ed9",
    code: "RM-TIA",
    category: "Pasalubong & Enterprise Hub",
    managers: [
      { name: "Glazel", username: "Glazel_Kxc", email: "zeannapatricia@gmail.com", accessCode: "MGR-TIA-01", status: "APPROVED" }
    ],
    staff: []
  }
};

// Dynamic location metadata helper - adapts cleanly to any registered location
function getLocationMeta(locKey, locationName) {
  const cleanName = (locationName || locKey || 'BRANCH').trim();
  const upper = cleanName.toUpperCase();
  const displayName = upper.includes('BRANCH') ? upper : `${upper} BRANCH`;
  return {
    key: locKey,
    name: displayName,
    subtext: `${cleanName} • Branch Store Hub`,
    badge: 'Branch Hub'
  };
}

function getInitials(name) {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Filter out legacy pre-seeded mock stores
function isMockStore(st) {
  if (!st) return false;
  const mockTokens = [
    'lucena bakers hub', 'sweet treats',
    'rafael cruz', 'kenneth lim', 'victor morales', 'alyssa lim', 'ethan cruz',
    'mark villanueva', 'carla mendoza', 'sarah gomez'
  ];
  const combined = `${st.id || ''} ${st.name || ''} ${st.location || ''} ${st.locKey || ''} ${(st.managers || []).map(m => (m.name || '') + ' ' + (m.username || '')).join(' ')} ${(st.staff || []).map(s => (s.name || '') + ' ' + (s.username || '')).join(' ')}`.toLowerCase();
  return mockTokens.some(tok => combined.includes(tok));
}


// Dynamically synchronize store personnel with live user profiles
export function syncStoresWithRealUsers(stores) {
  if (!stores || typeof stores !== 'object') return stores;
  try {
    const rawUsers = localStorage.getItem('rmims_registered_users');
    let deletedKeys = [];
    try { deletedKeys = JSON.parse(localStorage.getItem('rmims_deleted_users') || '[]'); } catch (_) {}

    const users = rawUsers ? JSON.parse(rawUsers) : [];
    if (!Array.isArray(users)) return stores;

    // Filter active users only and exclude deleted users
    const activeUsers = users.filter(u => {
      if (!u) return false;
      if (deletedKeys.some(d => (d.id && d.id === u.id) || (d.email && u.email && d.email.toLowerCase() === u.email.toLowerCase()))) return false;
      const s = String(u.status || '').toLowerCase().trim();
      return s !== 'pending' && s !== 'pending_approval' && s !== 'inactive';
    });

    Object.values(stores).forEach(st => {
      const stLoc = (st.location || st.locKey || '').toLowerCase().trim();
      const stName = (st.name || '').toLowerCase().trim();

      // Purge any deleted personnel directly from store
      st.managers = (st.managers || []).filter(m => !deletedKeys.some(d => (d.id && d.id === m.id) || (d.email && m.email && d.email.toLowerCase() === m.email.toLowerCase())));
      st.staff = (st.staff || []).filter(s => !deletedKeys.some(d => (d.id && d.id === s.id) || (d.email && s.email && d.email.toLowerCase() === s.email.toLowerCase())));

      const matchingUsers = activeUsers.filter(u => {
        const uLoc = (u.branchLoc || u.branch_location || '').toLowerCase().trim();
        const uName = (u.branchName || u.branch_name || '').toLowerCase().trim();
        return (uLoc && stLoc && (uLoc.includes(stLoc) || stLoc.includes(uLoc))) ||
               (uName && stName && (uName.includes(stName) || stName.includes(uName)));
      });

      // Filter managers
      const managers = matchingUsers.filter(u => {
        const r = String(u.role || u.operational_role || '').toLowerCase();
        return r.includes('manager') && !r.includes('main admin');
      }).map((m, idx) => ({
        id: m.id,
        name: m.name || m.username || 'Manager',
        username: m.username || 'manager',
        email: m.email || '',
        accessCode: `MGR-${(st.location || 'STR').slice(0, 3).toUpperCase()}-0${idx + 1}`
      }));

      // Filter staff
      const staff = matchingUsers.filter(u => {
        const r = String(u.role || u.operational_role || '').toLowerCase();
        return (r.includes('staff') || r.includes('employee') || r.includes('user')) && !r.includes('manager') && !r.includes('admin');
      }).map((s, idx) => ({
        id: s.id,
        name: s.name || s.username || 'Staff',
        username: s.username || 'staff',
        email: s.email || '',
        accessCode: `STF-${(st.location || 'STR').slice(0, 3).toUpperCase()}-0${idx + 1}`
      }));

      // Reflect current live roster
      st.managers = managers;
      st.staff = staff;
    });
  } catch (err) {
    console.warn('Notice in syncStoresWithRealUsers:', err);
  }
  return stores;
}

// Storage Helpers
export function getStoresData() {
  try {
    const raw = localStorage.getItem('RMIMS_BRANCH_STORES_V3');
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const clean = {};
        let modified = false;
        Object.entries(parsed).forEach(([id, st]) => {
          if (isMockStore(st)) {
            modified = true;
          } else {
            clean[id] = st;
          }
        });
        if (modified) {
          localStorage.setItem('RMIMS_BRANCH_STORES_V3', JSON.stringify(clean));
          window.dispatchEvent(new Event('rmims_stores_updated'));
        }
        syncStoresWithRealUsers(clean);
        return clean;
      }
    }
  } catch (err) {
    console.warn('Failed reading stores from localStorage:', err);
  }
  const defaults = JSON.parse(JSON.stringify(DEFAULT_STORES_DATA));
  try {
    localStorage.setItem('RMIMS_BRANCH_STORES_V3', JSON.stringify(defaults));
  } catch (_) {}
  return defaults;
}

export function saveStoresData(data) {
  try {
    localStorage.setItem('RMIMS_BRANCH_STORES_V3', JSON.stringify(data));
    window.dispatchEvent(new Event('rmims_stores_updated'));
    window.dispatchEvent(new Event('storage'));

    import('../supabase/admin-supabase-service.js')
      .then(srv => {
        Object.values(data).forEach(st => srv.saveBranchStore(st).catch(() => {}));
      })
      .catch(() => {});
  } catch (err) {
    console.warn('Failed saving stores to localStorage:', err);
  }
}

// Track modal state
let currentViewingLocKey = null;
let currentViewingStoreId = null;

// Helper to group stores by location
function getStoresByLocation() {
  const stores = getStoresData();
  const grouped = {};

  // Assign stores
  Object.values(stores).forEach(store => {
    const locKey = store.locKey || store.locationKey || (store.location ? store.location.toLowerCase().replace(/[^a-z0-9]/g, '') : 'other');
    if (!grouped[locKey]) {
      const meta = getLocationMeta(locKey, store.location);
      grouped[locKey] = {
        key: locKey,
        name: meta.name,
        subtext: meta.subtext,
        badge: meta.badge,
        stores: []
      };
    }
    grouped[locKey].stores.push(store);
  });

  return grouped;
}

// ==========================================================================
// 1. RENDER LOCATION DIVIDER CARDS (Starting view on page)
// ==========================================================================
export function renderLocationDividers(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const stores = getStoresData();
  const allStoresList = Object.values(stores);

  if (allStoresList.length === 0) {
    container.innerHTML = `
      <div class="empty-state-card" style="grid-column: 1 / -1; text-align: center; padding: 56px 24px; background: var(--rm-card-bg, #ffffff); border: 1px dashed var(--rm-border, #E2E8F0); border-radius: 16px;">
        <div style="width: 56px; height: 56px; border-radius: 50%; background: rgba(16, 185, 129, 0.1); color: #10B981; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px;">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 21h18"/>
            <path d="M3 7v14"/>
            <path d="M21 7v14"/>
            <path d="M2 7l10-4 10 4"/>
          </svg>
        </div>
        <h3 style="font-size: 16px; font-weight: 700; color: var(--rm-ink, #0F172A); margin-bottom: 6px;">No Branch Stores Registered</h3>
        <p style="font-size: 13.5px; color: var(--rm-ink-dim, #64748B); max-width: 440px; margin: 0 auto 20px auto;">
          No store locations are currently registered. Use the "+ Add Branch Store" button above to set up your first store location and assign branch personnel.
        </p>
        <button type="button" class="btn-primary-action" onclick="document.getElementById('btnOpenAddBranch') && document.getElementById('btnOpenAddBranch').click()" style="display: inline-flex; align-items: center; gap: 8px; margin: 0 auto;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span>Add Branch Store</span>
        </button>
      </div>
    `;
    return;
  }

  const grouped = getStoresByLocation();
  const locKeys = Object.keys(grouped);

  let html = '';
  locKeys.forEach(key => {
    const loc = grouped[key];
    const storeCount = loc.stores.length;

    let mgrCount = 0;
    let staffCount = 0;
    loc.stores.forEach(s => {
      mgrCount += (s.managers || []).length;
      staffCount += (s.staff || []).length;
    });
    const totalRoles = mgrCount + staffCount;

    html += `
      <div class="location-divider-card" data-location-key="${escapeHtml(loc.key)}">
        <div>
          <!-- Top Row: Location Title & Operational Badge -->
          <div class="location-card-top">
            <div class="location-brand-group">
              <div class="location-icon-box">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                  <circle cx="12" cy="10" r="3"/>
                </svg>
              </div>
              <div class="location-name-group">
                <h3 class="location-title">${escapeHtml(loc.name)}</h3>
                <span class="location-meta-sub">${escapeHtml(loc.subtext)}</span>
              </div>
            </div>
            <span class="location-status-pill">
              <span class="pill-dot"></span>
              Operational
            </span>
          </div>

          <!-- Role Counts Summary Inset Grid -->
          <div class="location-role-summary-grid" style="margin-top: 18px;">
            <div class="location-role-stat-cell">
              <span class="location-role-stat-label">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path d="M3 21h18"/>
                  <path d="M3 7v14"/>
                  <path d="M21 7v14"/>
                  <path d="M6 21V11"/>
                  <path d="M10 21V11"/>
                  <path d="M14 21V11"/>
                  <path d="M18 21V11"/>
                  <path d="M2 7l10-4 10 4"/>
                </svg>
                BRANCH STORES
              </span>
              <span class="location-role-stat-val">${storeCount} ${storeCount === 1 ? 'Store' : 'Stores'}</span>
            </div>

            <div class="location-role-stat-cell">
              <span class="location-role-stat-label">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="8.5" cy="7" r="4"/>
                </svg>
                MANAGERS
              </span>
              <span class="location-role-stat-val">${mgrCount} Assigned</span>
            </div>

            <div class="location-role-stat-cell">
              <span class="location-role-stat-label">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                STAFF ROLES
              </span>
              <span class="location-role-stat-val">${staffCount} Employees</span>
            </div>
          </div>
        </div>

        <!-- Footer: View Branches Button -->
        <div class="location-card-footer">
          <span class="location-footer-note">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            ${totalRoles} Total Personnel Roles
          </span>
          <button type="button" class="btn-view-branches" onclick="window.openLocationBranches('${escapeJs(loc.key)}')">
            <span>View Branches</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="5" y1="12" x2="19" y2="12"/>
              <polyline points="12 5 19 12 12 19"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}
window.renderLocationDividers = renderLocationDividers;

// ==========================================================================
// 2. OPEN LOCATION BRANCHES POPUP MODAL (Small boxes, no revenue)
// ==========================================================================
window.openLocationBranches = function (locKey) {
  currentViewingLocKey = locKey;
  const modal = document.getElementById('locationStoresModal');
  if (!modal) return;

  const grouped = getStoresByLocation();
  const loc = grouped[locKey] || {
    name: 'BRANCH LOCATION',
    subtext: 'Regional Stores Network',
    stores: []
  };

  const titleEl = document.getElementById('locModalTitle');
  if (titleEl) titleEl.textContent = `${loc.name} - Branch Stores`;

  const subEl = document.getElementById('locModalSubtitle');
  if (subEl) subEl.textContent = `${loc.subtext.toUpperCase()} • SELECT A STORE TO VIEW PERSONNEL & ROLES`;

  const grid = document.getElementById('locStoresGrid');
  if (grid) {
    if (loc.stores.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 36px 20px; text-align: center; color: #94A3B8;">
          No registered branch stores found for this location.
        </div>
      `;
    } else {
      grid.innerHTML = loc.stores.map(store => {
        const mgrCount = (store.managers || []).length;
        const staffCount = (store.staff || []).length;
        const totalCount = mgrCount + staffCount;

        return `
          <div class="small-store-box" onclick="window.openStoreDetails('${escapeJs(store.id)}', '${escapeJs(locKey)}')">
            <div class="small-store-header">
              <div class="small-store-brand">
                <div class="small-store-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                    <polyline points="9 22 9 12 15 12 15 22"/>
                  </svg>
                </div>
                <div class="small-store-titles">
                  <h4 class="small-store-name">${escapeHtml(store.name)}</h4>
                  <span class="small-store-category">${escapeHtml(store.category || 'MSME Branch Store')}</span>
                </div>
              </div>
              <span class="branch-card-status-badge">
                <span class="badge-dot"></span>ACTIVE
              </span>
            </div>

            <!-- Role Counts Inset Grid -->
            <div class="small-store-role-counts">
              <div class="small-store-role-cell">
                <span class="small-store-role-label">MANAGERS</span>
                <span class="small-store-role-val">${mgrCount} Assigned</span>
              </div>
              <div class="small-store-role-cell">
                <span class="small-store-role-label">STAFF ROSTER</span>
                <span class="small-store-role-val">${staffCount} Staff</span>
              </div>
              <div class="small-store-role-cell">
                <span class="small-store-role-label">TOTAL ROLES</span>
                <span class="small-store-role-val">${totalCount} Roles</span>
              </div>
            </div>

            <div class="small-store-footer">
              <span style="font-size: 11.5px; color: #64748B;">Code: ${escapeHtml(store.code)}</span>
              <span class="small-store-action-text">
                <span>View Personnel List</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <line x1="5" y1="12" x2="19" y2="12"/>
                  <polyline points="12 5 19 12 12 19"/>
                </svg>
              </span>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  modal.classList.add('active');
};

window.closeLocationStoresModal = function () {
  const modal = document.getElementById('locationStoresModal');
  if (modal) modal.classList.remove('active');
};

// ==========================================================================
// 3. STORE DETAILS MODAL (Separate role tables, NO revenue)
// ==========================================================================
window.openStoreDetails = function (storeId, fromLocKey) {
  // Hide location popup while viewing detailed personnel list
  window.closeLocationStoresModal();

  const stores = getStoresData();
  const store = stores[storeId];
  if (!store) return;

  currentViewingStoreId = storeId;
  currentViewingLocKey = fromLocKey || store.locKey;

  const modal = document.getElementById('storeDetailsModal');
  if (!modal) return;

  // Header Title
  const titleEl = document.getElementById('modalStoreTitle');
  if (titleEl) titleEl.textContent = `${store.name} (${store.code})`;

  const subEl = document.getElementById('modalStoreSubtitle');
  if (subEl) subEl.textContent = `${(store.location || 'STORE LOCATION').toUpperCase()} • AUTHORIZED PERSONNEL ROSTER`;

  const managers = store.managers || [];
  const staff = store.staff || [];
  const totalPersonnel = managers.length + staff.length;

  // Summary Tiles (Strictly Role Counts, NO revenue)
  const mgrValEl = document.getElementById('modalKpiManagersVal');
  if (mgrValEl) mgrValEl.textContent = managers.length === 1 ? '1 Assigned' : `${managers.length} Assigned`;

  const staffValEl = document.getElementById('modalKpiStaffVal');
  if (staffValEl) staffValEl.textContent = staff.length === 1 ? '1 Employee' : `${staff.length} Employees`;

  const totalRolesEl = document.getElementById('modalKpiOutputVal') || document.getElementById('modalKpiTotalPersonnelVal');
  if (totalRolesEl) totalRolesEl.textContent = `${totalPersonnel} Authorized Roles`;

  const statusValEl = document.getElementById('modalKpiRevenueVal') || document.getElementById('modalKpiStatusVal');
  if (statusValEl) {
    statusValEl.textContent = 'Active & Synced';
    statusValEl.classList.remove('highlight-revenue');
  }

  // Section 1: Branch Managers Table
  const mgrCountBadge = document.getElementById('modalMgrCountBadge');
  if (mgrCountBadge) mgrCountBadge.textContent = managers.length;

  const mgrTbody = document.getElementById('modalManagersTbody');
  if (mgrTbody) {
    if (managers.length === 0) {
      mgrTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #94A3B8; padding: 20px;">No managers currently assigned.</td></tr>`;
    } else {
      mgrTbody.innerHTML = managers.map(m => `
        <tr>
          <td>
            <div class="role-user-cell">
              <div class="role-avatar-chip">${escapeHtml(m.initials || getInitials(m.name))}</div>
              <span class="role-user-name">${escapeHtml(m.name)}</span>
            </div>
          </td>
          <td><span class="role-username-text">${escapeHtml(m.username || m.name.toLowerCase().replace(/\\s+/g, '_'))}</span></td>
          <td><span class="role-email-text">${escapeHtml(m.email)}</span></td>
          <td>
            <span class="role-status-approved">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              ${escapeHtml(m.status || 'APPROVED')}
            </span>
          </td>
        </tr>
      `).join('');
    }
  }

  // Section 2: Branch Staff & Employees Table (with Access Codes)
  const staffCountBadge = document.getElementById('modalStaffCountBadge');
  if (staffCountBadge) staffCountBadge.textContent = staff.length;

  const staffTbody = document.getElementById('modalStaffTbody');
  if (staffTbody) {
    if (staff.length === 0) {
      staffTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #94A3B8; padding: 20px;">No staff members currently assigned.</td></tr>`;
    } else {
      staffTbody.innerHTML = staff.map(s => `
        <tr>
          <td>
            <div class="role-user-cell">
              <div class="role-avatar-chip staff-chip">${escapeHtml(s.initials || getInitials(s.name) || 'ST')}</div>
              <span class="role-user-name">${escapeHtml(s.name)}</span>
            </div>
          </td>
          <td><span class="role-username-text">${escapeHtml(s.username || s.name.toLowerCase().replace(/\\s+/g, '_'))}</span></td>
          <td><span class="role-email-text">${escapeHtml(s.email)}</span></td>
          <td>
            <span class="access-code-badge" title="Authorization Access Code">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="7.5" cy="15.5" r="5.5"/>
                <path d="M11.5 11.5L22 1"/>
                <path d="M18 5l2 2"/>
                <path d="M15 8l2 2"/>
              </svg>
              ${escapeHtml(s.accessCode || '—')}
            </span>
          </td>
          <td>
            <span class="role-status-approved">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              ${escapeHtml(s.status || 'APPROVED')}
            </span>
          </td>
        </tr>
      `).join('');
    }
  }

  modal.classList.add('active');
};

window.closeStoreDetails = function () {
  const modal = document.getElementById('storeDetailsModal');
  if (modal) modal.classList.remove('active');
};

// Back to location branches popup
window.backToLocationBranches = function () {
  window.closeStoreDetails();
  if (currentViewingLocKey) {
    window.openLocationBranches(currentViewingLocKey);
  }
};

// ==========================================================================
// 4. DESTRUCTIVE BRANCH DELETION
// ==========================================================================
window.deleteBranchStore = function () {
  if (!currentViewingStoreId) return;

  const stores = getStoresData();
  const store = stores[currentViewingStoreId];
  if (!store) return;

  const confirmMsg = `Are you sure you want to permanently delete "${store.name}"?\\n\\nThis will revoke credentials for ${store.managers.length} manager(s) and ${store.staff.length} staff member(s).`;
  if (!confirm(confirmMsg)) return;

  const deletedId = currentViewingStoreId;
  delete stores[currentViewingStoreId];
  saveStoresData(stores);

  import('../supabase/admin-supabase-service.js')
    .then(srv => srv.deleteBranchStore(deletedId))
    .catch(() => {});

  window.closeStoreDetails();

  // Refresh Location Dividers in Branch Module
  renderLocationDividers('locationDividersContainer');

  // If location modal was open, refresh it or return to it
  if (currentViewingLocKey) {
    window.openLocationBranches(currentViewingLocKey);
  }

  if (window.showAdminToast) {
    window.showAdminToast(`Deleted branch store "${store.name}" and revoked access credentials.`, 'danger');
  }
};

// ==========================================================================
// 5. ADD BRANCH STORE SUBMISSION
// ==========================================================================
window.submitAddBranch = function () {
  const locSelect = document.getElementById('branchLocationSelect');
  const locSelectVal = locSelect ? locSelect.value : 'custom';
  const customLocName = (document.getElementById('customLocationName')?.value || '').trim();
  const name = (document.getElementById('branchName')?.value || '').trim();
  const code = (document.getElementById('branchCode')?.value || '').trim();
  const category = (document.getElementById('branchCategory')?.value || '').trim();
  const manager = (document.getElementById('branchManager')?.value || '').trim();

  if (!name || !code || !manager) {
    if (window.showAdminToast) window.showAdminToast('Please complete all required fields.', 'danger');
    return;
  }

  if (locSelectVal === 'custom' && !customLocName) {
    if (window.showAdminToast) window.showAdminToast('Please enter the new municipality or location name.', 'danger');
    return;
  }

  const locKey = locSelectVal === 'custom'
    ? customLocName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'newloc'
    : locSelectVal;
  const selectedOptionText = (locSelect && locSelect.options && locSelect.selectedIndex >= 0)
    ? locSelect.options[locSelect.selectedIndex].textContent.trim()
    : '';
  const locLabel = locSelectVal === 'custom'
    ? (customLocName || 'Unassigned')
    : (selectedOptionText || locSelectVal);

  const storeId = `store-${Date.now()}`;
  const managerInitials = getInitials(manager);
  const managerUsername = manager.toLowerCase().replace(/\s+/g, '_');

  const newStore = {
    id: storeId,
    name: name,
    code: code,
    location: locLabel,
    locKey: locKey,
    category: category || 'MSME Retail & Production Hub',
    status: 'ACTIVE',
    managers: [
      {
        name: manager,
        username: managerUsername,
        initials: managerInitials,
        email: `${managerUsername}@store.ph`,
        role: 'Manager',
        status: 'APPROVED'
      }
    ],
    staff: []
  };

  const stores = getStoresData();
  stores[storeId] = newStore;
  saveStoresData(stores);

  const addModal = document.getElementById('addBranchModal');
  if (addModal) addModal.classList.remove('active');
  const form = document.getElementById('addBranchForm');
  if (form) form.reset();

  renderLocationDividers('locationDividersContainer');

  if (window.showAdminToast) {
    window.showAdminToast(`Registered new branch store "${name}" (${code}) successfully!`);
  }
};

// Backward compatibility helper
export function renderBranchStoresCards(containerId, options = {}) {
  // If invoked with a location dividers container, forward to renderLocationDividers
  if (containerId === 'locationDividersContainer' || containerId === 'overviewLocationDividersContainer') {
    renderLocationDividers(containerId);
    return;
  }
}
window.renderBranchStoresCards = renderBranchStoresCards;

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  renderLocationDividers('locationDividersContainer');

  // Modal Close buttons
  const btnCloseLocModal = document.getElementById('btnCloseLocModal');
  if (btnCloseLocModal) {
    btnCloseLocModal.addEventListener('click', () => window.closeLocationStoresModal());
  }

  const btnCloseStoreModal = document.getElementById('btnCloseStoreModal');
  if (btnCloseStoreModal) {
    btnCloseStoreModal.addEventListener('click', () => window.closeStoreDetails());
  }

  // Add Branch Modal openers & closers
  const btnOpenAdd = document.getElementById('btnOpenAddBranch');
  const addModal = document.getElementById('addBranchModal');
  const btnCloseAdd = document.getElementById('btnCloseAddBranch');
  const btnCancelAdd = document.getElementById('btnCancelAddBranch');
  const locSelect = document.getElementById('branchLocationSelect');
  const customLocGroup = document.getElementById('customLocationGroup');

  // Dynamically populate location dropdown in Add Branch Modal
  function populateAddBranchLocations() {
    if (!locSelect) return;
    const current = locSelect.value;
    const locations = new Map();

    // Add locations from existing stores
    const stores = getStoresData();
    Object.values(stores).forEach(s => {
      const loc = (s.location || '').trim();
      const key = (s.locKey || s.locationKey || loc.toLowerCase().replace(/[^a-z0-9]/g, '')).trim();
      if (key && loc) locations.set(key, loc);
    });

    // Add locations from registered users
    try {
      const users = JSON.parse(localStorage.getItem('rmims_registered_users') || '[]');
      users.forEach(u => {
        const loc = (u.branchLoc || '').trim();
        const key = loc.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (key && loc) locations.set(key, loc);
      });
    } catch (_) {}

    locSelect.innerHTML = '';

    const placeholderOpt = document.createElement('option');
    placeholderOpt.value = '';
    placeholderOpt.disabled = true;
    placeholderOpt.textContent = 'Select Location / Municipality';
    locSelect.appendChild(placeholderOpt);

    locations.forEach((label, key) => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = label;
      locSelect.appendChild(opt);
    });

    const customOpt = document.createElement('option');
    customOpt.value = 'custom';
    customOpt.textContent = '+ Add New Municipality / Location';
    locSelect.appendChild(customOpt);

    if (current && locations.has(current)) {
      locSelect.value = current;
    } else if (locations.size === 0) {
      locSelect.value = 'custom';
      if (customLocGroup) customLocGroup.style.display = 'block';
    } else {
      locSelect.value = '';
    }
  }

  populateAddBranchLocations();

  if (btnOpenAdd && addModal) {
    btnOpenAdd.addEventListener('click', () => {
      populateAddBranchLocations();
      addModal.classList.add('active');
    });
  }
  if (btnCloseAdd && addModal) {
    btnCloseAdd.addEventListener('click', () => addModal.classList.remove('active'));
  }
  if (btnCancelAdd && addModal) {
    btnCancelAdd.addEventListener('click', () => addModal.classList.remove('active'));
  }

  if (locSelect && customLocGroup) {
    locSelect.addEventListener('change', (e) => {
      customLocGroup.style.display = e.target.value === 'custom' ? 'block' : 'none';
    });
  }

  // Backdrop clicks
  const locModal = document.getElementById('locationStoresModal');
  const storeModal = document.getElementById('storeDetailsModal');
  window.addEventListener('click', (e) => {
    if (e.target === locModal) window.closeLocationStoresModal();
    if (e.target === storeModal) window.closeStoreDetails();
    if (e.target === addModal) addModal.classList.remove('active');
  });

  // Asynchronously query Supabase for registered branch stores
  import('../supabase/admin-supabase-service.js')
    .then(srv => {
      srv.fetchBranchStores().then(remoteStores => {
        if (remoteStores && typeof remoteStores === 'object') {
          const clean = {};
          Object.entries(remoteStores).forEach(([id, st]) => {
            if (!isMockStore(st)) clean[id] = st;
          });
          saveStoresData(clean);
          renderLocationDividers('locationDividersContainer');
        }
      }).catch(() => {});

      if (typeof srv.subscribeToAdminFeed === 'function') {
        srv.subscribeToAdminFeed(({ table }) => {
          if (table === 'branch_stores' || table === 'branch_store_personnel') {
            srv.fetchBranchStores().then(remoteStores => {
              if (remoteStores && typeof remoteStores === 'object') {
                const clean = {};
                Object.entries(remoteStores).forEach(([id, st]) => {
                  if (!isMockStore(st)) clean[id] = st;
                });
                saveStoresData(clean);
                renderLocationDividers('locationDividersContainer');
              }
            }).catch(() => {});
          }
        });
      }
    })
    .catch(() => {});
});

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeJs(str) {
  return String(str || '')
    .replace(/\\\\/g, '\\\\\\\\')
    .replace(/'/g, "\\\\'")
    .replace(/"/g, '\\\\"');
}

window.addEventListener('rmims_registered_users_updated', () => {
  const stores = getStoresData();
  saveStoresData(stores);
  renderLocationDividers('locationDividersContainer');
});


// Inter-tab and cross-module instant real-time synchronization
try {
  const bc = new BroadcastChannel('rmims_user_sync');
  bc.onmessage = () => {
    const stores = getStoresData();
    renderLocationDividers('locationDividersContainer');
  };
} catch (_) {}

window.addEventListener('rmims_stores_updated', () => {
  renderLocationDividers('locationDividersContainer');
});
