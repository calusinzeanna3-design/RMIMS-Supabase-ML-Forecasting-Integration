import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = path.join(__dirname, '..', 'RMIMS');

const checks = [
  {
    file: path.join(root, 'user', 'settings.html'),
    forbid: ['settings-appearance-section', 'appearanceOptionsGrid', 'data-appearance']
  },
  {
    file: path.join(root, 'admin', 'settings.html'),
    forbid: ['settings-appearance-section', 'appearanceOptionsGrid', 'data-appearance']
  },
  {
    file: path.join(root, 'js', 'rmsme-shell.js'),
    forbid: ['RMIMS_THEME', 'prefers-color-scheme', 'getSystemTheme', 'setThemePreference']
  },
  {
    file: path.join(root, 'css', 'rmims-unified.css'),
    forbid: ['[data-theme="dark"]']
  },
  {
    file: path.join(root, 'css', 'dashboard.css'),
    forbid: ['[data-theme="dark"]', '#themeToggleBtn']
  }
];

let failed = false;

checks.forEach(({ file, forbid }) => {
  const content = fs.readFileSync(file, 'utf8');
  forbid.forEach((term) => {
    if (content.includes(term)) {
      console.error(`FAILED: ${path.basename(file)} still contains "${term}"`);
      failed = true;
    } else {
      console.log(`PASSED: ${path.basename(file)} does NOT contain "${term}"`);
    }
  });
});

if (failed) {
  process.exit(1);
} else {
  console.log('\nALL VERIFICATION CHECKS PASSED SUCCESSFULLY!');
}
