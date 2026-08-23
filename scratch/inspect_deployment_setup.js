import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..');

console.log('====================================================');
console.log('INSPECTING DEPLOYMENT CONFIGURATION & PLATFORM SETUP');
console.log('====================================================\n');

// 1. Search for deployment config files
const configFiles = [
  'vercel.json',
  'netlify.toml',
  'fly.toml',
  'render.yaml',
  'Dockerfile',
  'docker-compose.yml',
  'Procfile',
  'supabase/config.toml',
  'static.json',
  '_redirects'
];

console.log('--- DEPLOYMENT CONFIG FILES SEARCH ---');
configFiles.forEach(f => {
  const p = path.join(root, f);
  if (fs.existsSync(p)) {
    console.log(`[FOUND] ${f} (${fs.statSync(p).size} bytes)`);
  } else {
    console.log(`[NOT FOUND] ${f}`);
  }
});

// Check .github/workflows
const githubWorkflows = path.join(root, '.github', 'workflows');
if (fs.existsSync(githubWorkflows)) {
  console.log('[FOUND] .github/workflows directory with files:', fs.readdirSync(githubWorkflows));
} else {
  console.log('[NOT FOUND] .github/workflows');
}

// 2. Check Package.json scripts & dependencies
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
console.log('\n--- PACKAGE.JSON SCRIPTS ---');
console.log(JSON.stringify(pkg.scripts || {}, null, 2));

// 3. Search project markdown files for deployment instructions
console.log('\n--- DOCUMENTATION DEPLOYMENT REFERENCES ---');
const mdFiles = fs.readdirSync(root).filter(f => f.endsWith('.md'));
mdFiles.forEach(f => {
  const content = fs.readFileSync(path.join(root, f), 'utf8');
  if (content.toLowerCase().includes('deploy') || content.toLowerCase().includes('hosting')) {
    console.log(`- ${f} mentions deployment/hosting.`);
  }
});

// 4. Test CLI availability
const clis = ['vercel', 'netlify', 'supabase', 'flyctl', 'railway'];
console.log('\n--- TESTING INSTALLED DEPLOYMENT CLIS ---');
clis.forEach(cli => {
  try {
    const out = execSync(`${cli} --version`, { encoding: 'utf8', stdio: 'pipe' });
    console.log(`[AVAILABLE] ${cli}: ${out.trim()}`);
  } catch (e) {
    console.log(`[NOT INSTALLED] ${cli}`);
  }
});
