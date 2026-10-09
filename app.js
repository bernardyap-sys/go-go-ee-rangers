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
    renderResources(content.resources);
    renderActivities(content.activities);
    document.querySelector('#contact-text').textContent = content.contact;
  })
  .catch(() => {});
