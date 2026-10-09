const assert = require('node:assert/strict');
const test = require('node:test');
const { createApp } = require('./server');

test('admin content workflow and public content', async () => {
  const { server, db } = createApp({ databasePath: ':memory:', adminPassword: 'LongTestPassword!42' });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const api = async (route, method = 'GET', body, auth = true) => {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(auth && cookie ? { Cookie: cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json(), response };
  };

  try {
    assert.equal((await api('/api/admin/session')).status, 401);
    assert.equal((await api('/api/admin/announcements', 'POST', { title: 'Blocked' })).status, 401);
    assert.equal((await api('/api/admin/login', 'POST', { password: 'wrong' }, false)).status, 401);
    const login = await api('/api/admin/login', 'POST', { password: 'LongTestPassword!42' }, false);
    assert.equal(login.status, 200);
    cookie = login.response.headers.get('set-cookie').split(';')[0];

    const announcement = await api('/api/admin/announcements', 'POST', { title: 'Class update', description: 'Room confirmed.', pinned: true });
    assert.equal(announcement.status, 201);
    assert.equal((await api('/api/admin/schedule', 'POST', { title: 'Lecture', day: 0, start_time: '11:00', end_time: '10:00' })).status, 400);
    assert.equal((await api('/api/admin/schedule', 'POST', { title: 'Lecture', day: 0, start_time: '10:00', end_time: '11:00', location: 'Room A' })).status, 201);
    assert.equal((await api('/api/admin/tasks', 'POST', { title: 'Invalid date', due_at: '2026-02-30T18:00+08:00' })).status, 400);
    const task = await api('/api/admin/tasks', 'POST', { title: 'Finish report', description: 'Submit online.', due_at: '2026-10-20T18:00+08:00' });
    assert.equal(task.status, 201);
    assert.equal((await api('/api/admin/resources', 'POST', { title: 'Slides', category: 'slides', url: 'javascript:alert(1)' })).status, 400);
    const resource = await api('/api/admin/resources', 'POST', { title: 'Slides', description: 'Week 1', category: 'slides', url: 'https://example.com/slides' });
    assert.equal(resource.status, 201);
    assert.equal((await api('/api/admin/activities', 'POST', { title: 'Group task', date: '2026-02-30' })).status, 400);
    assert.equal((await api('/api/admin/activities', 'POST', { title: 'Group task', description: 'Meet the team.', date: '2026-10-20' })).status, 201);
    assert.equal((await api('/api/admin/contact', 'PUT', { text: 'pls contact rara via WA group' })).status, 200);

    let content = (await api('/api/content', 'GET', undefined, false)).data;
    assert.equal(content.announcements[0].title, 'Class update');
    assert.equal(content.announcements[0].pinned, true);
    assert.equal(content.schedule[0].location, 'Room A');
    assert.equal(content.tasks[0].due_at, '2026-10-20T18:00+08:00');
    assert.equal(content.resources[0].url, 'https://example.com/slides');
    assert.equal(content.activities[0].date, '2026-10-20');
    assert.equal(content.contact, 'pls contact rara via WA group');

    assert.equal((await api(`/api/admin/announcements/${announcement.data.id}`, 'PUT', { title: 'Updated notice', description: 'New room.' })).status, 200);
    assert.equal((await api(`/api/admin/tasks/${task.data.id}`, 'PUT', { title: 'Finish report', due_at: '2026-10-21T18:00+08:00' })).status, 200);
    assert.equal((await api(`/api/admin/resources/${resource.data.id}`, 'DELETE')).status, 200);
    content = (await api('/api/content', 'GET', undefined, false)).data;
    assert.equal(content.announcements[0].title, 'Updated notice');
    assert.equal(content.tasks[0].due_at, '2026-10-21T18:00+08:00');
    assert.equal((await api(`/api/admin/tasks/${task.data.id}`, 'DELETE')).status, 200);
    assert.equal((await api('/api/content')).data.tasks.length, 0);
    assert.equal(content.resources.length, 0);

    const home = await fetch(base);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Go Go/);
    const admin = await fetch(`${base}/admin`);
    assert.equal(admin.status, 200);
    assert.match(await admin.text(), /Content Studio/);

    assert.equal((await api('/api/admin/logout', 'POST')).status, 200);
    assert.equal((await api('/api/admin/session')).status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
