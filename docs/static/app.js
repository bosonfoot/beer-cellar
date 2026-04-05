'use strict';

const DATA_URL = window.CELLAR_DATA_URL || '/api/beers';

// ── Status & Days Left logic ──────────────────────────────────────────────────

function getStatus(drinkAfter, drinkBy, imbibed) {
  if (imbibed) return 'Happily Imbibed';
  const today = new Date().toISOString().slice(0, 10);
  if (!drinkAfter && !drinkBy) return 'Unknown';
  if (drinkBy && today > drinkBy) return 'Past Peak';
  if (drinkAfter && today >= drinkAfter) return 'Drink Now';
  if (drinkAfter) {
    return daysLeft(drinkAfter) <= 60 ? 'Peak Approaching' : 'Aging';
  }
  return 'Unknown';
}

// Returns days remaining until drinkBy, or null if not applicable.
// Only meaningful when status is "Drink Now".
function daysLeft(drinkBy) {
  if (!drinkBy) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(drinkBy);
  end.setHours(0, 0, 0, 0);
  return Math.ceil((end - today) / (1000 * 60 * 60 * 24));
}

function monthsBetween(a, b) {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

const STATUS_CLASS = {
  'Drink Now':        'badge-drink-now',
  'Peak Approaching': 'badge-approaching',
  'Aging':            'badge-aging',
  'Past Peak':        'badge-past-peak',
  'Unknown':          'badge-unknown',
  'Happily Imbibed':  'badge-imbibed',
};

function applyBadges() {
  document.querySelectorAll('.badge[data-after]').forEach(el => {
    const status = getStatus(el.dataset.after, el.dataset.by, el.dataset.imbibed);
    el.textContent = status;
    el.className = 'badge ' + (STATUS_CLASS[status] || 'badge-unknown');
  });

  // Populate Days Left cells — "Drink Now" shows days until drink_by,
  // "Peak Approaching" shows days until drink_after (days until peak hits)
  const DAY_CLASSES = ['days-drink-now', 'days-approaching', 'days-aging', 'days-soon', 'days-urgent'];

  function applyDaysEl(el, isCell) {
    DAY_CLASSES.forEach(c => el.classList.remove(c));
    const status = getStatus(el.dataset.after, el.dataset.by, el.dataset.imbibed);
    if (status === 'Drink Now') {
      const d = daysLeft(el.dataset.by);
      if (d !== null) {
        el.textContent = d;
        if (isCell) el.dataset.sortVal = d;
        el.classList.add('days-drink-now');
        if (d <= 30)  el.classList.add('days-urgent');
        else if (d <= 90)  el.classList.add('days-soon');
      }
    } else if (status === 'Peak Approaching') {
      const d = daysLeft(el.dataset.after);
      if (d !== null) {
        el.textContent = d;
        if (isCell) el.dataset.sortVal = d;
        el.classList.add('days-approaching');
      }
    } else if (status === 'Aging') {
      const d = daysLeft(el.dataset.after);
      if (d !== null) {
        el.textContent = d;
        if (isCell) el.dataset.sortVal = d;
        el.classList.add('days-aging');
      }
    } else {
      el.textContent = '—';
      if (isCell) el.dataset.sortVal = '';
    }
  }

  document.querySelectorAll('td.col-days-left').forEach(td => applyDaysEl(td, true));
  document.querySelectorAll('span.card-days').forEach(span => applyDaysEl(span, false));
}

// ── Sorting ───────────────────────────────────────────────────────────────────

let sortCol = 'days_left';
let sortDir = 1;

function setupSort() {
  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (sortCol === col) {
        sortDir *= -1;
      } else {
        sortCol = col;
        sortDir = 1;
      }
      updateSortIndicators();
      sortTable();
    });
  });
}

function updateSortIndicators() {
  document.querySelectorAll('th.sortable').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.col === sortCol) {
      th.classList.add(sortDir === 1 ? 'sort-asc' : 'sort-desc');
    }
  });
}

