// RMIMS Admin User Management Controller
// Handles pending approvals, active users directory, add/edit/delete user workflows,
// dynamic counters, search filtering, and pagination.

document.addEventListener('DOMContentLoaded', () => {
  let adminSrv = null;

  // Modal Elements
  const addModal = document.getElementById('addUserModal');
  const btnOpenAdd = document.getElementById('btnOpenAddUser');
  const btnCloseAdd = document.getElementById('btnCloseAddUser');
  const btnCancelAdd = document.getElementById('btnCancelAddUser');
  const addForm = document.getElementById('addUserForm');

  const editModal = document.getElementById('editUserModal');
  const btnCloseEdit = document.getElementById('btnCloseEditUser');
  const btnCancelEdit = document.getElementById('btnCancelEditUser');
  const editForm = document.getElementById('editUserForm');

  // Directory Filters & Tables
  const branchFilter = document.getElementById('branchDirectoryFilter');
  const searchInput = document.getElementById('dirSearchInput');
  const topSearch = document.getElementById('topSearchInput');
  const dirTable = document.getElementById('usersDirectoryTable');
  const pendingTable = document.getElementById('pendingTable');

  // KPI Elements
  const statTotal = document.getElementById('statTotalUsers');
  const statActive = document.getElementById('statActiveUsers');
  const statPending = document.getElementById('statPendingUsers');
  const statInactive = document.getElementById('statInactiveUsers') || document.getElementById('statInactive');
  const pendingBadge = document.getElementById('pendingCount');
  const paginationCounter = document.getElementById('userPaginationCounter');

  // Helper: Extract Initials from Name
  function getInitials(name) {
    if (!name) return 'U';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function getLiveTodayISO() {
    return new Date().toISOString().split('T')[0];
  }

  function formatDisplayDate(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso.includes('T') ? iso : (iso + 'T00:00:00'));
      return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (_) {
      return iso;
    }
  }

  const BANNED_MOCK_USER_TOKENS = [
    'maria santos', 'kenneth ramos', 'rafael cruz', 'alyssa lim', 'carla mendoza',
    'carlos mendoza', 'victor morales', 'ethan cruz', 'sarah gomez', 'mark villanueva'
  ];

  function isMockUser(u) {
    if (!u) return false;
    const txt = `${u.name || ''} ${u.username || ''} ${u.email || ''} ${u.branchName || ''}`.toLowerCase();
    const role = String(u.role || '').toLowerCase();
    // Aizel does not have a staff account; purge any dump staff accounts for Aizel
    if (txt.includes('aizel') && (role.includes('staff') || role.includes('user'))) return true;
    return BANNED_MOCK_USER_TOKENS.some(tok => txt.includes(tok));
  }

  function cleanPendingFromRegisteredDirectory() {
    try {
      const rawReg = localStorage.getItem('rmims_registered_users');
      if (!rawReg) return;
      const regList = JSON.parse(rawReg);
      if (!Array.isArray(regList)) return;

      let approvedKeys = [];
      try {
        approvedKeys = JSON.parse(localStorage.getItem('rmims_approved_users') || '[]');
        if (!Array.isArray(approvedKeys)) approvedKeys = [];
      } catch (_) {}

      const pendingFromReg = [];
      const cleanReg = [];

      regList.forEach(u => {
        if (!u) return;
        const uEmail = (u.email || '').toLowerCase().trim();
        const uUser = (u.username || '').toLowerCase().trim();
        const uId = String(u.id || '').trim();
        const uName = (u.name || '').toLowerCase().trim();

        const isApproved = approvedKeys.some(a => 
          (uEmail && a.email && a.email.toLowerCase().trim() === uEmail) ||
          (uUser && a.username && a.username.toLowerCase().trim() === uUser) ||
          (uId && a.id && String(a.id).trim() === uId) ||
          (uName && a.name && a.name.toLowerCase().trim() === uName)
        );

        if (isApproved) {
          u.status = 'Active';
          cleanReg.push(u);
          return;
        }

        const s = String(u.status || '').toLowerCase().trim();
        if (s === 'pending' || s === 'pending_approval') {
          pendingFromReg.push(u);
        } else {
          cleanReg.push(u);
        }
      });

      if (pendingFromReg.length > 0) {
        // Move unapproved users to pending queue
        const rawPending = localStorage.getItem('rmims_pending_users');
        const pendingList = rawPending ? JSON.parse(rawPending) : [];
        pendingFromReg.forEach(pu => {
          const exists = pendingList.some(p => 
            (p.id && pu.id && String(p.id) === String(pu.id)) ||
            (p.email && pu.email && p.email.toLowerCase() === pu.email.toLowerCase()) ||
            (p.username && pu.username && p.username.toLowerCase() === pu.username.toLowerCase())
          );
          if (!exists) {
            pendingList.push({
              ...pu,
              status: 'Pending',
              requestedOn: pu.created_at || pu.requestedOn || new Date().toISOString()
            });
          }
        });
        localStorage.setItem('rmims_pending_users', JSON.stringify(pendingList));
        localStorage.setItem('rmims_registered_users', JSON.stringify(cleanReg));
        window.dispatchEvent(new Event('rmims_pending_users_updated'));
        window.dispatchEvent(new Event('rmims_registered_users_updated'));
      }
    } catch (_) {}
  }

  // Self-heal on module load
  cleanPendingFromRegisteredDirectory();

  const AUTHENTIC_INITIAL_PENDING_USERS = [];

  function getStoredPendingUsers() {
    try {
      const raw = localStorage.getItem('rmims_pending_users');
      if (raw === null) {
        const list = [...AUTHENTIC_INITIAL_PENDING_USERS];
        localStorage.setItem('rmims_pending_users', JSON.stringify(list));
        return list;
      }
      let list = JSON.parse(raw);
      if (Array.isArray(list)) {
        return list.filter(u => !isMockUser(u));
      }
      return [];
    } catch (_) {
      return [];
    }
  }

  function saveStoredPendingUsers(users) {
    try {
      localStorage.setItem('rmims_pending_users', JSON.stringify(users));
      window.dispatchEvent(new Event('rmims_pending_users_updated'));
      window.dispatchEvent(new Event('storage'));
    } catch (e) {
      console.warn('Failed saving pending users:', e);
    }
  }

  const MASTER_ADMIN_RECORD = {
    id: '66041f5a-ce74-4866-bfcc-b0d05014f13b',
    name: 'Zeanna',
    username: 'zeanna',
    email: 'calusinzeanna3@gmail.com',
    branchLoc: 'Headquarters',
    branchName: 'Headquarters',
    role: 'Administrator',
    status: 'Active',
    created_at: new Date().toISOString()
  };

  const AUTHENTIC_INITIAL_REGISTERED_USERS = [
    MASTER_ADMIN_RECORD,
    {
      id: '8436c433-268c-4d72-9e8c-f4dfdb1692f3',
      name: 'Aizel',
      username: 'Scones_manager',
      email: 'zeannapatty@gmail.com',
      branchLoc: 'Lucena',
      branchName: 'Scones & Muffins Bakery',
      role: 'Store Manager',
      status: 'Active',
      created_at: '2026-10-16T02:28:41.885691+00:00'
    },
    {
      id: 'c99c9757-de31-4dbc-89da-005fdd9eed35',
      name: 'Staff_1',
      username: 'Scones_Staff_1',
      email: 'Sconesandmuffins@gmail.com',
      branchLoc: 'Lucena',
      branchName: 'Scones & Muffins Bakery',
      role: 'Staff Personnel',
      status: 'Active',
      created_at: '2026-10-16T04:59:34.011697+00:00'
    },
    {
      id: 'b7173051-b383-4b51-be77-4f4f3e79a900',
      name: 'Glazel',
      username: 'Glazel_Kxc',
      email: 'zeannapatricia@gmail.com',
      branchLoc: 'Tiaong',
      branchName: 'KXC 5-Year Enterprise',
      role: 'Store Manager',
      status: 'Active',
      created_at: '2026-10-16T03:38:10.858827+00:00'
    }
  ];

  function getStoredRegisteredUsers() {
    try {
      const raw = localStorage.getItem('rmims_registered_users');
      if (raw === null) {
        const initial = [...AUTHENTIC_INITIAL_REGISTERED_USERS];
        localStorage.setItem('rmims_registered_users', JSON.stringify(initial));
        return initial;
      }
      let list = JSON.parse(raw);
      if (!Array.isArray(list)) list = [];
      list = list.filter(u => !isMockUser(u));

      // Strictly exclude any pending or unapproved accounts
      list = list.filter(u => {
        if (!u) return false;
        const s = String(u.status || '').toLowerCase().trim();
        return s !== 'pending' && s !== 'pending_approval';
      });

      // Ensure Master Admin Zeanna is present with Headquarters location (separate from the two store companies)
      list = list.map(u => {
        if (!u) return u;
        const role = String(u.role || '').toLowerCase();
        const email = String(u.email || '').toLowerCase();
        const name = String(u.name || '').toLowerCase();
        const user = String(u.username || '').toLowerCase();
        if (role === 'administrator' || role === 'admin' || email === 'calusinzeanna3@gmail.com' || name === 'zeanna' || user === 'zeanna' || user === 'calusinzeanna3') {
          return {
            ...u,
            branchLoc: 'Headquarters',
            branchName: 'Headquarters',
            role: 'Administrator'
          };
        }
        return u;
      });

      const hasAdmin = list.some(u => 
        (u.email && u.email.toLowerCase() === 'calusinzeanna3@gmail.com') ||
        (u.name && u.name.toLowerCase() === 'zeanna')
      );
      if (!hasAdmin) {
        list.unshift(MASTER_ADMIN_RECORD);
      }

      return list;
    } catch (_) {
      return [...AUTHENTIC_INITIAL_REGISTERED_USERS];
    }
  }

  function saveStoredRegisteredUsers(users) {
    try {
      let list = Array.isArray(users) ? [...users] : [];
      // Never store pending accounts in registered users
      list = list.filter(u => {
        if (!u) return false;
        const s = String(u.status || '').toLowerCase().trim();
        return s !== 'pending' && s !== 'pending_approval';
      });

      const hasRealAdmin = list.some(u => 
        (u.email && u.email.toLowerCase() === 'calusinzeanna3@gmail.com') ||
        (u.username && u.username.toLowerCase() === 'zeanna') ||
        (u.name && u.name.toLowerCase() === 'zeanna')
      );
      if (!hasRealAdmin) {
        list.unshift({ ...MASTER_ADMIN_RECORD });
      }
      localStorage.setItem('rmims_registered_users', JSON.stringify(list));
      window.dispatchEvent(new Event('rmims_registered_users_updated'));
      window.dispatchEvent(new Event('storage'));
    } catch (e) {
      console.warn('Failed saving registered users:', e);
    }
  }

  function renderPendingUsers() {
    const tbody = document.getElementById('pendingTableBody') || (pendingTable ? pendingTable.querySelector('tbody') : null);
    if (!tbody) return;

    const list = getStoredPendingUsers();
    if (list.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 36px 16px; color: var(--rm-ink-dim);">
            <div style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color: #94A3B8;">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="8.5" cy="7" r="4"/>
                <polyline points="17 11 19 13 23 9"/>
              </svg>
              <span style="font-size: 13.5px; font-weight: 500; color: var(--rm-ink);">No pending account requests awaiting approval</span>
              <span style="font-size: 12px; color: #94A3B8;">Branch personnel registrations requiring admin validation will appear here.</span>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = list.map(u => {
      const initials = getInitials(u.name);
      const rowId = `req_${u.id}`;
      const requestedDate = u.requestedOn ? (u.requestedOn.includes('T') ? formatDisplayDate(u.requestedOn) : u.requestedOn) : formatDisplayDate(getLiveTodayISO());

      return `
        <tr id="${rowId}" data-id="${escapeHtml(u.id)}" data-name="${escapeHtml(u.name)}" data-username="${escapeHtml(u.username || '')}" data-branch-loc="${escapeHtml(u.branchLoc || '')}" data-branch-name="${escapeHtml(u.branchName || '')}" data-role="${escapeHtml(u.role || 'Staff')}" data-email="${escapeHtml(u.email || '')}">
          <td>
            <div class="user-cell">
              <div class="user-initial-chip">${initials}</div>
              <strong>${escapeHtml(u.name)}</strong>
            </div>
          </td>
          <td>${getLocationBadgeHtml(u.branchLoc)}</td>
          <td>${escapeHtml(u.branchName || '—')}</td>
          <td>${escapeHtml(u.role || 'Staff')}</td>
          <td>${escapeHtml(requestedDate)}</td>
          <td><span class="status-pill status-pending">Pending</span></td>
          <td>
            <div class="action-btn-group">
              <button type="button" class="btn-approve" onclick="approveUser('${escapeJs(u.id)}')">Approve</button>
              <button type="button" class="btn-reject" onclick="rejectUser('${escapeJs(u.id)}')">Reject</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function populateBranchDirectoryFilter(users = []) {
    if (!branchFilter) return;
    const current = branchFilter.value;
    const branches = new Set();

    users.forEach(u => {
      if (u.branchName && u.branchName.trim()) branches.add(u.branchName.trim());
    });

    try {
      const stores = JSON.parse(localStorage.getItem('RMIMS_BRANCH_STORES_V3') || '{}');
      Object.values(stores).forEach(s => {
        if (s.name && s.name.trim()) branches.add(s.name.trim());
      });
    } catch (_) {}

    branchFilter.querySelectorAll('option.dynamic-branch').forEach(o => o.remove());

    Array.from(branches).sort().forEach(bName => {
      const opt = document.createElement('option');
      opt.value = bName.toLowerCase();
      opt.textContent = bName;
      opt.className = 'dynamic-branch';
      branchFilter.appendChild(opt);
    });

    if (current && (current === 'all' || branches.has(current) || Array.from(branches).some(b => b.toLowerCase() === current.toLowerCase()))) {
      branchFilter.value = current;
    }
  }

  let currentUserPage = 1;
  const USERS_PER_PAGE = 8;

  function renderRegisteredUsers() {
    const tbody = document.getElementById('usersDirectoryTableBody') || (dirTable ? dirTable.querySelector('tbody') : null);
    if (!tbody) return;

    const users = getStoredRegisteredUsers();
    populateBranchDirectoryFilter(users);
    const branchVal = branchFilter ? branchFilter.value : 'all';
    const query = (searchInput ? searchInput.value : '').toLowerCase().trim();

    const filtered = users.filter(u => {
      const loc = (u.branchLoc || u.branch || '').toLowerCase();
      const name = (u.branchName || '').toLowerCase();
      const branchMatch = branchVal === 'all' || loc === branchVal.toLowerCase() || name.includes(branchVal.toLowerCase());
      const searchHaystack = `${u.name || ''} ${u.username || ''} ${u.email || ''} ${loc} ${name} ${u.role || ''}`.toLowerCase();
      const searchMatch = !query || searchHaystack.includes(query);
      return branchMatch && searchMatch;
    });

    if (filtered.length === 0) {
      if (users.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="7" style="text-align: center; padding: 48px 16px; color: var(--rm-ink-dim);">
              <div style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color: #94A3B8;">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                <span style="font-size: 14px; font-weight: 600; color: var(--rm-ink);">No Registered Store Users Found</span>
                <span style="font-size: 12px; color: #94A3B8;">Click "+ Add User" to register branch managers and staff personnel.</span>
              </div>
            </td>
          </tr>
        `;
      } else {
        tbody.innerHTML = `
          <tr>
            <td colspan="7" style="text-align: center; padding: 32px 16px; color: var(--rm-ink-dim);">
              No users found matching your search and filter criteria.
            </td>
          </tr>
        `;
      }
      if (paginationCounter) {
        paginationCounter.textContent = 'Showing 0 of 0 active users';
      }
      buildPaginationButtons(0, USERS_PER_PAGE);
      return;
    }

    const totalPages = Math.max(1, Math.ceil(filtered.length / USERS_PER_PAGE));
    if (currentUserPage > totalPages) currentUserPage = totalPages;
    if (currentUserPage < 1) currentUserPage = 1;
    const startIdx = (currentUserPage - 1) * USERS_PER_PAGE;
    const endIdx = Math.min(startIdx + USERS_PER_PAGE, filtered.length);
    const pageUsers = filtered.slice(startIdx, endIdx);

    if (paginationCounter) {
      paginationCounter.textContent = `Showing ${filtered.length > 0 ? startIdx + 1 : 0} to ${endIdx} of ${filtered.length} active users`;
    }
    buildPaginationButtons(filtered.length, USERS_PER_PAGE);

    tbody.innerHTML = pageUsers.map(u => {
      const initials = getInitials(u.name);
      const loc = u.branchLoc || '';
      const bName = u.branchName || 'Unknown Branch';
      const role = u.role || 'Staff';
      const status = u.status || 'Active';
      const email = u.email || `${u.username || 'user'}@store.ph`;

      return `
        <tr data-branch="${escapeHtml(loc)}" data-branch-loc="${escapeHtml(loc)}" data-branch-name="${escapeHtml(bName)}" data-id="${escapeHtml(u.id)}">
          <td>
            <div class="user-cell">
              <div class="user-initial-chip">${initials}</div>
              <div>
                <strong>${escapeHtml(u.name)}</strong>
                <div class="user-subtext">${escapeHtml(u.username || '')}</div>
              </div>
            </div>
          </td>
          <td>${escapeHtml(email)}</td>
          <td>${getLocationBadgeHtml(loc)}</td>
          <td>${escapeHtml(bName)}</td>
          <td>${escapeHtml(role)}</td>
          <td>
            <span class="status-pill status-approved">
              <span class="status-dot"></span>${escapeHtml(status)}
            </span>
          </td>
          <td>
            <div class="action-btn-group">
              <button type="button" class="btn-edit" onclick="openEditUser('${escapeJs(u.id)}', '${escapeJs(u.name)}', '${escapeJs(u.username || '')}', '${escapeJs(email)}', '${escapeJs(loc)}', '${escapeJs(bName)}', '${escapeJs(role)}')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
                <span>Edit</span>
              </button>
              ${(u.role === 'Administrator' || u.role === 'admin' || (u.email && u.email.toLowerCase() === 'calusinzeanna3@gmail.com') || (u.username && u.username.toLowerCase() === 'zeanna')) ? `
                <button type="button" class="btn-delete" style="opacity:0.45; cursor:not-allowed;" title="Main Admin account is permanently protected" disabled>Protected</button>
              ` : `
                <button type="button" class="btn-delete" onclick="deleteUser('${escapeJs(u.id)}', '${escapeJs(u.name)}')">Delete</button>
              `}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    if (paginationCounter) {
      paginationCounter.textContent = `Showing 1 to ${filtered.length} of ${filtered.length} active users`;
    }
    buildPaginationButtons(filtered.length, 10);
  }

  // Update Counters Dynamically from Live Data
  function refreshCounters() {
    const registered = getStoredRegisteredUsers();
    const totalActive = registered.filter(u => u.status === 'Active' || !u.status).length;
    const inactiveCount = registered.filter(u => u.status === 'Inactive').length;

    // Check pending count from storage
    const pendingList = getStoredPendingUsers();
    const pendingRows = pendingList.length;

    if (statActive) {
      statActive.textContent = totalActive;
    }
    if (statTotal) {
      statTotal.textContent = totalActive + pendingRows + inactiveCount;
    }
    if (statPending) {
      statPending.textContent = pendingRows;
    }
    if (statInactive) {
      statInactive.textContent = inactiveCount;
    }

    if (pendingBadge) {
      pendingBadge.textContent = `${pendingRows} Request${pendingRows === 1 ? '' : 's'} Pending`;
      if (pendingRows === 0) {
        pendingBadge.classList.remove('status-pending');
        pendingBadge.classList.add('status-resolved');
      } else {
        pendingBadge.classList.remove('status-resolved');
        pendingBadge.classList.add('status-pending');
      }
    }
  }

  // Modal Open / Close Handlers
  if (btnOpenAdd && addModal) {
    btnOpenAdd.addEventListener('click', () => {
      addModal.classList.add('active');
      const nameInput = document.getElementById('newUserName');
      if (nameInput) setTimeout(() => nameInput.focus(), 100);
    });
  }

  function closeAddModal() {
    if (addModal) addModal.classList.remove('active');
    if (addForm) addForm.reset();
  }

  if (btnCloseAdd) btnCloseAdd.addEventListener('click', closeAddModal);
  if (btnCancelAdd) btnCancelAdd.addEventListener('click', closeAddModal);

  function closeEditModal() {
    if (editModal) editModal.classList.remove('active');
    if (editForm) editForm.reset();
  }

  if (btnCloseEdit) btnCloseEdit.addEventListener('click', closeEditModal);
  if (btnCancelEdit) btnCancelEdit.addEventListener('click', closeEditModal);

  // Close modals on backdrop click
  window.addEventListener('click', (e) => {
    if (e.target === addModal) closeAddModal();
    if (e.target === editModal) closeEditModal();
  });

  // Directory Search & Branch Filter
  function filterDirectory() {
    renderRegisteredUsers();
  }

  if (branchFilter) branchFilter.addEventListener('change', filterDirectory);
  if (searchInput) searchInput.addEventListener('input', filterDirectory);
  if (topSearch) {
    topSearch.addEventListener('input', (e) => {
      if (searchInput) {
        searchInput.value = e.target.value;
        filterDirectory();
      }
    });
  }

  // Add User Submission
  window.submitAddUser = function () {
    const nameInput = document.getElementById('newUserName');
    const usernameInput = document.getElementById('newUserUsername');
    const branchLocInput = document.getElementById('newUserBranchLoc') || document.getElementById('newUserBranch');
    const branchNameInput = document.getElementById('newUserBranchName');
    const roleInput = document.getElementById('newUserRole');
    const emailInput = document.getElementById('newUserEmail');

    const name = nameInput ? nameInput.value.trim() : '';
    const username = usernameInput ? usernameInput.value.trim() : '';
    const branchLoc = branchLocInput ? branchLocInput.value : '';
    let branchName = branchNameInput ? branchNameInput.value.trim() : '';
    if (!branchName) {
      branchName = branchLoc ? `${branchLoc} Branch` : 'Unassigned';
    }
    const role = roleInput ? roleInput.value : 'Staff';
    const email = emailInput ? emailInput.value.trim() : '';

    if (!name || !username || !email) {
      window.showAdminToast('Please fill out all required fields.', 'danger');
      return;
    }

    const newId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `user-${Date.now()}`;
    const newUserRecord = {
      id: newId,
      name,
      username,
      email,
      branchLoc,
      branchName,
      role,
      status: 'Active'
    };
    const users = getStoredRegisteredUsers();
    users.push(newUserRecord);
    saveStoredRegisteredUsers(users);

    // Persist user account directly to Supabase user_profiles
    if (adminSrv && typeof adminSrv.createUserAccount === 'function') {
      adminSrv.createUserAccount(newUserRecord).catch(err => {
        console.warn('[AdminUserManagement] Supabase create user notice:', err.message || err);
      });
    }

    // Broadcast live notification across all portals (Admin, Manager, Staff)
    try {
      if (typeof window !== 'undefined' && typeof window.pushRMIMSNotification === 'function') {
        window.pushRMIMSNotification({
          title: `New User Created: ${name}`,
          message: `Administrator created and activated a ${role} account for ${name} at ${branchName}.`,
          category: 'Activity',
          badge: 'User Management',
          role: 'admin',
          targetRole: 'admin',
          roleScope: 'admin',
          priority: 'normal',
          targetUrl: 'admin/user-management.html',
          actor: 'Administrator'
        });
      }
    } catch (e) {}

    closeAddModal();
    renderRegisteredUsers();
    refreshCounters();
    window.showAdminToast(`Account for ${name} created and activated.`);
  };

  // Edit User Handlers
  window.openEditUser = function (id, name, username, email, branchLoc, branchName, role) {
    if (!editModal) return;
    if (role === undefined && branchName !== undefined) {
      role = branchName;
      if (branchLoc && !branchName) branchName = `${branchLoc} Branch`;
    }

    document.getElementById('editUserId').value = id;
    document.getElementById('editUserName').value = name;
    document.getElementById('editUserUsername').value = username;
    document.getElementById('editUserEmail').value = email;

    const locEl = document.getElementById('editUserBranchLoc') || document.getElementById('editUserBranch');
    if (locEl) locEl.value = branchLoc || '';

    const nameEl = document.getElementById('editUserBranchName');
    if (nameEl) nameEl.value = branchName || '';

    document.getElementById('editUserRole').value = role || 'Staff';
    editModal.classList.add('active');
  };

  window.submitEditUser = function () {
    const id = document.getElementById('editUserId').value;
    const name = document.getElementById('editUserName').value.trim();
    const username = document.getElementById('editUserUsername').value.trim();
    const branchLocInput = document.getElementById('editUserBranchLoc') || document.getElementById('editUserBranch');
    const branchNameInput = document.getElementById('editUserBranchName');
    const branchLoc = branchLocInput ? branchLocInput.value : '';
    let branchName = branchNameInput ? branchNameInput.value.trim() : '';
    if (!branchName) {
      branchName = branchLoc ? `${branchLoc} Branch` : 'Unassigned';
    }
    const role = document.getElementById('editUserRole').value;
    const email = document.getElementById('editUserEmail').value.trim();

    const updatedUser = {
      id,
      name,
      username,
      email,
      branchLoc,
      branchName,
      role
    };

    const users = getStoredRegisteredUsers();
    const userIndex = users.findIndex(u => String(u.id) === String(id));
    if (userIndex !== -1) {
      users[userIndex] = {
        ...users[userIndex],
        ...updatedUser
      };
      saveStoredRegisteredUsers(users);
    }

    // Persist user update directly to Supabase user_profiles
    if (adminSrv && typeof adminSrv.updateUserAccount === 'function') {
      adminSrv.updateUserAccount(updatedUser).catch(err => {
        console.warn('[AdminUserManagement] Supabase update user notice:', err.message || err);
      });
    }

    closeEditModal();
    renderRegisteredUsers();
    refreshCounters();
    window.showAdminToast(`Profile for ${name} updated successfully.`);
  };

  // Delete User Handler
  window.deleteUser = function (id, name) {
    const users = getStoredRegisteredUsers();
    const target = users.find(u => String(u.id) === String(id));
    const targetRole = String(target?.role || '').toLowerCase();
    const targetEmail = String(target?.email || '').toLowerCase();
    const targetName = String(name || target?.name || '').toLowerCase();
    const targetUser = String(target?.username || '').toLowerCase();

    if (
      targetRole === 'administrator' || 
      targetRole === 'admin' || 
      targetEmail === 'calusinzeanna3@gmail.com' || 
      targetName === 'zeanna' ||
      targetUser === 'zeanna'
    ) {
      if (window.showAdminToast) {
        window.showAdminToast('Main Administrator account is permanently protected and cannot be deleted.', 'danger');
      } else {
        alert('Main Administrator account is permanently protected and cannot be deleted.');
      }
      return;
    }

    if (!confirm(`Are you sure you want to delete ${name} from the active users directory?`)) {
      return;
    }

    const remaining = users.filter(u => String(u.id) !== String(id));
    saveStoredRegisteredUsers(remaining);

    // Delete user from Supabase user_profiles to permanently prevent zombie resurrection
    if (adminSrv && typeof adminSrv.deleteUserAccount === 'function') {
      adminSrv.deleteUserAccount(id, targetEmail).catch(err => {
        console.warn('[AdminUserManagement] Supabase delete user notice:', err.message || err);
      });
    }

    renderRegisteredUsers();
    refreshCounters();
    window.showAdminToast(`User ${name} has been removed.`, 'danger');
  };

  // Pending Approval Actions
  window.approveUser = async function (param) {
    const pendingList = getStoredPendingUsers();
    const cleanParam = String(param || '').trim();
    let target = pendingList.find(u => 
      String(u.id).trim() === cleanParam ||
      `req_${u.id}` === cleanParam ||
      (u.username && u.username.toLowerCase() === cleanParam.toLowerCase()) ||
      (u.email && u.email.toLowerCase() === cleanParam.toLowerCase()) ||
      (u.name && u.name.toLowerCase() === cleanParam.toLowerCase())
    );
    let row = document.getElementById(param) || document.getElementById(`req_${param}`);

    let name = target ? target.name : (row ? row.getAttribute('data-name') : 'User');
    let username = target ? target.username : (row ? row.getAttribute('data-username') : 'user');
    let branchLoc = target ? target.branchLoc : (row ? (row.getAttribute('data-branch-loc') || row.getAttribute('data-branch')) : 'Unassigned');
    let branchName = target ? target.branchName : (row ? row.getAttribute('data-branch-name') : '');
    if (!branchName) {
      branchName = branchLoc && branchLoc !== 'Unassigned' ? `${branchLoc} Branch` : 'Main Operations';
    }
    let role = target ? target.role : (row ? row.getAttribute('data-role') : 'Staff');
    let email = target ? target.email : (row ? row.getAttribute('data-email') : `${username}@store.ph`);

    const cleanEmail = (email || '').toLowerCase().trim();
    const cleanUsername = (username || '').toLowerCase().trim();
    const cleanId = String(target?.id || param || '').trim();

    // Remove from pending users matching ID, req_ID, email, or username
    const remaining = pendingList.filter(u => {
      const uId = String(u.id || '').trim();
      const uEmail = (u.email || '').toLowerCase().trim();
      const uUser = (u.username || '').toLowerCase().trim();
      return uId !== cleanId &&
             `req_${uId}` !== cleanParam &&
             !(cleanEmail && uEmail && uEmail === cleanEmail) &&
             !(cleanUsername && uUser && uUser === cleanUsername);
    });
    saveStoredPendingUsers(remaining);

    // Add or update in authoritative approved users cache
    try {
      const approvedCache = JSON.parse(localStorage.getItem('rmims_approved_users') || '[]');
      const newUserId = target && target.id ? target.id : (cleanId && !cleanId.startsWith('req_') ? cleanId : `user-${Date.now()}`);
      const appIdx = approvedCache.findIndex(a => 
        (newUserId && a.id && String(a.id).trim() === String(newUserId).trim()) ||
        (cleanEmail && a.email && a.email.toLowerCase().trim() === cleanEmail) ||
        (cleanUsername && a.username && a.username.toLowerCase().trim() === cleanUsername)
      );
      const appRecord = {
        id: newUserId,
        name: name,
        username: username,
        email: email,
        role: role,
        branchLoc: branchLoc,
        branchName: branchName,
        status: 'Active',
        approvedAt: new Date().toISOString()
      };
      if (appIdx >= 0) {
        approvedCache[appIdx] = { ...approvedCache[appIdx], ...appRecord };
      } else {
        approvedCache.push(appRecord);
      }
      localStorage.setItem('rmims_approved_users', JSON.stringify(approvedCache));
    } catch (_) {}

    // Add or update in registered users directory in storage ONLY after approval
    const regList = getStoredRegisteredUsers();
    const newUserId = target && target.id ? target.id : (cleanId && !cleanId.startsWith('req_') ? cleanId : `user-${Date.now()}`);
    const existingIndex = regList.findIndex(u => 
      (u.id && newUserId && String(u.id) === String(newUserId)) ||
      (u.email && email && u.email.toLowerCase() === email.toLowerCase()) ||
      (u.username && username && u.username.toLowerCase() === username.toLowerCase())
    );
    if (existingIndex >= 0) {
      regList[existingIndex].status = 'Active';
      if (branchLoc) regList[existingIndex].branchLoc = branchLoc;
      if (branchName) regList[existingIndex].branchName = branchName;
      if (role) regList[existingIndex].role = role;
    } else {
      regList.push({
        id: newUserId,
        name: name,
        username: username,
        email: email,
        branchLoc: branchLoc,
        branchName: branchName,
        role: role,
        status: 'Active'
      });
    }
    saveStoredRegisteredUsers(regList);

    // Broadcast live notification across all portals (Admin, Manager, Staff)
    try {
      if (typeof window !== 'undefined' && typeof window.pushRMIMSNotification === 'function') {
        window.pushRMIMSNotification({
          title: `Account Approved: ${name}`,
          message: `Administrator approved registration for ${name} (${role}) assigned to ${branchName}.`,
          category: 'Activity',
          badge: 'User Management',
          role: 'admin',
          targetRole: 'admin',
          roleScope: 'admin',
          priority: 'normal',
          targetUrl: 'admin/user-management.html',
          actor: 'Administrator'
        });
      }
    } catch (e) {}

    // Log Activity
    try {
      const act = JSON.parse(localStorage.getItem('rmims_manager_activities') || '[]');
      act.unshift({
        id: `act-${Date.now()}`,
        timestamp: new Date().toISOString(),
        date: getLiveTodayISO(),
        user: 'Admin',
        role: 'Main Admin',
        branch: branchName,
        branchLoc: branchLoc,
        branchName: branchName,
        action: 'Approved Account',
        module: 'User Management',
        details: `Approved ${role} account for ${name} (${branchName})`,
        status: 'success'
      });
      localStorage.setItem('rmims_manager_activities', JSON.stringify(act.slice(0, 50)));
    } catch (_) {}

    // Automatically register or associate branch store in RMIMS_BRANCH_STORES_V3
    try {
      const stores = JSON.parse(localStorage.getItem('RMIMS_BRANCH_STORES_V3') || '{}');
      const cleanLoc = (branchLoc && branchLoc !== 'Unassigned') ? branchLoc : 'General';
      const locKey = cleanLoc.toLowerCase().replace(/[^a-z0-9]/g, '') || 'general';
      const storeKey = branchName.toLowerCase().replace(/[^a-z0-9]/g, '_') || `store_${Date.now()}`;
      
      if (!stores[storeKey]) {
        stores[storeKey] = {
          id: storeKey,
          name: branchName,
          locKey: locKey,
          locationKey: locKey,
          locationName: branchName.toUpperCase(),
          address: branchLoc || 'Unassigned',
          managers: [],
          staff: []
        };
      }

      const isMgr = role.toLowerCase().includes('manager');
      const memberObj = {
        id: newUserId,
        name: name,
        username: username,
        email: email,
        initials: getInitials(name),
        status: 'APPROVED',
        accessCode: String(Math.floor(100000 + Math.random() * 900000))
      };

      if (isMgr) {
        if (!stores[storeKey].managers.some(m => m.email === email || m.username === username)) {
          stores[storeKey].managers.push(memberObj);
        }
      } else {
        if (!stores[storeKey].staff.some(s => s.email === email || s.username === username)) {
          stores[storeKey].staff.push(memberObj);
        }
      }

      localStorage.setItem('RMIMS_BRANCH_STORES_V3', JSON.stringify(stores));
      window.dispatchEvent(new Event('rmims_stores_updated'));
      window.dispatchEvent(new Event('storage'));
    } catch (_) {}

    renderPendingUsers();
    renderRegisteredUsers();
    refreshCounters();

    // Synchronize approval to Supabase and await confirmation
    try {
      const srv = await import('../supabase/admin-supabase-service.js');
      const syncResult = await srv.approveUserAccount({
        id: target && target.id ? target.id : newUserId,
        email: email,
        username: username,
        name: name
      });

      if (syncResult && syncResult.success) {
        if (window.showAdminToast) {
          window.showAdminToast(`Account for ${name} approved and synchronized with Supabase (Active).`, 'success');
        }
      } else {
        if (window.showAdminToast) {
          window.showAdminToast(`Account approved locally. Supabase sync notice: ${syncResult?.error || 'Awaiting sync'}.`, 'warning');
        }
      }
    } catch (err) {
      if (window.showAdminToast) {
        window.showAdminToast(`Account for ${name} approved and activated.`);
      }
    }
  };

  window.rejectUser = async function (param) {
    const pendingList = getStoredPendingUsers();
    let target = pendingList.find(u => String(u.id) === String(param));
    let row = document.getElementById(param) || document.getElementById(`req_${param}`);
    let name = target ? target.name : (row ? row.getAttribute('data-name') : 'User');
    let email = target ? target.email : (row ? row.getAttribute('data-email') : '');
    let username = target ? target.username : (row ? row.getAttribute('data-username') : '');

    const remaining = pendingList.filter(u => String(u.id) !== String(param) && `req_${u.id}` !== String(param));
    saveStoredPendingUsers(remaining);

    // Also remove from registered directory if present
    try {
      const regList = getStoredRegisteredUsers();
      const updatedReg = regList.filter(u => String(u.id) !== String(param) && (email ? u.email?.toLowerCase() !== email.toLowerCase() : true));
      saveStoredRegisteredUsers(updatedReg);
    } catch (_) {}

    // Synchronize rejection directly to Supabase user_profiles (status: inactive)
    try {
      const srv = adminSrv || (await import('../supabase/admin-supabase-service.js'));
      if (srv && typeof srv.rejectUserAccount === 'function') {
        await srv.rejectUserAccount({
          id: target?.id || param,
          email: email,
          username: username,
          name: name
        });
      }
    } catch (err) {
      console.warn('[AdminUserManagement] Supabase rejection notice:', err.message || err);
    }

    // Log Activity
    try {
      const act = JSON.parse(localStorage.getItem('rmims_manager_activities') || '[]');
      act.unshift({
        id: `act-${Date.now()}`,
        timestamp: new Date().toISOString(),
        date: getLiveTodayISO(),
        user: 'Admin',
        role: 'Main Admin',
        branch: 'Headquarters',
        branchLoc: 'Headquarters',
        branchName: 'Headquarters',
        action: 'Rejected Account',
        module: 'User Management',
        details: `Rejected registration request for ${name}`,
        status: 'success'
      });
      localStorage.setItem('rmims_manager_activities', JSON.stringify(act.slice(0, 50)));
    } catch (_) {}

    renderPendingUsers();
    refreshCounters();

    // Broadcast live notification across all portals (Admin, Manager, Staff)
    try {
      if (typeof window !== 'undefined' && typeof window.pushRMIMSNotification === 'function') {
        window.pushRMIMSNotification({
          title: `Registration Rejected: ${name}`,
          message: `Registration request for ${name} was rejected by Administrator.`,
          category: 'Activity',
          badge: 'User Management',
          role: 'admin',
          targetRole: 'admin',
          roleScope: 'admin',
          priority: 'normal',
          targetUrl: 'admin/user-management.html',
          actor: 'Administrator'
        });
      }
    } catch (e) {}

    if (window.showAdminToast) {
      window.showAdminToast(`Rejected registration for ${name}.`, 'danger');
    }
  };

  // Pagination Controls — dynamically build buttons when renderRegisteredUsers runs
  function buildPaginationButtons(total, perPage) {
    const container = document.getElementById('userPaginationControls');
    const prevBtn = document.getElementById('btnUserPrevPage');
    const nextBtn = document.getElementById('btnUserNextPage');
    if (!container) return;
    
    // Remove previously injected page number buttons
    container.querySelectorAll('.pagination-btn.pg-num').forEach(b => b.remove());

    const totalPages = Math.max(1, Math.ceil(total / perPage));

    if (total === 0) {
      if (prevBtn) {
        prevBtn.disabled = true;
        prevBtn.classList.add('disabled');
      }
      if (nextBtn) {
        nextBtn.disabled = true;
        nextBtn.classList.add('disabled');
      }
      const emptyBtn = document.createElement('button');
      emptyBtn.type = 'button';
      emptyBtn.className = 'pagination-btn pg-num disabled';
      emptyBtn.disabled = true;
      emptyBtn.textContent = '1';
      container.insertBefore(emptyBtn, nextBtn);
      return;
    }

    if (prevBtn) {
      prevBtn.disabled = (currentUserPage <= 1);
      if (currentUserPage <= 1) prevBtn.classList.add('disabled');
      else prevBtn.classList.remove('disabled');
      prevBtn.onclick = function() {
        if (currentUserPage > 1) {
          currentUserPage--;
          renderRegisteredUsers();
        }
      };
    }

    if (nextBtn) {
      nextBtn.disabled = (currentUserPage >= totalPages);
      if (currentUserPage >= totalPages) nextBtn.classList.add('disabled');
      else nextBtn.classList.remove('disabled');
      nextBtn.onclick = function() {
        if (currentUserPage < totalPages) {
          currentUserPage++;
          renderRegisteredUsers();
        }
      };
    }

    for (let p = 1; p <= totalPages; p++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pagination-btn pg-num' + (p === currentUserPage ? ' active' : '');
      btn.textContent = String(p);
      btn.onclick = (function(page) {
        return function() {
          currentUserPage = page;
          renderRegisteredUsers();
        };
      })(p);
      container.insertBefore(btn, nextBtn);
    }
  }

  // Utilities
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeJs(str) {
    return String(str)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/"/g, '\\"');
  }

  function getLocationBadgeHtml(loc) {
    const locLower = (loc || '').toLowerCase();
    let locClass = 'neutral';
    let locBadgeText = loc || 'Unassigned';
    if (locLower.includes('tiaong')) {
      locClass = 'tiaong';
      locBadgeText = loc;
    } else if (locLower.includes('lucena')) {
      locClass = 'lucena';
      locBadgeText = loc;
    } else if (locLower.includes('headquarters') || loc === '-') {
      locClass = 'hq';
      locBadgeText = 'Headquarters';
    } else if (locLower) {
      locClass = 'custom';
      locBadgeText = loc;
    }
    return `<span class="location-badge ${locClass}">${escapeHtml(locBadgeText)}</span>`;
  }

  // ─── Dynamic Branch Location Dropdown Populator ───────────────────────────
  // Reads unique branch locations from stored users + branch-stores data,
  // then injects <option> elements into all three location selects.
  function populateBranchDropdowns() {
    const users = getStoredRegisteredUsers();
    const pending = getStoredPendingUsers();

    // Collect unique locations from registered + pending users
    const locationSet = new Set();
    [...users, ...pending].forEach(u => {
      if (u.branchLoc && u.branchLoc.trim()) locationSet.add(u.branchLoc.trim());
    });

    // Also pull from branch-stores storage if available
    try {
      const storesV3 = JSON.parse(localStorage.getItem('RMIMS_BRANCH_STORES_V3') || '{}');
      const storeList = Array.isArray(storesV3) ? storesV3 : Object.values(storesV3);
      storeList.forEach(s => {
        const l = s.location || s.address;
        if (l && l.trim()) locationSet.add(l.trim());
      });
      const oldStores = JSON.parse(localStorage.getItem('rmims_branch_stores') || '[]');
      if (Array.isArray(oldStores)) {
        oldStores.forEach(s => {
          if (s.location && s.location.trim()) locationSet.add(s.location.trim());
        });
      }
    } catch (_) {}

    const locations = Array.from(locationSet).sort();

    // Add/Edit modal location selects
    ['newUserBranchLoc', 'editUserBranchLoc'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const current = sel.value;
      // Remove previously injected options (keep the placeholder)
      sel.querySelectorAll('option.dynamic-loc').forEach(o => o.remove());
      locations.forEach(loc => {
        const opt = document.createElement('option');
        opt.value = loc;
        opt.textContent = loc;
        opt.className = 'dynamic-loc';
        sel.appendChild(opt);
      });
      // Always add Headquarters option
      if (!locations.includes('-') && !locations.includes('Headquarters')) {
        const hqOpt = document.createElement('option');
        hqOpt.value = '-';
        hqOpt.textContent = '- (Headquarters)';
        hqOpt.className = 'dynamic-loc';
        sel.appendChild(hqOpt);
      }
      if (current) sel.value = current;
    });

    // Branch filter dropdown
    if (branchFilter) {
      const currentFilter = branchFilter.value;
      branchFilter.querySelectorAll('option.dynamic-loc').forEach(o => o.remove());
      locations.forEach(loc => {
        const opt = document.createElement('option');
        opt.value = loc;
        opt.textContent = loc;
        opt.className = 'dynamic-loc';
        branchFilter.appendChild(opt);
      });
      branchFilter.value = currentFilter || 'all';
    }
  }
  // Initial Render & Sync
  renderPendingUsers();
  renderRegisteredUsers();
  refreshCounters();
  populateBranchDropdowns();

  // Asynchronously query Supabase for registered users and pending approvals
  import('../supabase/admin-supabase-service.js')
    .then(srv => {
      adminSrv = srv;
      return Promise.all([srv.fetchRegisteredUsers(), srv.fetchPendingApprovals()]);
    })
    .then(() => {
      renderPendingUsers();
      renderRegisteredUsers();
      refreshCounters();
      populateBranchDropdowns();

      // Realtime websocket subscription across devices
      if (adminSrv && typeof adminSrv.subscribeToAdminFeed === 'function') {
        adminSrv.subscribeToAdminFeed(({ table }) => {
          if (table === 'user_profiles' || table === 'branch_stores') {
            Promise.all([adminSrv.fetchRegisteredUsers(), adminSrv.fetchPendingApprovals()]).then(() => {
              renderPendingUsers();
              renderRegisteredUsers();
              refreshCounters();
              populateBranchDropdowns();
            }).catch(() => {});
          }
        });
      }
    })
    .catch(() => {});


  window.addEventListener('rmims_pending_users_updated', () => {
    renderPendingUsers();
    refreshCounters();
  });

  window.addEventListener('rmims_registered_users_updated', () => {
    renderRegisteredUsers();
    refreshCounters();
  });

  window.addEventListener('storage', (e) => {
    if (e.key === 'rmims_pending_users') {
      renderPendingUsers();
      refreshCounters();
    }
    if (e.key === 'rmims_registered_users') {
      renderRegisteredUsers();
      refreshCounters();
    }
  });
});
