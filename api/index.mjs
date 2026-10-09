import seed from '../vercel/seed-content.json' with { type: 'json' };
import { blobStore } from '../vercel/blob-store.mjs';
import { cookie, json, matchesPassword, randomToken, readJson, sha256Hex, text, validateEntry } from '../cloudflare/worker.mjs';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function sorted(content) {
  content.announcements.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.id - a.id);
  content.schedule.sort((a, b) => a.day - b.day || a.start_time.localeCompare(b.start_time));
  content.resources.sort((a, b) => b.id - a.id);
  content.activities.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || b.id - a.id);
  return content;
}

async function contentRecord(store) {
  const record = await store.read('content.json');
  return record || { value: structuredClone(seed), etag: null };
}

async function updateContent(store, change) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const record = await contentRecord(store);
    const result = change(record.value);
    if (!result.save) return result;
    try {
      await store.write('content.json', sorted(record.value), record.etag);
      return result;
    } catch (error) {
      if (!store.isConflict(error) || attempt === 2) throw error;
    }
  }
}

async function sessionFor(request, store) {
  const token = /(?:^|;\s*)sid=([a-f0-9]{64})(?:;|$)/.exec(request.headers.get('cookie') || '')?.[1];
  if (!token) return null;
  const key = `sessions/${await sha256Hex(token)}.json`;
  const record = await store.read(key);
  return record?.value.expires_at > Date.now() ? key : null;
}

async function login(request, store, password) {
  if (!password || password.length < 12) throw new HttpError(503, 'Admin login is not configured.');
  const ip = request.headers.get('x-vercel-forwarded-for') || 'local';
  const attemptKey = `attempts/${await sha256Hex(ip)}.json`;
  const prior = await store.read(attemptKey);
  const now = Date.now();
  if (prior?.value.until > now && prior.value.count >= 5) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
  const body = await readJson(request);
  if (!await matchesPassword(String(body?.password ?? ''), password)) {
    const count = prior?.value.until > now ? prior.value.count + 1 : 1;
    await store.write(attemptKey, { count, until: now + 15 * 60_000 }, prior?.etag);
    throw new HttpError(401, 'Incorrect password.');
  }
  if (prior) await store.remove(attemptKey);
  const token = randomToken();
  await store.write(`sessions/${await sha256Hex(token)}.json`, { expires_at: now + 8 * 60 * 60_000 });
  return json(200, { ok: true }, { 'Set-Cookie': cookie(request, token, 28_800) });
}

async function admin(request, store, path) {
  const session = await sessionFor(request, store);
  if (!session) throw new HttpError(401, 'Please log in.');
  if (request.method === 'GET' && path === 'admin/session') return json(200, { ok: true });
  if (request.method === 'POST' && path === 'admin/logout') {
    const record = await store.read(session);
    if (record) await store.write(session, { expires_at: 0 }, record.etag);
    return json(200, { ok: true }, { 'Set-Cookie': cookie(request, '', 0) });
  }
  if (request.method === 'PUT' && path === 'admin/contact') {
    const body = await readJson(request);
    const contact = text(body?.text, 'Contact text', 300);
    await updateContent(store, (content) => { content.contact = contact; return { save: true }; });
    return json(200, { contact });
  }
  const match = /^admin\/(announcements|schedule|resources|activities)(?:\/(\d+))?$/.exec(path);
  if (!match) throw new HttpError(404, 'Not found.');
  const [, section, rawId] = match;
  const id = rawId ? Number(rawId) : null;
  if (request.method === 'POST' && !id) {
    const entry = validateEntry(section, await readJson(request));
    const result = await updateContent(store, (content) => {
      const nextId = Math.max(0, ...['announcements', 'schedule', 'resources', 'activities'].flatMap((name) => content[name].map((item) => item.id))) + 1;
      content[section].push({ id: nextId, section, ...entry, pinned: Boolean(entry.pinned), created_at: new Date().toISOString() });
      return { save: true, id: nextId };
    });
    return json(201, { id: result.id });
  }
  if (request.method === 'PUT' && id) {
    const entry = validateEntry(section, await readJson(request));
    const result = await updateContent(store, (content) => {
      const index = content[section].findIndex((item) => item.id === id);
      if (index < 0) return { save: false };
      content[section][index] = { ...content[section][index], ...entry, pinned: Boolean(entry.pinned) };
      return { save: true };
    });
    return result.save ? json(200, { id }) : json(404, { error: 'Entry not found.' });
  }
  if (request.method === 'DELETE' && id) {
    const result = await updateContent(store, (content) => {
      const index = content[section].findIndex((item) => item.id === id);
      if (index < 0) return { save: false };
      content[section].splice(index, 1);
      return { save: true };
    });
    return result.save ? json(200, { ok: true }) : json(404, { error: 'Entry not found.' });
  }
  throw new HttpError(405, 'Method not allowed.');
}

export function createHandler(store = blobStore, password = () => process.env.ADMIN_PASSWORD) {
  return {
    async fetch(request) {
      try {
        const url = new URL(request.url);
        const path = url.searchParams.get('path');
        if (!path || !/^(?:content|admin\/(?:login|logout|session|contact|announcements|schedule|resources|activities)(?:\/\d+)?)$/.test(path)) {
          throw new HttpError(404, 'Not found.');
        }
        if (['POST', 'PUT', 'DELETE'].includes(request.method) && request.headers.has('origin')) {
          let origin;
          try { origin = new URL(request.headers.get('origin')).origin; }
          catch { throw new HttpError(403, 'Request origin is not allowed.'); }
          if (origin !== url.origin) throw new HttpError(403, 'Request origin is not allowed.');
        }
        if (!process.env.BLOB_STORE_ID && store === blobStore) throw new HttpError(503, 'Storage is not configured.');
        if (request.method === 'GET' && path === 'content') return json(200, sorted((await contentRecord(store)).value));
        if (request.method === 'POST' && path === 'admin/login') return await login(request, store, password());
        return await admin(request, store, path);
      } catch (error) {
        if (!(error instanceof HttpError) && !error.status) console.error(error);
        const status = error.status || 500;
        return json(status, { error: status === 500 ? 'Server error.' : error.message });
      }
    },
  };
}

export default createHandler();
