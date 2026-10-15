const fs = require('fs');
const path = require('path');

const svgSettings = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>`;

function getReplacement(isActive) {
  return `        </nav>
      </div>

      <div class="sidebar-bottom-nav">
        <button type="button" class="nav-link nav-btn-help" id="btnSidebarHelp">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="12" cy="12" r="10"/>
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span>Help Center</span>
          <span class="nav-badge-pill">8</span>
        </button>

        <a href="settings.html" class="nav-link${isActive ? ' active' : ''}">
          ${svgSettings}
          <span>Settings</span>
        </a>
      </div>
    </aside>`;
}

['system-alerts.html', 'activity-logs.html', 'settings.html'].forEach(file => {
  const p = path.join(__dirname, '..', 'RMIMS', 'admin', file);
  let html = fs.readFileSync(p, 'utf8');
  const targetRegex = /\s*<a href="settings\.html" class="nav-link(?:\s+active)?">[\s\S]*?<\/a>\s*<\/nav>\s*<\/div>\s*<\/aside>/;
  const match = html.match(targetRegex);
  if (!match) {
    console.error('Target regex failed on:', file);
    return;
  }
  const isActive = file === 'settings.html';
  html = html.replace(targetRegex, '\n' + getReplacement(isActive));
  fs.writeFileSync(p, html, 'utf8');
  console.log('Successfully updated:', file);
});
