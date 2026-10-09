const encoder = new TextEncoder();
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function text(value, field, max, required = true) {
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be text.`);
  const result = value.trim();
  if (required && !result) throw new HttpError(400, `${field} is required.`);
  if (result.length > max) throw new HttpError(400, `${field} is too long (max ${max} characters).`);
  return result;
}

function validDate(value) {
  if (!value) return null;
  const date = text(value, 'Date', 10);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new HttpError(400, 'Date must use YYYY-MM-DD.');
  }
  return date;
}

function validTime(value, field) {
  const time = text(value, field, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new HttpError(400, `${field} must use HH:MM.`);
  return time;
}

function validateEntry(section, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Invalid entry.');
  const entry = {
    title: text(input.title, 'Title', 120),
    description: text(input.description ?? '', 'Description', 2000, false),
    day: null, start_time: null, end_time: null, location: null,
    url: null, category: null, date: null, pinned: 0,
  };
  if (section === 'announcements') {
    entry.pinned = input.pinned === true ? 1 : 0;
  } else if (section === 'schedule') {
    if (!Number.isInteger(input.day) || input.day < 0 || input.day > 5) throw new HttpError(400, 'Day must be Monday through Saturday.');
    entry.day = input.day;
    entry.start_time = validTime(input.start_time, 'Start time');
    entry.end_time = validTime(input.end_time, 'End time');
    if (entry.end_time <= entry.start_time) throw new HttpError(400, 'End time must be after start time.');
    entry.location = text(input.location ?? '', 'Location', 120, false);
  } else if (section === 'resources') {
    if (!['slides', 'assignment', 'reading', 'link'].includes(input.category)) throw new HttpError(400, 'Choose a resource category.');
    entry.category = input.category;
    const resourceUrl = text(input.url, 'URL', 2048);
    let parsed;
    try { parsed = new URL(resourceUrl); } catch { throw new HttpError(400, 'Enter a valid URL.'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new HttpError(400, 'URL must start with http or https.');
    entry.url = parsed.href;
  } else if (section === 'activities') {
    entry.date = validDate(input.date);
  }
  return entry;
}

function json(status, data, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...securityHeaders, ...extraHeaders },
  });
}

async function readJson(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Use application/json.');
  }
  const body = await request.text();
  if (encoder.encode(body).length > 16_384) throw new HttpError(413, 'Request is too large.');
  try { return JSON.parse(body); }
  catch { throw new HttpError(400, 'Invalid JSON.'); }
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function matchesPassword(submitted, expected) {
  const [left, right] = await Promise.all([sha256Hex(submitted), sha256Hex(expected)]);
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function randomToken() {
  return [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function cookie(request, token, maxAge) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

async function sessionFor(request, db) {
  const match = /(?:^|;\s*)sid=([a-f0-9]{64})(?:;|$)/.exec(request.headers.get('cookie') || '');
  if (!match) return null;
  const tokenHash = await sha256Hex(match[1]);
  const session = await db.prepare('SELECT expires_at FROM sessions WHERE token_hash=?').bind(tokenHash).first();
  if (!session) return null;
  if (session.expires_at <= Date.now()) {
    await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(tokenHash).run();
    return null;
  }
  return tokenHash;
}

async function publicContent(db) {
  const result = { announcements: [], schedule: [], resources: [], activities: [], contact: '' };
  const rows = (await db.prepare('SELECT * FROM entries ORDER BY id DESC').all()).results;
  for (const row of rows) {
    row.pinned = Boolean(row.pinned);
    result[row.section].push(row);
  }
  result.announcements.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.id - a.id);
  result.schedule.sort((a, b) => a.day - b.day || a.start_time.localeCompare(b.start_time));
  result.activities.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || b.id - a.id);
  result.contact = (await db.prepare('SELECT value FROM settings WHERE key=?').bind('contact_text').first())?.value || 'pls contact rara via WA group';
  return result;
}

async function login(request, env) {
  if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 12) throw new HttpError(503, 'Admin login is not configured.');
  const ip = env.PROVIDER === 'vercel'
    ? request.headers.get('x-vercel-forwarded-for') || 'local'
    : request.headers.get('CF-Connecting-IP') || 'local';
  const clientHash = await sha256Hex(ip);
  const now = Date.now();
  const prior = await env.DB.prepare('SELECT count, until FROM login_attempts WHERE client_hash=?').bind(clientHash).first();
  if (prior && prior.until > now && prior.count >= 5) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
  const body = await readJson(request);
  const submitted = String(body?.password ?? '');
  if (!await matchesPassword(submitted, env.ADMIN_PASSWORD)) {
    const count = prior && prior.until > now ? prior.count + 1 : 1;
    await env.DB.prepare('INSERT INTO login_attempts(client_hash, count, until) VALUES (?, ?, ?) ON CONFLICT(client_hash) DO UPDATE SET count=excluded.count, until=excluded.until')
      .bind(clientHash, count, now + 15 * 60_000).run();
    throw new HttpError(401, 'Incorrect password.');
  }
  await env.DB.prepare('DELETE FROM login_attempts WHERE client_hash=?').bind(clientHash).run();
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now).run();
  const token = randomToken();
  await env.DB.prepare('INSERT INTO sessions(token_hash, expires_at) VALUES (?, ?)').bind(await sha256Hex(token), now + 8 * 60 * 60_000).run();
  return json(200, { ok: true }, { 'Set-Cookie': cookie(request, token, 28_800) });
}

async function admin(request, env, pathname) {
  const session = await sessionFor(request, env.DB);
  if (!session) throw new HttpError(401, 'Please log in.');
  const method = request.method;
  if (method === 'GET' && pathname === '/api/admin/session') return json(200, { ok: true });
  if (method === 'POST' && pathname === '/api/admin/logout') {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(session).run();
    return json(200, { ok: true }, { 'Set-Cookie': cookie(request, '', 0) });
  }
  if (method === 'PUT' && pathname === '/api/admin/contact') {
    const body = await readJson(request);
    const contact = text(body?.text, 'Contact text', 300);
    await env.DB.prepare('UPDATE settings SET value=? WHERE key=?').bind(contact, 'contact_text').run();
    return json(200, { contact });
  }
  const match = /^\/api\/admin\/(announcements|schedule|resources|activities)(?:\/(\d+))?$/.exec(pathname);
  if (!match) throw new HttpError(404, 'Not found.');
  const section = match[1];
  const id = match[2] ? Number(match[2]) : null;
  if (method === 'POST' && !id) {
    const entry = validateEntry(section, await readJson(request));
    const result = await env.DB.prepare(`INSERT INTO entries
      (section, title, description, day, start_time, end_time, location, url, category, date, pinned)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(section, entry.title, entry.description, entry.day,
      entry.start_time, entry.end_time, entry.location, entry.url, entry.category, entry.date, entry.pinned).run();
    return json(201, { id: result.meta.last_row_id });
  }
  if (method === 'PUT' && id) {
    const entry = validateEntry(section, await readJson(request));
    const result = await env.DB.prepare(`UPDATE entries SET title=?, description=?, day=?, start_time=?, end_time=?,
      location=?, url=?, category=?, date=?, pinned=? WHERE id=? AND section=?`).bind(entry.title,
      entry.description, entry.day, entry.start_time, entry.end_time, entry.location, entry.url,
      entry.category, entry.date, entry.pinned, id, section).run();
    return result.meta.changes ? json(200, { id }) : json(404, { error: 'Entry not found.' });
  }
  if (method === 'DELETE' && id) {
    const result = await env.DB.prepare('DELETE FROM entries WHERE id=? AND section=?').bind(id, section).run();
    return result.meta.changes ? json(200, { ok: true }) : json(404, { error: 'Entry not found.' });
  }
  throw new HttpError(405, 'Method not allowed.');
}