// Columns that sort numerically
const NUMERIC_COLS = new Set(['year', 'abv', 'untappd_rating', 'days_left']);

// When sorting by days_left, status rank is the silent primary key so that
// Drink Now always groups above Peak Approaching (both show a days value,
// but the numbers mean different things and shouldn't be compared directly)
const STATUS_SORT_RANK = {
  'Drink Now':        0,
  'Peak Approaching': 1,
  'Aging':            2,
  'Unknown':          3,
  'Past Peak':        4,
  'Happily Imbibed':  5,
};

function cellValue(row, col) {
  // days_left uses a data attribute since the cell text changes dynamically
  if (col === 'days_left') {
    const td = row.querySelector('td.col-days-left');
    return td ? td.dataset.sortVal || '' : '';
  }
  const cells = row.querySelectorAll('td');
  const colIndex = { name: 1, year: 2, brewer: 3, abv: 4, untappd_rating: 5, drink_after: 6, drink_by: 7 };
  const idx = colIndex[col];
  if (idx === undefined) return '';
  const text = cells[idx].textContent.trim();
  return text === '—' ? '' : text;
}

function sortTable() {
  const tbody = document.getElementById('tableBody');
  const rows = Array.from(tbody.querySelectorAll('tr.beer-row'));
  rows.sort((a, b) => {
    // Imbibed rows always stay at the bottom
    const ai = a.dataset.imbibed ? 1 : 0;
    const bi = b.dataset.imbibed ? 1 : 0;
    if (ai !== bi) return ai - bi;

    // When sorting by days_left, group by status first — Drink Now before
    // Peak Approaching — because the two values measure different things
    if (sortCol === 'days_left') {
      const ra = STATUS_SORT_RANK[a.querySelector('.badge')?.textContent] ?? 3;
      const rb = STATUS_SORT_RANK[b.querySelector('.badge')?.textContent] ?? 3;
      if (ra !== rb) return ra - rb;
    }

    const av = cellValue(a, sortCol);
    const bv = cellValue(b, sortCol);
    if (av === '' && bv === '') return 0;
    if (av === '') return 1;
    if (bv === '') return -1;

    if (NUMERIC_COLS.has(sortCol)) {
      return (parseFloat(av) - parseFloat(bv)) * sortDir;
    }
    return av.localeCompare(bv) * sortDir;
  });
  rows.forEach(r => tbody.appendChild(r));
  if (document.getElementById('cardGrid')) syncCards();
}

// ── Filtering ─────────────────────────────────────────────────────────────────

function setupFilter() {
  document.getElementById('filterText').addEventListener('input', applyFilters);
  document.getElementById('filterStatus').addEventListener('change', applyFilters);
}

function applyFilters() {
  const text = document.getElementById('filterText').value.toLowerCase();
  const status = document.getElementById('filterStatus').value;
  let visible = 0;

  document.querySelectorAll('tr.beer-row').forEach(row => {
    const name = row.querySelector('td.beer-name').textContent.toLowerCase();
    const brewer = row.querySelector('td.col-brewer').textContent.toLowerCase();
    const rowStatus = row.querySelector('.badge').textContent;

    const matchText = !text || name.includes(text) || brewer.includes(text);
    const matchStatus = !status || rowStatus === status;

    row.style.display = matchText && matchStatus ? '' : 'none';
    if (matchText && matchStatus) visible++;
  });

  document.querySelectorAll('.beer-card').forEach(card => {
    const row = document.querySelector(`tr.beer-row[data-id="${card.dataset.id}"]`);
    if (row) card.style.display = row.style.display;
  });

  updateCount(visible);
}

// ── Beer count ────────────────────────────────────────────────────────────────

function updateCount(n) {
  const el = document.getElementById('beerCount');
  if (el) el.textContent = n === 1 ? '1 beer' : `${n} beers`;
}

function initCount() {
  updateCount(document.querySelectorAll('tr.beer-row').length);
}

// ── Detail modal ──────────────────────────────────────────────────────────────

