const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const source = path.join(__dirname, 'data', 'class-hub.sqlite');
const output = path.join(__dirname, 'data', 'cloudflare-import.sql');
if (!fs.existsSync(source)) throw new Error('Local database not found.');

const db = new DatabaseSync(source, { readOnly: true });
const columns = ['id', 'section', 'title', 'description', 'day', 'start_time', 'end_time', 'location', 'url', 'category', 'date', 'pinned', 'created_at'];
const quote = (value) => value === null || value === undefined ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
try {
  const entries = db.prepare('SELECT * FROM entries ORDER BY id').all();
  const contact = db.prepare('SELECT value FROM settings WHERE key=?').get('contact_text')?.value;
  const statements = entries.map((entry) => `INSERT OR IGNORE INTO entries (${columns.join(', ')}) VALUES (${columns.map((column) => quote(entry[column])).join(', ')});`);
  if (contact) statements.push(`UPDATE settings SET value=${quote(contact)} WHERE key='contact_text';`);
  fs.writeFileSync(output, `${statements.join('\n')}\n`, 'utf8');
  console.log(`Prepared private D1 import for ${entries.length} entries in data/cloudflare-import.sql`);
} finally {
  db.close();
}
