const loginPanel = document.querySelector('#login-panel');
const dashboard = document.querySelector('#dashboard');
const entryForm = document.querySelector('#entry-form');
const contactForm = document.querySelector('#contact-form');
const sectionNames = { announcements: 'Announcements', schedule: 'Schedule', resources: 'Resources', activities: 'Activities' };
const singularNames = { announcements: 'announcement', schedule: 'session', resources: 'resource', activities: 'activity' };
const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
let section = 'announcements';
let editingId = null;
let content = null;

async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function message(value, error = false) {
  const output = document.querySelector('#dashboard-message');
  output.style.color = error ? '#a13929' : '#426b3f';
  output.textContent = value;
}

function showLogin() {
  loginPanel.hidden = false;
  dashboard.hidden = true;
}

async function showDashboard() {
  loginPanel.hidden = true;
  dashboard.hidden = false;
  await refresh();
}

async function refresh() {
  content = await request('/api/content');
  contactForm.elements.text.value = content.contact;
  renderList();
}

function resetForm() {
  editingId = null;
  entryForm.reset();
  document.querySelector('#form-title').textContent = `Add ${singularNames[section]}`;
  document.querySelector('#save-entry').firstChild.textContent = 'Save entry ';
  document.querySelector('#cancel-edit').hidden = true;
}

function chooseSection(next) {
  section = next;
  document.querySelectorAll('.admin-tabs button').forEach((button) => {
    button.classList.toggle('active', button.dataset.section === next);
  });
  document.querySelector('#entry-area').hidden = next === 'contact';
  document.querySelector('#contact-area').hidden = next !== 'contact';
  document.querySelectorAll('[data-for]').forEach((field) => {
    field.hidden = field.dataset.for !== next;
  });
  entryForm.elements.start_time.required = next === 'schedule';
  entryForm.elements.end_time.required = next === 'schedule';
  entryForm.elements.url.required = next === 'resources';
  if (next !== 'contact') {
    document.querySelector('#list-title').textContent = sectionNames[next];
    resetForm();
    renderList();
  }
  message('');
}

function details(item) {
  if (section === 'schedule') return `${weekdays[item.day]} · ${item.start_time}–${item.end_time}${item.location ? ` · ${item.location}` : ''}`;
  if (section === 'resources') return `${item.category.toUpperCase()} · ${item.url}`;
  if (section === 'activities') return item.date || 'Date to be confirmed';
  return item.pinned ? 'PINNED ANNOUNCEMENT' : 'ANNOUNCEMENT';
}

function renderList() {
  if (!content || section === 'contact') return;
  const list = document.querySelector('#entry-list');
  list.replaceChildren();
  const items = content[section];
  document.querySelector('#entry-count').textContent = `${items.length} ${items.length === 1 ? 'entry' : 'entries'}`;
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'list-empty';
    empty.textContent = 'Nothing here yet. Add your first entry using the form.';
    list.append(empty);
    return;
  }
  for (const item of items) {
    const row = document.createElement('article');
    row.className = 'entry-item';
    const top = document.createElement('div');
    top.className = 'entry-item-top';
    const copy = document.createElement('div');
    const meta = document.createElement('p');
    meta.className = 'entry-meta';
    meta.textContent = details(item);
    const title = document.createElement('h3');
    title.textContent = item.title;
    const description = document.createElement('p');
    description.textContent = item.description;
    copy.append(meta, title, description);
    const actions = document.createElement('div');
    actions.className = 'item-actions';
    const edit = document.createElement('button');
    edit.type = 'button'; edit.textContent = 'Edit';
    edit.addEventListener('click', () => editEntry(item));
    const remove = document.createElement('button');
    remove.type = 'button'; remove.textContent = 'Delete';
    remove.addEventListener('click', () => deleteEntry(item));
    actions.append(edit, remove);
    top.append(copy, actions);
    row.append(top);
    list.append(row);
  }
}

function editEntry(item) {
  editingId = item.id;
  entryForm.elements.title.value = item.title;
  entryForm.elements.description.value = item.description;
  entryForm.elements.pinned.checked = item.pinned;
  entryForm.elements.day.value = String(item.day ?? 0);
  entryForm.elements.start_time.value = item.start_time || '';
  entryForm.elements.end_time.value = item.end_time || '';
  entryForm.elements.location.value = item.location || '';
  entryForm.elements.category.value = item.category || 'slides';
  entryForm.elements.url.value = item.url || '';
  entryForm.elements.date.value = item.date || '';
  document.querySelector('#form-title').textContent = `Edit ${singularNames[section]}`;
  document.querySelector('#save-entry').firstChild.textContent = 'Save changes ';
  document.querySelector('#cancel-edit').hidden = false;
  entryForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function deleteEntry(item) {
  if (!window.confirm(`Delete “${item.title}”?`)) return;
  try {
    await request(`/api/admin/${section}/${item.id}`, { method: 'DELETE' });
    if (editingId === item.id) resetForm();
    await refresh();
    message('Entry deleted.');
  } catch (error) { message(error.message, true); }
}

document.querySelector('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const output = document.querySelector('#login-message');
  output.textContent = '';
  try {
    await request('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: event.target.elements.password.value }) });
    event.target.reset();
    await showDashboard();
  } catch (error) { output.textContent = error.message; }
});

document.querySelectorAll('.admin-tabs button').forEach((button) => {
  button.addEventListener('click', () => chooseSection(button.dataset.section));
});

entryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const fields = entryForm.elements;
  const entry = { title: fields.title.value, description: fields.description.value };
  if (section === 'announcements') entry.pinned = fields.pinned.checked;
  if (section === 'schedule') Object.assign(entry, { day: Number(fields.day.value), start_time: fields.start_time.value, end_time: fields.end_time.value, location: fields.location.value });
  if (section === 'resources') Object.assign(entry, { category: fields.category.value, url: fields.url.value });
  if (section === 'activities') entry.date = fields.date.value;
  try {
    const url = editingId ? `/api/admin/${section}/${editingId}` : `/api/admin/${section}`;
    await request(url, { method: editingId ? 'PUT' : 'POST', body: JSON.stringify(entry) });
    resetForm();
    await refresh();
    message('Entry saved.');
  } catch (error) { message(error.message, true); }
});

document.querySelector('#cancel-edit').addEventListener('click', resetForm);
contactForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await request('/api/admin/contact', { method: 'PUT', body: JSON.stringify({ text: contactForm.elements.text.value }) });
    await refresh();
    message('Contact updated.');
  } catch (error) { message(error.message, true); }
});

document.querySelector('#logout').addEventListener('click', async () => {
  try { await request('/api/admin/logout', { method: 'POST' }); }
  finally { showLogin(); }
});

chooseSection('announcements');
request('/api/admin/session').then(showDashboard).catch(showLogin);
