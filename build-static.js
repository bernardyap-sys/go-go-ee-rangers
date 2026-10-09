const fs = require('node:fs');
const path = require('node:path');

const files = ['index.html', 'styles.css', 'app.js', 'admin.html', 'admin.css', 'admin.js', 'assets/unimas-engineering-logo.png'];
const output = path.join(__dirname, 'dist');
fs.mkdirSync(output, { recursive: true });
for (const file of files) {
  fs.mkdirSync(path.dirname(path.join(output, file)), { recursive: true });
  fs.copyFileSync(path.join(__dirname, file), path.join(output, file));
}
console.log(`Prepared ${files.length} public files in dist/`);
