// Copie le build web (../dist) dans desktop/web pour l'empaquetage.
const fs = require('node:fs');
const path = require('node:path');
const src = path.join(__dirname, '..', 'dist');
const dst = path.join(__dirname, 'web');
if (!fs.existsSync(path.join(src, 'index.html'))) {
  console.error('dist/ introuvable : lancez « npm run build » à la racine.');
  process.exit(1);
}
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });
console.log('Build web copié dans desktop/web');
