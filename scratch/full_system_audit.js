import fs from 'fs';
import path from 'path';

const projectRoot = process.cwd();
const rmimsDir = path.join(projectRoot, 'RMIMS');
const distDir = path.join(projectRoot, 'dist');

function getAllFiles(dirPath, arrayOfFiles = []) {
    if (!fs.existsSync(dirPath)) return arrayOfFiles;
    const files = fs.readdirSync(dirPath);

    files.forEach((file) => {
        const fullPath = path.join(dirPath, file);
        if (fs.statSync(fullPath).isDirectory()) {
            arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
        } else {
            arrayOfFiles.push(fullPath);
        }
    });

    return arrayOfFiles;
}

console.log("====================================================");
console.log("PHASE 1: LOCAL SOURCE APPLICATION FILE DISCOVERY");
console.log("====================================================");

const allSourceFiles = getAllFiles(rmimsDir);
console.log(`Total Local Source Files in RMIMS/: ${allSourceFiles.length}`);

const htmlFiles = allSourceFiles.filter(f => f.endsWith('.html'));
const cssFiles = allSourceFiles.filter(f => f.endsWith('.css'));
const jsFiles = allSourceFiles.filter(f => f.endsWith('.js'));
const assetFiles = allSourceFiles.filter(f => /\.(png|jpg|jpeg|svg|webp|ico|gif|ttf|woff|woff2)$/i.test(f));

console.log(`- HTML Pages (${htmlFiles.length}):`);
htmlFiles.forEach(f => console.log(`  * ${path.relative(projectRoot, f)}`));

console.log(`- CSS Files (${cssFiles.length}):`);
cssFiles.forEach(f => console.log(`  * ${path.relative(projectRoot, f)}`));

console.log(`- JavaScript Files (${jsFiles.length}):`);
jsFiles.forEach(f => console.log(`  * ${path.relative(projectRoot, f)}`));

console.log(`- Asset Files (${assetFiles.length}):`);
assetFiles.forEach(f => console.log(`  * ${path.relative(projectRoot, f)}`));