function shortBrewer(name) {
  return name.replace(/\s+(Brewing|Brewery|Beer\s+Co\.?|Beer\s+Company)\s*$/i, '').trim();
}

function formatDate(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  if (!m) return y;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return day ? `${months[+m-1]} ${day}, ${y}` : `${months[+m-1]} ${y}`;
}

function drinkWindowText(beer) {
  if (!beer.drink_after && !beer.drink_by) return 'No window set';
  if (beer.drink_after && beer.drink_by)
    return `${formatDate(beer.drink_after)} — ${formatDate(beer.drink_by)}`;
  if (beer.drink_after) return `After ${formatDate(beer.drink_after)}`;
  return `Before ${formatDate(beer.drink_by)}`;
}

function autoLink(text) {
  if (!text) return '';
  return text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>'
  ).replace(
    /(^|[\s])((https?:\/\/)[^\s<]+)/g,
    '$1<a href="$2" target="_blank" rel="noopener">$2</a>'
  );
}

function renderModal(beer) {
  const status = getStatus(beer.drink_after, beer.drink_by, beer.date_imbibed);
  const badgeClass = STATUS_CLASS[status] || 'badge-unknown';
  const imgSrc = beer.image_path || '/static/images/default.svg';

  let html = `
    <div class="modal-header">
      <img class="modal-label-img"
           src="${imgSrc}"
           alt="${esc(beer.name)}"
           onerror="this.src='/static/images/default.svg'">
      <div class="modal-header-text">
        <div class="modal-beer-name">${esc(beer.name)}</div>
        <div class="modal-brewer">${esc(shortBrewer(beer.brewer))}</div>
      </div>
    </div>

    <div class="modal-window">
      <div>
        <div class="modal-window-label">Drinking window</div>
        <div class="modal-window-value">${drinkWindowText(beer)}</div>
      </div>
      <span class="badge ${badgeClass}" style="margin-left:auto">${status}</span>
    </div>

    <div class="modal-dates">
      ${beer.year ? `
      <div class="modal-date-item">
        <div class="modal-date-label">Vintage</div>
        <div class="modal-date-value">${beer.year}</div>
      </div>` : ''}
      <div class="modal-date-item">
        <div class="modal-date-label">ABV</div>
        <div class="modal-date-value">${beer.abv != null ? beer.abv.toFixed(1) + '%' : '—'}</div>
      </div>
      <div class="modal-date-item">
        <div class="modal-date-label">Bottled</div>
        <div class="modal-date-value">${formatDate(beer.date_bottled)}</div>
      </div>
      <div class="modal-date-item">
        <div class="modal-date-label">Drink After</div>
        <div class="modal-date-value">${formatDate(beer.drink_after)}</div>
      </div>
      <div class="modal-date-item">
        <div class="modal-date-label">Drink By</div>
        <div class="modal-date-value">${formatDate(beer.drink_by)}</div>
      </div>
      <div class="modal-date-item">
        <div class="modal-date-label">Added to Cellar</div>
        <div class="modal-date-value">${formatDate(beer.date_added)}</div>
      </div>
      ${beer.quantity > 1 ? `
      <div class="modal-date-item">
        <div class="modal-date-label">Bottles</div>
        <div class="modal-date-value">${beer.quantity}</div>
      </div>` : ''}
      ${beer.date_imbibed ? `
      <div class="modal-date-item">
        <div class="modal-date-label">Imbibed</div>
        <div class="modal-date-value">${formatDate(beer.date_imbibed)}</div>
      </div>` : ''}
    </div>
  `;

  if (beer.date_imbibed && beer.imbibe_notes) {
    html += `
      <div class="modal-section">
        <div class="modal-section-title">Tasting Notes</div>
        <div class="modal-section-body">${esc(beer.imbibe_notes)}</div>
      </div>`;
  }

  if (!beer.date_imbibed && !window.READ_ONLY) {
    html += `
      <div class="modal-imbibe" id="imbibeSection">
        <button class="btn-imbibe" id="imbibeBtn">IMBIBE!</button>
        <div class="imbibe-confirm" id="imbibeConfirm" hidden>
          <textarea id="imbibeNotes" class="imbibe-notes" placeholder="Tasting notes (optional)…" rows="3"></textarea>
          <div class="imbibe-actions">
            <button class="btn-imbibe-confirm" id="imbibeConfirmBtn">Confirm</button>
            <button class="btn-imbibe-cancel" id="imbibeCancelBtn">Cancel</button>
          </div>
        </div>
      </div>`;
  }

  if (beer.research) {
    html += `
      <div class="modal-section">
        <div class="modal-section-title">Research &amp; Aging Notes</div>
        <div class="modal-section-body">${autoLink(esc(beer.research))}</div>
      </div>`;
  }
  if (beer.food_pairings) {
    html += `
      <div class="modal-section">
        <div class="modal-section-title">Food Pairings</div>
        <div class="modal-section-body">${esc(beer.food_pairings)}</div>
      </div>`;
  }
  if (beer.considerations) {
    html += `
      <div class="modal-section">
        <div class="modal-section-title">Other Considerations</div>
        <div class="modal-section-body">${esc(beer.considerations)}</div>
      </div>`;
  }

  return html;
}