async function asset(request, env, pathname) {
  const url = new URL(request.url);
  if (pathname === '/admin') url.pathname = '/admin.html';
  const response = await env.ASSETS.fetch(new Request(url, request));
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env) {
    try {
      const pathname = new URL(request.url).pathname;
      if (['POST', 'PUT', 'DELETE'].includes(request.method) && request.headers.has('origin')) {
        let origin;
        try { origin = new URL(request.headers.get('origin')).origin; }
        catch { throw new HttpError(403, 'Request origin is not allowed.'); }
        if (origin !== new URL(request.url).origin) {
          throw new HttpError(403, 'Request origin is not allowed.');
        }
      }
      if (pathname.startsWith('/api/')) {
        if (!env.DB) throw new HttpError(503, 'Database is not configured.');
        if (request.method === 'GET' && pathname === '/api/content') return json(200, await publicContent(env.DB));
        if (request.method === 'POST' && pathname === '/api/admin/login') return await login(request, env);
        if (pathname.startsWith('/api/admin/')) return await admin(request, env, pathname);
        throw new HttpError(404, 'Not found.');
      }
      if (request.method === 'GET' || request.method === 'HEAD') return await asset(request, env, pathname);
      throw new HttpError(405, 'Method not allowed.');
    } catch (error) {
      if (!(error instanceof HttpError)) console.error(error);
      return json(error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : 'Server error.' });
    }
  },
};

export { cookie, json, matchesPassword, randomToken, readJson, sha256Hex, text, validateEntry };
