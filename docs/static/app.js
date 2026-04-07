'use strict';

const DATA_URL = window.CELLAR_DATA_URL || '/api/beers';

// ── Status & Days Left logic ──────────────────────────────────────────────────

function getStatus(drinkAfter, drinkBy, imbibed, label) {
  if (label) return label;
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
  'Test':             'badge-test',
};

function applyBadges() {
  document.querySelectorAll('.badge[data-after]').forEach(el => {
    const status = getStatus(el.dataset.after, el.dataset.by, el.dataset.imbibed, el.dataset.label);
    el.textContent = status;
    el.className = 'badge ' + (STATUS_CLASS[status] || 'badge-unknown');
  });

  // Populate Days Left cells — "Drink Now" shows days until drink_by,
  // "Peak Approaching" shows days until drink_after (days until peak hits)
  const DAY_CLASSES = ['days-drink-now', 'days-approaching', 'days-aging', 'days-soon', 'days-urgent'];

  function applyDaysEl(el, isCell) {
    DAY_CLASSES.forEach(c => el.classList.remove(c));
    const status = getStatus(el.dataset.after, el.dataset.by, el.dataset.imbibed, el.dataset.label);
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
  'Test':             6,
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
  const status = getStatus(beer.drink_after, beer.drink_by, beer.date_imbibed, beer.label);
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

  if (!window.READ_ONLY) {
    html += `
      <div class="modal-delete-row">
        <button class="btn-delete-beer" id="deleteBeerBtn" data-id="${beer.id}">Delete</button>
      </div>`;
  }

  return html;
}

function esc(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function openModal(beerId) {
  fetch(`cellar.json`).then(r=>r.json()).then(beers=>beers.find(b=>b.id==beerId))
    .then(beer => {
      document.getElementById('modalContent').innerHTML = renderModal(beer);
      document.getElementById('modal').removeAttribute('hidden');
      setupImbibeButton(beer.id);
      setupDeleteButton(beer.id);
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

function setupDeleteButton(beerId) {
  const btn = document.getElementById('deleteBeerBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (!confirm('Delete this beer from the cellar?')) return;
    fetch(`/api/beers/${beerId}`, { method: 'DELETE' })
      .then(r => {
        if (!r.ok) return;
        closeModal();
        const row = document.querySelector(`tr.beer-row[data-id="${beerId}"]`);
        if (row) row.remove();
        const card = document.querySelector(`.beer-card[data-id="${beerId}"]`);
        if (card) card.remove();
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

    // Merge days into the badge pill text for cards — e.g. "Drink within 330 days"
    const d = parseInt(daysTd.textContent, 10);
    if (!isNaN(d)) {
      const cardBadge = card.querySelector('.badge');
      const dw = d === 1 ? 'day' : 'days';
      const status = badgeEl.textContent;
      if (status === 'Drink Now')        cardBadge.textContent = `Drink within ${d} ${dw}`;
      else if (status === 'Peak Approaching') cardBadge.textContent = `Peak in ${d} ${dw}`;
      else if (status === 'Aging')       cardBadge.textContent = `Ready in ${d} ${dw}`;
    }
    // Hide the now-redundant standalone days number
    cardDays.hidden = true;

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

// ── Add Beer modal ────────────────────────────────────────────────────────────

(function () {
  if (!document.getElementById('addBeerBtn')) return; // read-only / static site

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Inject modal DOM once
  const overlay = document.createElement('div');
  overlay.id = 'addBeerModal';
  overlay.setAttribute('hidden', '');
  overlay.innerHTML = `
    <div class="add-beer-box">
      <div class="add-beer-header">
        <span class="add-beer-title">Add Beer</span>
        <button class="add-beer-close" id="addBeerClose">✕</button>
      </div>
      <div id="addBeerBody"></div>
    </div>`;
  document.body.appendChild(overlay);

  const state = { step: 0, results: [], selected: null, bottledY: '', bottledM: '', bottledD: '' };

  function openAddBeer() {
    overlay.removeAttribute('hidden');
    fetch('/api/auth')
      .then(r => { if (r.ok) return renderStep1(); else renderStep0(); })
      .catch(() => renderStep0());
  }

  function closeAddBeer() {
    overlay.setAttribute('hidden', '');
    state.results = [];
    state.selected = null;
    state.bottledY = '';
    state.bottledM = '';
    state.bottledD = '';
  }

  function body() { return document.getElementById('addBeerBody'); }

  // ── Step indicator ────────────────────────────────────────────────────────

  function stepIndicator(current) {
    // Steps 1-4 (auth step 0 has no indicator)
    const labels = ['Search', 'Results', 'Confirm', 'Done'];
    let html = '<div class="step-indicator">';
    for (let i = 0; i < 4; i++) {
      const idx = i + 1;
      let cls = idx < current ? 'done' : idx === current ? 'active' : '';
      html += `<div class="step-dot ${cls}">${idx < current ? '✓' : idx}</div>`;
      if (i < 3) html += '<div class="step-line"></div>';
    }
    html += '</div>';
    return html;
  }

  // ── Step 0: Auth ──────────────────────────────────────────────────────────

  function renderStep0(errorMsg) {
    body().innerHTML = `
      <div class="add-beer-auth">
        <label>Enter cellar password</label>
        <input class="add-field" type="password" id="authPwInput" placeholder="Password" autocomplete="current-password">
        ${errorMsg ? `<div class="add-beer-error">${esc(errorMsg)}</div>` : ''}
        <div class="add-beer-actions">
          <button class="btn-primary" id="authSubmitBtn">Unlock</button>
        </div>
      </div>`;
    const input = document.getElementById('authPwInput');
    const btn = document.getElementById('authSubmitBtn');
    input.focus();
    function doAuth() {
      btn.disabled = true;
      fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: input.value }),
      }).then(r => {
        if (r.ok) {
          renderStep1();
        } else {
          renderStep0('Wrong password.');
        }
      }).catch(() => renderStep0('Network error.'));
    }
    btn.addEventListener('click', doAuth);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doAuth(); });
  }

  // ── Step 1: Search ────────────────────────────────────────────────────────

  function renderStep1() {
    const brewerList = (window.CELLAR_BREWERS || [])
      .map(b => `<option value="${esc(b)}">`)
      .join('');
    body().innerHTML = `
      ${stepIndicator(1)}
      <datalist id="brewerListData">${brewerList}</datalist>
      <div class="add-beer-form">
        <label>Beer name</label>
        <input class="add-field" id="lookupName" type="text" placeholder="e.g. Oude Geuze" autocomplete="off">
        <label>Brewery</label>
        <input class="add-field" id="lookupBrewery" type="text" placeholder="Optional" list="brewerListData" autocomplete="off">
        <label>Bottled</label>
        <div class="date-row">
          <input class="add-field" id="s1-bottled-y" type="number" placeholder="YYYY" min="1900" max="2100" style="width:70px" value="${state.bottledY}">
          <select class="add-field" id="s1-bottled-m">
            <option value="">—</option>
            ${MONTHS.map((m, i) => `<option value="${String(i+1).padStart(2,'0')}" ${state.bottledM === String(i+1).padStart(2,'0') ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
          <input class="add-field" id="s1-bottled-d" type="number" placeholder="DD" min="1" max="31" style="width:55px" value="${state.bottledD}">
        </div>
      </div>
      <div class="add-beer-actions">
        <button class="btn-secondary" id="addManuallyBtn">Add Manually</button>
        <button class="btn-primary" id="doLookupBtn">Look Up</button>
      </div>`;
    document.getElementById('lookupName').focus();
    document.getElementById('doLookupBtn').addEventListener('click', doLookup);
    document.getElementById('addManuallyBtn').addEventListener('click', () => {
      saveBottledDateFromStep1();
      state.selected = null;
      renderStep3({});
    });
    document.getElementById('lookupName').addEventListener('keydown', e => {
      if (e.key === 'Enter') doLookup();
    });
  }

  function saveBottledDateFromStep1() {
    state.bottledY = (document.getElementById('s1-bottled-y')?.value || '').trim();
    state.bottledM = document.getElementById('s1-bottled-m')?.value || '';
    state.bottledD = (document.getElementById('s1-bottled-d')?.value || '').trim();
  }

  // ── Step 2: Results ───────────────────────────────────────────────────────

  function doLookup() {
    saveBottledDateFromStep1();
    const q = document.getElementById('lookupName').value.trim();
    const brewery = document.getElementById('lookupBrewery').value.trim();
    if (!q) return;
    body().innerHTML = '<div class="add-beer-loading">Searching Untappd…</div>';
    const url = '/api/lookup?q=' + encodeURIComponent(q) + (brewery ? '&brewery=' + encodeURIComponent(brewery) : '');
    fetch(url)
      .then(r => {
        if (r.status === 403) { renderStep0(); return null; }
        return r.json();
      })
      .then(results => {
        if (!results) return;
        state.results = results;
        renderStep2();
      })
      .catch(() => {
        body().innerHTML = '<div class="add-beer-loading">Search failed. Try again.</div>';
      });
  }

  function renderStep2() {
    const results = state.results;
    let listHtml = '';
    if (results.length === 0) {
      listHtml = '<div class="add-beer-loading">No results found.</div>';
    } else {
      listHtml = '<div class="lookup-results">';
      results.forEach((r, i) => {
        const meta = [r.brewer, r.style, r.abv ? r.abv.toFixed(1) + '% ABV' : null].filter(Boolean).join(' · ');
        const thumb = r.label_url
          ? `<img class="lookup-result-thumb" src="${esc(r.label_url)}" alt="" onerror="this.style.visibility='hidden'">`
          : `<div class="lookup-result-thumb"></div>`;
        listHtml += `
          <div class="lookup-result" data-idx="${i}">
            ${thumb}
            <div class="lookup-result-info">
              <div class="lookup-result-name">${esc(r.name || '—')}</div>
              <div class="lookup-result-meta">${esc(meta)}</div>
            </div>
          </div>`;
      });
      listHtml += '</div>';
    }
    body().innerHTML = `
      ${stepIndicator(2)}
      ${listHtml}
      <div class="add-beer-actions">
        <button class="btn-secondary" id="backToStep1Btn">← Back</button>
        <button class="btn-secondary" id="noneOfTheseBtn">None of these</button>
      </div>`;
    document.querySelectorAll('.lookup-result').forEach(el => {
      el.addEventListener('click', () => selectResult(parseInt(el.dataset.idx, 10)));
    });
    document.getElementById('backToStep1Btn').addEventListener('click', renderStep1);
    document.getElementById('noneOfTheseBtn').addEventListener('click', () => renderStep3({}));
  }

  function selectResult(idx) {
    const r = state.results[idx];
    body().innerHTML = '<div class="add-beer-loading">Loading beer details…</div>';
    fetch(`/api/lookup/${r.untappd_id}?slug=${encodeURIComponent(r.slug)}`)
      .then(res => {
        if (res.status === 403) { renderStep0(); return null; }
        if (!res.ok) return r; // fallback to search result data
        return res.json();
      })
      .then(beer => {
        if (!beer) return;
        state.selected = beer;
        renderStep3(beer);
      });
  }

  // ── Step 3: Confirm form ──────────────────────────────────────────────────

  function renderStep3(beer) {
    const brewerList = (window.CELLAR_BREWERS || [])
      .map(b => `<option value="${esc(b)}">`)
      .join('');
    const imgPreview = (beer.image_url || beer.label_url)
      ? `<img class="add-beer-img-preview" src="${esc(beer.image_url || beer.label_url)}" alt="" onerror="this.style.display='none'">`
      : '';
    body().innerHTML = `
      ${stepIndicator(3)}
      <datalist id="brewerListData3">${brewerList}</datalist>
      <div class="add-beer-form">
        ${imgPreview ? `<label></label>${imgPreview}` : ''}
        <label>Beer name *</label>
        <input class="add-field" id="f-name" type="text" value="${esc(beer.name || '')}" required>
        <label>Brewery *</label>
        <input class="add-field" id="f-brewer" type="text" value="${esc(beer.brewer || '')}" list="brewerListData3" required>
        <label>Bottled</label>
        <div class="date-row">
          <input class="add-field" id="f-bottled-y" type="number" placeholder="YYYY" min="1900" max="2100" style="width:70px" value="${state.bottledY}">
          <select class="add-field" id="f-bottled-m">
            <option value="">—</option>
            ${MONTHS.map((m, i) => `<option value="${String(i+1).padStart(2,'0')}" ${state.bottledM === String(i+1).padStart(2,'0') ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
          <input class="add-field" id="f-bottled-d" type="number" placeholder="DD" min="1" max="31" style="width:55px" value="${state.bottledD}">
        </div>
        <label>ABV</label>
        <input class="add-field" id="f-abv" type="number" step="0.1" min="0" max="100" value="${beer.abv != null ? beer.abv : ''}">
        <label>Year</label>
        <input class="add-field" id="f-year" type="number" min="1900" max="2100" value="${beer.year != null ? beer.year : (beer.name ? (beer.name.match(/\b(19|20)\d{2}\b/) || [])[0] || '' : '')}">
        <label>Quantity</label>
        <input class="add-field" id="f-qty" type="number" min="1" value="1">
        <label>Rating</label>
        <input class="add-field" id="f-rating" type="number" step="0.01" min="0" max="5" value="${beer.rating != null ? beer.rating : ''}">
        <label>Notes</label>
        <textarea class="add-field" id="f-considerations" rows="3" placeholder="Optional…">${esc(beer.description || '')}</textarea>
        <label>Label</label>
        <input class="add-field" id="f-label" type="text" placeholder="e.g. Test" value="">
      </div>
      <div class="add-beer-error" id="submitError" hidden></div>
      <div class="add-beer-actions">
        <button class="btn-secondary" id="backToStep2Btn">${state.results.length ? '← Back' : '← Back'}</button>
        <button class="btn-primary" id="submitBeerBtn">Add to Cellar</button>
      </div>`;

    document.getElementById('backToStep2Btn').addEventListener('click', () => {
      if (state.results.length) renderStep2(); else renderStep1();
    });
    document.getElementById('submitBeerBtn').addEventListener('click', doSubmit);
  }

  // ── Step 3 → submit ───────────────────────────────────────────────────────

  function doSubmit() {
    const name = document.getElementById('f-name').value.trim();
    const brewer = document.getElementById('f-brewer').value.trim();
    const errEl = document.getElementById('submitError');
    if (!name || !brewer) {
      errEl.textContent = 'Beer name and brewery are required.';
      errEl.removeAttribute('hidden');
      return;
    }
    errEl.setAttribute('hidden', '');

    const abv = document.getElementById('f-abv').value;
    const year = document.getElementById('f-year').value;
    const qty = document.getElementById('f-qty').value;
    const rating = document.getElementById('f-rating').value;
    const considerations = document.getElementById('f-considerations').value.trim();
    const label = document.getElementById('f-label').value.trim();
    const by = document.getElementById('f-bottled-y').value.trim();
    const bm = document.getElementById('f-bottled-m').value;
    const bd = document.getElementById('f-bottled-d').value.trim();

    let date_bottled = null;
    if (by) {
      date_bottled = by;
      if (bm) {
        date_bottled = `${by}-${bm}`;
        if (bd) date_bottled += `-${String(bd).padStart(2, '0')}`;
      }
    }

    const payload = {
      name,
      brewer,
      abv: abv ? parseFloat(abv) : null,
      year: year ? parseInt(year, 10) : null,
      quantity: qty ? parseInt(qty, 10) : 1,
      date_bottled,
      untappd_rating: rating ? parseFloat(rating) : null,
      considerations: considerations || null,
      image_url: state.selected ? (state.selected.image_url || null) : null,
      style: state.selected ? (state.selected.style || null) : null,
      label: label || null,
    };

    const btn = document.getElementById('submitBeerBtn');
    btn.disabled = true;
    fetch('/api/beers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(r => {
      if (r.status === 403) { renderStep0(); return null; }
      if (!r.ok) { btn.disabled = false; errEl.textContent = 'Server error. Try again.'; errEl.removeAttribute('hidden'); return null; }
      return r.json();
    }).then(beer => {
      if (!beer) return;
      renderStep4(beer);
      injectNewBeerRow(beer);
    });
  }

  // ── Step 4: Done ──────────────────────────────────────────────────────────

  function renderStep4(beer) {
    body().innerHTML = `
      ${stepIndicator(4)}
      <div class="add-beer-success">
        <div class="add-beer-success-icon">🍺</div>
        <div class="add-beer-success-name">${esc(beer.name)}</div>
        <div class="add-beer-success-brewer">${esc(beer.brewer)}</div>
        <div class="research-status" id="researchStatus">Researching drink window…</div>
        <button class="btn-primary" id="addBeerDoneBtn" style="margin-top:1rem">Done</button>
      </div>`;
    document.getElementById('addBeerDoneBtn').addEventListener('click', closeAddBeer);

    // Poll for drink window research results (written by background agent)
    let attempts = 0;
    const poll = setInterval(() => {
      if (++attempts > 30) {  // give up after 90 seconds
        clearInterval(poll);
        const el = document.getElementById('researchStatus');
        if (el) el.textContent = 'No drink window found — you can add it manually later.';
        return;
      }
      fetch(`/api/beers/${beer.id}`)
        .then(r => r.json())
        .then(updated => {
          if (updated.drink_after || updated.drink_by) {
            clearInterval(poll);
            const el = document.getElementById('researchStatus');
            if (el) el.textContent = '✓ Drink window found';
            updateRowFromResearch(updated);
          }
        })
        .catch(() => {});
    }, 3000);
  }

  function updateRowFromResearch(beer) {
    const row = document.querySelector(`tr.beer-row[data-id="${beer.id}"]`);
    if (!row) return;

    // Update date cells
    const afterTd = row.querySelector('td.col-drink-after');
    const byTd = row.querySelector('td.col-drink-by');
    const daysTd = row.querySelector('td.col-days-left');
    const badgeEl = row.querySelector('.badge');

    if (afterTd) afterTd.textContent = beer.drink_after || '—';
    if (byTd)    byTd.textContent    = beer.drink_by    || '—';

    if (daysTd) {
      daysTd.dataset.after = beer.drink_after || '';
      daysTd.dataset.by    = beer.drink_by    || '';
    }
    if (badgeEl) {
      badgeEl.dataset.after = beer.drink_after || '';
      badgeEl.dataset.by    = beer.drink_by    || '';
    }

    applyBadges();
    sortTable();
    syncCards();
  }

  // ── Inject new row into the live table ───────────────────────────────────

  function injectNewBeerRow(beer) {
    const emptyRow = document.getElementById('emptyRow');
    if (emptyRow) emptyRow.remove();

    const imgSrc = beer.image_path || '/static/images/default.svg';
    const abvText = beer.abv != null ? beer.abv.toFixed(1) + '%' : '—';
    const ratingText = beer.untappd_rating != null ? beer.untappd_rating.toFixed(2) : '—';
    const yearText = beer.year || '—';
    const qtyHtml = beer.quantity > 1 ? ` <span class="qty-badge">×${beer.quantity}</span>` : '';

    const tr = document.createElement('tr');
    tr.className = 'beer-row';
    tr.dataset.id = beer.id;
    tr.innerHTML = `
      <td class="col-img"><img class="beer-thumb" src="${imgSrc}" alt="${esc(beer.name)}" onerror="this.src='/static/images/default.svg'"></td>
      <td class="beer-name">${esc(beer.name)}${qtyHtml}</td>
      <td class="col-year">${yearText}</td>
      <td class="col-brewer">${esc(shortBrewer(beer.brewer))}</td>
      <td class="col-abv">${abvText}</td>
      <td class="col-rating">${ratingText}</td>
      <td class="col-drink-after">${beer.drink_after || '—'}</td>
      <td class="col-drink-by">${beer.drink_by || '—'}</td>
      <td class="col-days-left"
          data-by="${beer.drink_by || ''}"
          data-after="${beer.drink_after || ''}"
          data-imbibed="${beer.date_imbibed || ''}"
          data-label="${beer.label || ''}">—</td>
      <td><span class="badge"
                data-after="${beer.drink_after || ''}"
                data-by="${beer.drink_by || ''}"
                data-imbibed="${beer.date_imbibed || ''}"
                data-label="${beer.label || ''}"></span></td>`;

    document.getElementById('tableBody').appendChild(tr);
    tr.addEventListener('click', () => openModal(beer.id));

    applyBadges();
    sortTable();
    syncCards();
    applyFilters();

    // Update brewer autocomplete list
    if (window.CELLAR_BREWERS && !window.CELLAR_BREWERS.includes(beer.brewer)) {
      window.CELLAR_BREWERS.push(beer.brewer);
      window.CELLAR_BREWERS.sort();
    }
  }

  // ── Event wiring ─────────────────────────────────────────────────────────

  document.getElementById('addBeerBtn').addEventListener('click', openAddBeer);
  document.getElementById('addBeerClose').addEventListener('click', closeAddBeer);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeAddBeer(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !overlay.hasAttribute('hidden')) closeAddBeer();
  });
})();