function esc(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function openModal(beerId) {
  fetch(`/api/beers/${beerId}`)
    .then(r => r.json())
    .then(beer => {
      document.getElementById('modalContent').innerHTML = renderModal(beer);
      document.getElementById('modal').removeAttribute('hidden');
      setupImbibeButton(beer.id);
    });
}

function setupImbibeButton(beerId) {
  const btn = document.getElementById('imbibeBtn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    document.getElementById('imbibeConfirm').removeAttribute('hidden');
    btn.setAttribute('hidden', '');
    document.getElementById('imbibeNotes').focus();
  });

  document.getElementById('imbibeCancelBtn').addEventListener('click', () => {
    document.getElementById('imbibeConfirm').setAttribute('hidden', '');
    btn.removeAttribute('hidden');
  });

  document.getElementById('imbibeConfirmBtn').addEventListener('click', () => {
    const notes = document.getElementById('imbibeNotes').value.trim();
    fetch(`/api/beers/${beerId}/imbibe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: notes || null }),
    })
      .then(r => r.json())
      .then(beer => {
        // Update the row in the table live
        const row = document.querySelector(`tr.beer-row[data-id="${beerId}"]`);
        if (row) {
          row.dataset.imbibed = '1';
          // Re-run badge + days logic for this row's cells
          row.querySelectorAll('td.col-days-left, .badge').forEach(el => {
            el.dataset.imbibed = '1';
          });
          applyBadges();
          sortTable();
        }
        const card = document.querySelector(`.beer-card[data-id="${beerId}"]`);
        if (card) card.dataset.imbibed = '1';
        syncCards();
        // Refresh modal content to show imbibed state
        document.getElementById('modalContent').innerHTML = renderModal(beer);
      });
  });
}

function closeModal() {
  document.getElementById('modal').setAttribute('hidden', '');
}

function setupModal() {
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });
  document.querySelectorAll('tr.beer-row').forEach(row => {
    row.addEventListener('click', () => openModal(row.dataset.id));
  });
}

// ── Card view ─────────────────────────────────────────────────────────────────

function syncCards() {
  const grid = document.getElementById('cardGrid');
  if (!grid) return;
  grid.innerHTML = '';
  document.querySelectorAll('tr.beer-row').forEach(row => {
    const id = row.dataset.id;
    const img = row.querySelector('td.col-img img');
    const nameTd = row.querySelector('td.beer-name');
    const brewer = row.querySelector('td.col-brewer').textContent.trim();
    const year = row.querySelector('td.col-year').textContent.trim();
    const abv = row.querySelector('td.col-abv').textContent.trim();
    const rating = row.querySelector('td.col-rating').textContent.trim();
    const daysTd = row.querySelector('td.col-days-left');
    const badgeEl = row.querySelector('.badge');

    const card = document.createElement('div');
    card.className = 'beer-card';
    card.dataset.id = id;
    if (row.dataset.imbibed) card.dataset.imbibed = row.dataset.imbibed;
    card.style.display = row.style.display;

    const metaParts = [];
    if (year && year !== '—') metaParts.push(`<span>${year}</span>`);
    if (abv && abv !== '—') metaParts.push(`<span>${abv}</span>`);
    if (rating && rating !== '—') metaParts.push(`<span class="card-rating">${rating}</span>`);

    card.innerHTML = `
      <div class="card-img-wrap">
        <img class="card-thumb" src="${img ? img.src : '/static/images/default.svg'}" alt=""
             onerror="this.src='/static/images/default.svg'">
      </div>
      <div class="card-body">
        <div class="card-header">
          <div class="card-name">${nameTd.innerHTML}</div>
          <div class="card-brewer">${esc(brewer)}</div>
        </div>
        ${metaParts.length ? `<div class="card-meta">${metaParts.join('<span class="card-sep">·</span>')}</div>` : ''}
        <div class="card-window">
          <span class="card-days"
                data-by="${daysTd.dataset.by}"
                data-after="${daysTd.dataset.after}"
                data-imbibed="${daysTd.dataset.imbibed}"></span>
          <span data-after="${badgeEl.dataset.after}"
                data-by="${badgeEl.dataset.by}"
                data-imbibed="${badgeEl.dataset.imbibed}"
                class="${badgeEl.className}">${badgeEl.textContent}</span>
        </div>
      </div>`;

    // Copy computed days state from the table cell
    const cardDays = card.querySelector('span.card-days');
    cardDays.textContent = daysTd.textContent;
    daysTd.classList.forEach(c => { if (c.startsWith('days-')) cardDays.classList.add(c); });

    card.addEventListener('click', () => openModal(id));
    grid.appendChild(card);
  });
}

// ── View toggle ───────────────────────────────────────────────────────────────

const CARD_VIEW_KEY = 'cellar-view';

function getPreferredView() {
  return localStorage.getItem(CARD_VIEW_KEY)
    || (window.matchMedia('(max-width: 640px)').matches ? 'card' : 'table');
}

function setView(view) {
  document.querySelector('.table-wrap').hidden = (view === 'card');
  document.getElementById('cardGrid').hidden   = (view === 'table');
  document.getElementById('sortControls').hidden = (view === 'table');
  const lbl  = document.querySelector('.view-toggle-label');
  const icon = document.querySelector('.view-toggle-icon');
  lbl.textContent  = view === 'card' ? 'Table' : 'Cards';
  icon.textContent = view === 'card' ? '☰'     : '⊞';
  localStorage.setItem(CARD_VIEW_KEY, view);
}

function setupViewToggle() {
  document.getElementById('viewToggle').addEventListener('click', () => {
    const current = localStorage.getItem(CARD_VIEW_KEY) || getPreferredView();
    const next = current === 'card' ? 'table' : 'card';
    if (next === 'card') syncCards();
    setView(next);
  });
}

function setupCardSort() {
  const sel = document.getElementById('cardSort');
  const dirBtn = document.getElementById('cardSortDir');
  sel.value = sortCol;
  sel.addEventListener('change', () => {
    sortCol = sel.value;
    sortDir = 1;
    dirBtn.textContent = '▲';
    updateSortIndicators();
    sortTable();
  });
  dirBtn.addEventListener('click', () => {
    sortDir *= -1;
    dirBtn.textContent = sortDir === 1 ? '▲' : '▼';
    updateSortIndicators();
    sortTable();
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

applyBadges();
initCount();
setupSort();
setupFilter();
setupModal();
setupViewToggle();
setupCardSort();
updateSortIndicators();
sortTable();
setView(getPreferredView());
document.getElementById('tableBody').classList.add('ready');
