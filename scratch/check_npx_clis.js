import { execSync } from 'child_process';

console.log('--- TESTING NPX HOSTING CLIS ---');

const clis = [
  'npx -y vercel --version',
  'npx -y netlify-cli --version',
  'npx -y supabase --version'
];

clis.forEach(cmd => {
  try {
    const out = execSync(cmd, { encoding: 'utf8', timeout: 15000 });
    console.log(`[PASS] ${cmd.split(' ')[2]}: ${out.trim()}`);
  } catch (e) {
    console.log(`[FAIL] ${cmd.split(' ')[2]}: ${e.message}`);
  }
});
