const fs = require('fs');
const path = require('path');

const adminPages = [
  'overview.html',
  'activity-logs.html',
  'user-management.html',
  'branch-stores.html',
  'system-alerts.html',
  'settings.html'
];

adminPages.forEach(file => {
  const p = path.join(__dirname, '..', 'RMIMS', 'admin', file);
  let html = fs.readFileSync(p, 'utf8');

  // 1. Remove the '8' badge from Help Center
  // Target: <span class="nav-badge-pill">8</span>
  html = html.replace(/\s*<span class="nav-badge-pill">8<\/span>/g, '');

  // 2. Add version after settings link inside sidebar-bottom-nav if not already present
  if (!html.includes('class="sidebar-version"')) {
    html = html.replace(
      /(<a href="settings\.html" class="nav-link(?:\s+active)?">[\s\S]*?<\/a>)\s*(<\/div>\s*<\/aside>)/,
      '$1\n\n        <div class="sidebar-version">v2.0.0 &bull; RMSME</div>\n      $2'
    );
  }

  // 3. Update sidebar-header to Image 1 & 2 horizontal style: just the logo with RMSME
  // Replace <div class="brand-titles">...</div> with <span class="brand-name">RMSME</span>
  html = html.replace(
    /<div class="brand-titles">\s*<span class="brand-name">[\s\S]*?<\/span>\s*<span class="brand-sub">[\s\S]*?<\/span>\s*<\/div>/,
    '<span class="brand-name">RMSME</span>'
  );

  fs.writeFileSync(p, html, 'utf8');
  console.log(`Successfully updated ${file}`);
});
