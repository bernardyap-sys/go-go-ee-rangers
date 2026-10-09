const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('.site-nav');

menuButton.addEventListener('click', () => {
  const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
  menuButton.setAttribute('aria-expanded', String(!isOpen));
  menuButton.setAttribute('aria-label', isOpen ? 'Open navigation' : 'Close navigation');
  navigation.classList.toggle('open', !isOpen);
});

navigation.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', 'Open navigation');
    navigation.classList.remove('open');
  });
});

function node(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = value;
  return element;
}

function renderAnnouncements(items) {
  if (!items.length) return;
  document.querySelector('#featured-announcement-title').textContent = items[0].title;
  document.querySelector('#featured-announcement-description').textContent = items[0].description;
  document.querySelector('.card-meta span:last-child').textContent = items[0].pinned ? 'PINNED NOTE' : 'LATEST NOTE';
  const list = document.querySelector('#announcement-list');
  list.replaceChildren();
  list.hidden = items.length < 2;
  for (const item of items.slice(1)) {
    const card = node('article', 'announcement-small');
    card.append(node('span', 'announcement-small-label', item.pinned ? 'PINNED NOTICE' : 'CLASS NOTICE'));
    card.append(node('h3', '', item.title));
    card.append(node('p', '', item.description));
    list.append(card);
  }
}

function renderSchedule(items) {
  if (!items.length) return;
  document.querySelector('#schedule-empty').hidden = true;
  const days = document.querySelectorAll('.schedule-day-items');
  for (const day of days) day.replaceChildren();
  for (const item of items) {
    const slot = node('div', 'schedule-slot');
    slot.append(node('time', '', `${item.start_time}–${item.end_time}`));
    slot.append(node('b', '', item.title));
    if (item.location) slot.append(node('small', '', item.location));
    days[item.day]?.append(slot);
  }
}

const progressKey = 'pkee3-task-progress-v1';
const completedTasks = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(progressKey));
    return new Set(Array.isArray(saved) ? saved.filter((value) => typeof value === 'string') : []);
  } catch { return new Set(); }
})();
const dueFormatter = new Intl.DateTimeFormat('en-MY', {
  timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false,
});
let countdowns = [];

function updateCountdowns() {
  const now = Date.now();
  for (const { dueAt, timer, value } of countdowns) {
    const remaining = new Date(dueAt).valueOf() - now;
    timer.classList.toggle('is-overdue', remaining <= 0);
    timer.classList.toggle('is-urgent', remaining > 0 && remaining <= 86_400_000);
    timer.querySelector('small').textContent = remaining <= 0 ? 'STATUS' : 'TIME LEFT';
    if (remaining <= 0) { value.textContent = 'Deadline passed'; continue; }
    const seconds = Math.ceil(remaining / 1000);
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor(seconds / 3_600) % 24;
    const minutes = Math.floor(seconds / 60) % 60;
    const rest = seconds % 60;
    value.textContent = `${days ? `${days}d ` : ''}${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(rest).padStart(2, '0')}s`;
  }
}

function renderTasks(items) {
  if (!items?.length) return;
  const list = document.querySelector('#task-list');
  list.replaceChildren();
  countdowns = [];
  for (const item of items) {
    const row = node('article', 'task-row');
    const checkbox = node('input', 'task-check');
    const key = `${item.id}:${item.created_at}`;
    checkbox.type = 'checkbox';
    checkbox.checked = completedTasks.has(key);
    row.classList.toggle('is-done', checkbox.checked);
    const updateLabel = () => checkbox.setAttribute('aria-label', `Mark ${item.title} ${checkbox.checked ? 'incomplete' : 'complete'} on this device`);
    updateLabel();
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) completedTasks.add(key);
      else completedTasks.delete(key);
      row.classList.toggle('is-done', checkbox.checked);
      updateLabel();
      try { localStorage.setItem(progressKey, JSON.stringify([...completedTasks])); } catch {}
    });
    const copy = node('div', 'task-copy');
    copy.append(node('h3', '', item.title));
    if (item.description) copy.append(node('p', '', item.description));
    const due = node('time', 'task-due', `Due ${dueFormatter.format(new Date(item.due_at))} MYT`);
    due.dateTime = item.due_at;
    copy.append(due);
    const timer = node('div', 'task-timer');
    const value = node('strong', 'task-countdown');
    timer.append(node('small', '', 'TIME LEFT'), value);
    row.append(checkbox, copy, timer);
    list.append(row);
    countdowns.push({ dueAt: item.due_at, timer, value });
  }
  updateCountdowns();
}

setInterval(updateCountdowns, 1000);

function renderResources(items) {
  if (!items.length) return;
  const grid = document.querySelector('#resource-grid');
  grid.replaceChildren();
  const symbols = { slides: '▤', assignment: '⌁', reading: '◫', link: '↗' };
  const labels = { slides: 'LECTURE SLIDES', assignment: 'ASSIGNMENT', reading: 'READING', link: 'USEFUL LINK' };
  for (const [index, item] of items.entries()) {
    const card = node('a', 'resource-card');
    card.href = item.url;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
    card.append(node('span', 'resource-index', String(index + 1).padStart(2, '0')));
    card.append(node('div', 'resource-symbol', symbols[item.category] || '↗'));
    const copy = node('div');
    copy.append(node('h3', '', item.title), node('p', '', item.description));
    card.append(copy, node('span', 'coming-soon', `${labels[item.category] || 'RESOURCE'} ↗`));
    grid.append(card);
  }
}

function renderActivities(items) {
  if (!items.length) return;
  const list = document.querySelector('#activities-list');
  list.replaceChildren();
  for (const [index, item] of items.entries()) {
    const row = node('div', 'activity-row');
    row.append(node('span', '', String(index + 1).padStart(2, '0')));
    const copy = node('div');
    copy.append(node('h3', '', item.title), node('p', '', item.description));
    if (item.date) copy.append(node('small', 'activity-date', item.date));
    row.append(copy, node('span', 'activity-mark', '↗'));
    list.append(row);
  }
}

fetch('/api/content')
  .then((response) => {
    if (!response.ok) throw new Error('Content unavailable');
    return response.json();
  })
  .then((content) => {
    renderAnnouncements(content.announcements);
    renderSchedule(content.schedule);
    renderTasks(content.tasks);
    renderResources(content.resources);
    renderActivities(content.activities);
    document.querySelector('#contact-text').textContent = content.contact;
  })
  .catch(() => {});
