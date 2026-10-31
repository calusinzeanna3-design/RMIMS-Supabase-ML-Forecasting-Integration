const fs = require('fs');
const path = require('path');

const dirs = ['RMIMS/manager', 'RMIMS/user', 'RMIMS/admin'];

dirs.forEach(dir => {
  const fullDir = path.resolve(dir);
  if (!fs.existsSync(fullDir)) return;
  const files = fs.readdirSync(fullDir).filter(f => f.endsWith('.html'));
  files.forEach(f => {
    const filePath = path.join(fullDir, f);
    let content = fs.readFileSync(filePath, 'utf8');
    let changed = false;

    // Replace avatar initial placeholders
    if (/id="topbarProfileAvatar">(M|SS|A)<\/div>/.test(content)) {
      content = content.replace(/id="topbarProfileAvatar">(M|SS|A)<\/div>/g, 'id="topbarProfileAvatar">—</div>');
      changed = true;
    }

    // Replace name placeholders in topbar and dropdown
    if (/<span class="profile-name" data-shell-name id="topbarProfileName">(Manager|Store Staff|Admin)<\/span>/.test(content)) {
      content = content.replace(/<span class="profile-name" data-shell-name id="topbarProfileName">(Manager|Store Staff|Admin)<\/span>/g, '<span class="profile-name" data-shell-name id="topbarProfileName">User Account</span>');
      changed = true;
    }

    if (/<strong data-shell-name id="dropdownUserName">(Manager|Store Staff|Admin)<\/strong>/.test(content)) {
      content = content.replace(/<strong data-shell-name id="dropdownUserName">(Manager|Store Staff|Admin)<\/strong>/g, '<strong data-shell-name id="dropdownUserName">User Account</strong>');
      changed = true;
    }

    if (changed) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log('Cleaned placeholder in:', f);
    }
  });
});
