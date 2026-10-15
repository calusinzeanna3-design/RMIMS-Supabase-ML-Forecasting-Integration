const fs = require('fs');

const cssFiles = fs.readdirSync('RMIMS/css').filter(f => f.endsWith('.css'));
cssFiles.forEach(f => {
  const content = fs.readFileSync('RMIMS/css/' + f, 'utf8');
  if (content.includes('maReceiveModalOverlay') || content.includes('.modal-overlay.open') || content.includes('.modal-overlay.active') || content.includes('.modal-overlay')) {
    console.log('CSS match in:', f);
    const lines = content.split('\n');
    lines.forEach((l, i) => {
      if (l.includes('modal-overlay') && (l.includes('open') || l.includes('active') || l.includes('display') || l.includes('opacity') || l.includes('visibility'))) {
        console.log(`  ${i+1}: ${l.trim()}`);
      }
    });
  }
});
