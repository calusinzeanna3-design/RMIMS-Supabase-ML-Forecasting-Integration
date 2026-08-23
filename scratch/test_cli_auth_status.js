import { execSync } from 'child_process';

console.log('--- TESTING CLI LOGIN / PROJECT LINK STATUS ---');

// 1. Vercel
try {
  const vercelOut = execSync('npx -y vercel whoami', { encoding: 'utf8', stdio: 'pipe' });
  console.log('[VERCEL WHOAMI]:\n', vercelOut);
} catch (e) {
  console.log('[VERCEL STATUS]: Not logged in / requires authentication:', e.message.split('\n')[0]);
}

// 3. Netlify
try {
  const netlifyOut = execSync('npx -y netlify status', { encoding: 'utf8', stdio: 'pipe' });
  console.log('[NETLIFY STATUS]:\n', netlifyOut);
} catch (e) {
  console.log('[NETLIFY STATUS]: Not logged in / requires authentication:', e.message.split('\n')[0]);
}

// 4. Supabase CLI
try {
  const supaOut = execSync('npx -y supabase projects list', { encoding: 'utf8', stdio: 'pipe' });
  console.log('[SUPABASE PROJECTS]:\n', supaOut);
} catch (e) {
  console.log('[SUPABASE STATUS]: Not logged in / requires authentication:', e.message.split('\n')[0]);
}
