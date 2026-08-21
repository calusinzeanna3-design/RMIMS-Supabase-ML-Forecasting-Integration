import { build } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..');

console.log('====================================================');
console.log('PHASE 13 & 19: TESTING VITE PRODUCTION BUILD');
console.log('====================================================');

async function testBuild() {
  try {
    console.log('Starting Vite production build...');
    const result = await build({
      configFile: path.join(root, 'vite.config.js'),
      mode: 'production'
    });
    console.log('[PASS] Vite production build succeeded without errors!');
  } catch (err) {
    console.error('[FAIL] Vite build error:', err);
    process.exit(1);
  }
}

testBuild();
