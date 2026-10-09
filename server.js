const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/assets/unimas-engineering-logo.png', ['assets/unimas-engineering-logo.png', 'image/png']],
  ['/admin', ['admin.html', 'text/html; charset=utf-8']],
  ['/admin.css', ['admin.css', 'text/css; charset=utf-8']],
  ['/admin.js', ['admin.js', 'text/javascript; charset=utf-8']],
]);

function openDatabase(databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      section TEXT NOT NULL CHECK (section IN ('announcements', 'schedule', 'resources', 'activities')),
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      day INTEGER,
      start_time TEXT,
      end_time TEXT,
      location TEXT,
      url TEXT,
      category TEXT,
      date TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS entries_section_idx ON entries(section);
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      due_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS tasks_due_at_idx ON tasks(due_at);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)')
    .run('contact_text', 'pls contact rara via WA group');
  return db;
}

function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('Admin password must be at least 12 characters.');
  }
  const salt = crypto.randomBytes(16);
  const digest = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt.toString('hex')}:${digest.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const match = /^scrypt:([a-f0-9]{32}):([a-f0-9]{128})$/.exec(stored || '');
  if (!match) return false;
  const expected = Buffer.from(match[2], 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(match[1], 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function setAdminPassword(databasePath, password) {
  const stored = hashPassword(password);
  const db = openDatabase(databasePath);
  try {
    db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run('admin_password_hash', stored);
  } finally {
    db.close();
  }
}

function text(value, field, max, required = true) {
  if (typeof value !== 'string') throw new Error(`${field} must be text.`);
  const result = value.trim();
  if (required && !result) throw new Error(`${field} is required.`);
  if (result.length > max) throw new Error(`${field} is too long (max ${max} characters).`);
  return result;
}

function validDate(value) {
  if (!value) return null;
  const date = text(value, 'Date', 10);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('Date must use YYYY-MM-DD.');
  }
  return date;
}

function validTime(value, field) {
  const time = text(value, field, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error(`${field} must use HH:MM.`);
  return time;
}

function validDueAt(value) {
  const dueAt = text(value, 'Due date and time', 22);
  const parsed = new Date(dueAt);
  if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d\+08:00$/.test(dueAt)
    || Number.isNaN(parsed.valueOf())
    || new Date(parsed.valueOf() + 8 * 60 * 60_000).toISOString().slice(0, 16) !== dueAt.slice(0, 16)) {
    throw new Error('Due date and time must be a valid Malaysia time.');
  }
  return dueAt;
}

function validateEntry(section, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid entry.');
  const entry = {
    section,
    title: text(input.title, 'Title', 120),
    description: text(input.description ?? '', 'Description', 2000, false),
    day: null, start_time: null, end_time: null, location: null,
    url: null, category: null, date: null, pinned: 0,
  };
  if (section === 'announcements') {
    entry.pinned = input.pinned === true ? 1 : 0;
  } else if (section === 'schedule') {
    if (!Number.isInteger(input.day) || input.day < 0 || input.day > 5) {
      throw new Error('Day must be Monday through Saturday.');
    }
    entry.day = input.day;
    entry.start_time = validTime(input.start_time, 'Start time');
    entry.end_time = validTime(input.end_time, 'End time');
    if (entry.end_time <= entry.start_time) throw new Error('End time must be after start time.');
    entry.location = text(input.location ?? '', 'Location', 120, false);
  } else if (section === 'resources') {
    if (!['slides', 'assignment', 'reading', 'link'].includes(input.category)) {
      throw new Error('Choose a resource category.');
    }
    entry.category = input.category;
    const resourceUrl = text(input.url, 'URL', 2048);
    let parsed;
    try { parsed = new URL(resourceUrl); } catch { throw new Error('Enter a valid URL.'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('URL must start with http or https.');
    entry.url = parsed.href;
  } else if (section === 'activities') {
    entry.date = validDate(input.date);
  } else if (section === 'tasks') {
    entry.due_at = validDueAt(input.due_at);
  }
  return entry;
}

function sendJson(res, status, data, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    const error = new Error('Use application/json.'); error.status = 415; throw error;
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 16_384) { const error = new Error('Request is too large.'); error.status = 413; throw error; }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { const error = new Error('Invalid JSON.'); error.status = 400; throw error; }
}

function createApp({ databasePath, adminPassword }) {
  const db = openDatabase(databasePath);
  const existingPassword = db.prepare('SELECT value FROM settings WHERE key=?').get('admin_password_hash');
  if (!existingPassword) {
    if (!adminPassword) {
      db.close();
      throw new Error('Run node set-password.js before starting the server.');
    }
    db.prepare('INSERT INTO settings(key, value) VALUES (?, ?)').run('admin_password_hash', hashPassword(adminPassword));
  }
  const sessions = new Map();
  const attempts = new Map();
  const selectPassword = db.prepare('SELECT value FROM settings WHERE key=?');
  const selectEntries = db.prepare('SELECT * FROM entries ORDER BY id DESC');
  const selectTasks = db.prepare('SELECT * FROM tasks ORDER BY due_at, id');
  const insertEntry = db.prepare(`INSERT INTO entries
    (section, title, description, day, start_time, end_time, location, url, category, date, pinned)
    VALUES (@section, @title, @description, @day, @start_time, @end_time, @location, @url, @category, @date, @pinned)`);
  const updateEntry = db.prepare(`UPDATE entries SET title=@title, description=@description, day=@day,
    start_time=@start_time, end_time=@end_time, location=@location, url=@url,
    category=@category, date=@date, pinned=@pinned WHERE id=@id AND section=@section`);
  const deleteEntry = db.prepare('DELETE FROM entries WHERE id=? AND section=?');
  const insertTask = db.prepare('INSERT INTO tasks(title, description, due_at) VALUES (?, ?, ?)');
  const updateTask = db.prepare('UPDATE tasks SET title=?, description=?, due_at=? WHERE id=?');
  const deleteTask = db.prepare('DELETE FROM tasks WHERE id=?');

  function publicContent() {
    const result = { announcements: [], schedule: [], tasks: selectTasks.all(), resources: [], activities: [], contact: '' };
    for (const row of selectEntries.all()) {
      row.pinned = Boolean(row.pinned);
      result[row.section].push(row);
    }
    result.announcements.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.id - a.id);
    result.schedule.sort((a, b) => a.day - b.day || a.start_time.localeCompare(b.start_time));
    result.activities.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || b.id - a.id);
    result.contact = db.prepare('SELECT value FROM settings WHERE key=?').get('contact_text').value;
    return result;
  }

  function sessionFor(req) {
    const match = /(?:^|;\s*)sid=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '');
    if (!match) return null;
    const expires = sessions.get(match[1]);
    if (!expires) return null;
    if (expires < Date.now()) { sessions.delete(match[1]); return null; }
    return match[1];
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      const method = req.method;
      if (['POST', 'PUT', 'DELETE'].includes(method) && req.headers.origin) {
        const origin = new URL(req.headers.origin);
        if (origin.host !== req.headers.host || !['http:', 'https:'].includes(origin.protocol)) {
          return sendJson(res, 403, { error: 'Request origin is not allowed.' });
        }
      }

      if (method === 'GET' && pathname === '/api/content') return sendJson(res, 200, publicContent());
      if (method === 'POST' && pathname === '/api/admin/login') {
        const ip = req.socket.remoteAddress || 'local';
        const prior = attempts.get(ip);
        if (prior && prior.until > Date.now() && prior.count >= 5) {
          return sendJson(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
        }
        const body = await readJson(req);
        const storedPassword = selectPassword.get('admin_password_hash')?.value;
        if (!verifyPassword(String(body?.password ?? ''), storedPassword)) {
          const count = prior && prior.until > Date.now() ? prior.count + 1 : 1;
          attempts.set(ip, { count, until: Date.now() + 15 * 60_000 });
          return sendJson(res, 401, { error: 'Incorrect password.' });
        }
        attempts.delete(ip);
        const token = crypto.randomBytes(32).toString('hex');
        sessions.set(token, Date.now() + 8 * 60 * 60_000);
        return sendJson(res, 200, { ok: true }, {
          'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`,
        });
      }
      if (pathname.startsWith('/api/admin/')) {
        const session = sessionFor(req);
        if (!session) return sendJson(res, 401, { error: 'Please log in.' });
        if (method === 'GET' && pathname === '/api/admin/session') return sendJson(res, 200, { ok: true });
        if (method === 'POST' && pathname === '/api/admin/logout') {
          sessions.delete(session);
          return sendJson(res, 200, { ok: true }, {
            'Set-Cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
          });
        }
        if (method === 'PUT' && pathname === '/api/admin/contact') {
          const body = await readJson(req);
          let contact;
          try { contact = text(body?.text, 'Contact text', 300); }
          catch (error) { error.status = 400; throw error; }
          db.prepare('UPDATE settings SET value=? WHERE key=?').run(contact, 'contact_text');
          return sendJson(res, 200, { contact });
        }
        const match = /^\/api\/admin\/(announcements|schedule|tasks|resources|activities)(?:\/(\d+))?$/.exec(pathname);
        if (!match) return sendJson(res, 404, { error: 'Not found.' });
        const section = match[1];
        const id = match[2] ? Number(match[2]) : null;
        if (method === 'POST' && !id) {
          let entry;
          try { entry = validateEntry(section, await readJson(req)); }
          catch (error) { error.status ||= 400; throw error; }
          const result = section === 'tasks'
            ? insertTask.run(entry.title, entry.description, entry.due_at)
            : insertEntry.run(entry);
          return sendJson(res, 201, { id: Number(result.lastInsertRowid) });
        }
        if (method === 'PUT' && id) {
          let entry;
          try { entry = validateEntry(section, await readJson(req)); }
          catch (error) { error.status ||= 400; throw error; }
          const result = section === 'tasks'
            ? updateTask.run(entry.title, entry.description, entry.due_at, id)
            : updateEntry.run({ ...entry, id });
          return sendJson(res, result.changes ? 200 : 404, result.changes ? { id } : { error: 'Entry not found.' });
        }
        if (method === 'DELETE' && id) {
          const result = section === 'tasks' ? deleteTask.run(id) : deleteEntry.run(id, section);
          return sendJson(res, result.changes ? 200 : 404, result.changes ? { ok: true } : { error: 'Entry not found.' });
        }
        return sendJson(res, 405, { error: 'Method not allowed.' });
      }

      if (method === 'GET' && STATIC_FILES.has(pathname)) {
        const [filename, contentType] = STATIC_FILES.get(pathname);
        res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
        return fs.createReadStream(path.join(ROOT, filename)).pipe(res);
      }
      return sendJson(res, 404, { error: 'Not found.' });
    } catch (error) {
      const status = error.status || 500;
      return sendJson(res, status, { error: status === 500 ? 'Server error.' : error.message });
    }
  });

  return { server, db };
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  const databasePath = process.env.DB_PATH || path.join(ROOT, 'data', 'class-hub.sqlite');
  try {
    const { server } = createApp({ databasePath, adminPassword: process.env.ADMIN_PASSWORD });
    server.listen(port, host, () => console.log(`Class Hub: http://${host}:${port}  Admin: http://${host}:${port}/admin`));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { createApp, setAdminPassword };
