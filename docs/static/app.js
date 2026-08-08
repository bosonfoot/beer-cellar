'use strict';

const DATA_URL = window.CELLAR_DATA_URL || '/api/beers';
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

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
  // Beer badges only — wine badges are handled by applyWineBadges()
  document.querySelectorAll('.badge[data-after]:not(.wine-badge)').forEach(el => {
    const status = getStatus(el.dataset.after, el.dataset.by, el.dataset.imbibed, el.dataset.label);
    el.textContent = status;
    el.className = 'badge ' + (STATUS_CLASS[status] || 'badge-unknown');
  });

  // Populate Days Left cells — always shows days remaining until drink_by
  // (i.e. days until the beer is past its peak), regardless of status.
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
      const d = daysLeft(el.dataset.by);
      if (d !== null) {
        el.textContent = d;
        if (isCell) el.dataset.sortVal = d;
        el.classList.add('days-approaching');
      }
    } else if (status === 'Aging') {
      const d = daysLeft(el.dataset.by);
      if (d !== null) {
        el.textContent = d;
        if (isCell) el.dataset.sortVal = d;
        el.classList.add('days-aging');
      }
    } else if (status === 'Past Peak') {
      // Negative days overdue (past drink_by) — sorts ahead of everything via
      // STATUS_SORT_RANK regardless of direction; the number shows how overdue.
      const d = daysLeft(el.dataset.by);
      if (d !== null) {
        el.textContent = d;
        if (isCell) el.dataset.sortVal = d;
        el.classList.add('days-urgent');
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
// but the numbers mean different things and shouldn't be compared directly).
// Past Peak ranks first — those beers are overdue, more urgent than anything
// still inside its window — so it bubbles to the top regardless of sort direction.
const STATUS_SORT_RANK = {
  'Past Peak':        0,
  'Drink Now':        1,
  'Peak Approaching': 2,
  'Aging':            3,
  'Unknown':          4,
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
  let bottles = 0;

  document.querySelectorAll('tr.beer-row').forEach(row => {
    const name = row.querySelector('td.beer-name').textContent.toLowerCase();
    const brewer = row.querySelector('td.col-brewer').textContent.toLowerCase();
    const rowStatus = row.querySelector('.badge').textContent;

    const matchText = !text || name.includes(text) || brewer.includes(text);
    const matchStatus = !status || rowStatus === status;

    row.style.display = matchText && matchStatus ? '' : 'none';
    if (matchText && matchStatus && !row.dataset.imbibed) {
      visible++;
      bottles += parseInt(row.dataset.qty || 1);
    }
  });

  document.querySelectorAll('.beer-card').forEach(card => {
    const row = document.querySelector(`tr.beer-row[data-id="${card.dataset.id}"]`);
    if (row) card.style.display = row.style.display;
  });

  updateCount(visible, bottles);
}

// ── Cellar count ──────────────────────────────────────────────────────────────

let _beerCountN = 0, _beerCountBottles = 0;
let _wineCountN = 0, _wineCountBottles = 0;

function renderCellarCount() {
  const el = document.getElementById('cellarCount');
  if (!el) return;
  const bStr = `${_beerCountN} ${_beerCountN === 1 ? 'beer' : 'beers'} (${_beerCountBottles} ${_beerCountBottles === 1 ? 'bottle' : 'bottles'})`;
  const wStr = `${_wineCountN} ${_wineCountN === 1 ? 'wine' : 'wines'} (${_wineCountBottles} ${_wineCountBottles === 1 ? 'bottle' : 'bottles'})`;
  el.textContent = `${bStr} · ${wStr}`;
}

function updateCount(n, bottles) {
  _beerCountN = n;
  _beerCountBottles = bottles;
  renderCellarCount();
}

function updateWineCount(n, bottles) {
  _wineCountN = n;
  _wineCountBottles = bottles;
  renderCellarCount();
}

function initCount() {
  // Beers
  const bRows = document.querySelectorAll('tr.beer-row:not([data-imbibed])');
  let bBottles = 0;
  bRows.forEach(r => { bBottles += parseInt(r.dataset.qty || 1); });
  _beerCountN = bRows.length;
  _beerCountBottles = bBottles;

  // Wines
  const wRows = document.querySelectorAll('tr.wine-row:not([data-imbibed])');
  let wBottles = 0;
  wRows.forEach(r => { wBottles += parseInt(r.dataset.qty || 1); });
  _wineCountN = wRows.length;
  _wineCountBottles = wBottles;

  renderCellarCount();
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

  if (beer.tasting_history && beer.tasting_history.length > 0) {
    html += `
      <div class="modal-section">
        <div class="modal-section-title">Previous Tastings</div>`;
    for (const t of beer.tasting_history) {
      html += `
        <div class="tasting-entry">
          <div class="tasting-date">${formatDate(t.date_imbibed)}</div>
          ${t.imbibe_notes ? `<div class="tasting-entry-notes">${esc(t.imbibe_notes)}</div>` : ''}
        </div>`;
    }
    html += `</div>`;
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
        <button class="btn-modal-edit" id="editBeerBtn">Edit</button>
        <button class="btn-modal-reresearch" id="reresearchBtn">Re-research</button>
        <button class="btn-delete-beer" id="deleteBeerBtn" data-id="${beer.id}">Delete</button>
      </div>`;
  }

  return html;
}

function esc(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function fetchBeer(id) {
  if (window.READ_ONLY) {
    return fetch(window.CELLAR_DATA_URL)
      .then(r => r.json())
      .then(data => (data.beers || data).find(b => b.id == id));
  }
  return fetch(`/api/beers/${id}`).then(r => r.json());
}

function fetchWine(id) {
  if (window.READ_ONLY) {
    return fetch(window.CELLAR_WINES_URL)
      .then(r => r.json())
      .then(data => (data.wines || data).find(w => w.id == id));
  }
  return fetch(`/api/wines/${id}`).then(r => r.json());
}

function openModal(beerId) {
  fetchBeer(beerId).then(beer => {
    document.getElementById('modalContent').innerHTML = renderModal(beer);
    document.getElementById('modal').removeAttribute('hidden');
    setupImbibeButton(beer.id);
    setupDeleteButton(beer.id);
    setupEditButton(beer);
    setupReresearchButton(beer);
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
      .then(data => {
        const beer = data.beer;
        const imbibedRecord = data.imbibed_record;

        if (imbibedRecord) {
          // Split: original qty decremented, new imbibed record spun off
          const row = document.querySelector(`tr.beer-row[data-id="${beerId}"]`);
          if (row) {
            const nameCell = row.querySelector('.beer-name');
            if (nameCell) {
              const badge = nameCell.querySelector('.qty-badge');
              if (beer.quantity > 1) {
                if (badge) badge.textContent = `×${beer.quantity}`;
              } else if (badge) {
                badge.remove();
              }
            }
          }
          injectNewBeerRow(imbibedRecord);
          // Refresh modal to show updated active beer (with tasting history)
          document.getElementById('modalContent').innerHTML = renderModal(beer);
          setupImbibeButton(beer.id);
          setupDeleteButton(beer.id);
          setupEditButton(beer);
          setupReresearchButton(beer);
        } else {
          // Full imbibe (qty was 1)
          const row = document.querySelector(`tr.beer-row[data-id="${beerId}"]`);
          if (row) {
            row.dataset.imbibed = '1';
            row.querySelectorAll('td.col-days-left, .badge').forEach(el => {
              el.dataset.imbibed = '1';
            });
            applyBadges();
            sortTable();
          }
          const card = document.querySelector(`.beer-card[data-id="${beerId}"]`);
          if (card) card.dataset.imbibed = '1';
          syncCards();
          document.getElementById('modalContent').innerHTML = renderModal(beer);
        }
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

function setupEditButton(beer) {
  const btn = document.getElementById('editBeerBtn');
  if (!btn) return;
  btn.addEventListener('click', () => renderEditForm(beer));
}

function renderEditForm(beer) {
  const brewerList = (window.CELLAR_BREWERS || []).map(b => `<option value="${esc(b)}">`).join('');
  // Parse date_bottled into parts
  const dp = (beer.date_bottled || '').split('-');
  const by = dp[0] || '', bm = dp[1] || '', bd = dp[2] || '';

  document.getElementById('modalContent').innerHTML = `
    <datalist id="editBrewerList">${brewerList}</datalist>
    <div class="edit-beer-form">
      <label>Beer name</label>
      <input class="add-field" id="ef-name" value="${esc(beer.name || '')}">
      <label>Brewery</label>
      <input class="add-field" id="ef-brewer" value="${esc(beer.brewer || '')}" list="editBrewerList">
      <label>Year</label>
      <input class="add-field" id="ef-year" type="number" min="1900" max="2100" value="${beer.year || ''}">
      <label>ABV</label>
      <input class="add-field" id="ef-abv" type="number" step="0.1" min="0" max="100" value="${beer.abv != null ? beer.abv : ''}">
      <label>Bottled</label>
      <div class="date-row">
        <input class="add-field" id="ef-bottled-y" type="number" placeholder="YYYY" style="width:70px" value="${by}">
        <select class="add-field" id="ef-bottled-m">
          <option value="">—</option>
          ${MONTHS.map((m, i) => `<option value="${String(i+1).padStart(2,'0')}" ${bm === String(i+1).padStart(2,'0') ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
        <input class="add-field" id="ef-bottled-d" type="number" placeholder="DD" style="width:55px" value="${bd}">
      </div>
      <label>Quantity</label>
      <input class="add-field" id="ef-qty" type="number" min="1" value="${beer.quantity || 1}">
      <label>Drink after</label>
      <input class="add-field" id="ef-drink-after" placeholder="YYYY-MM" value="${beer.drink_after || ''}">
      <label>Drink by</label>
      <input class="add-field" id="ef-drink-by" placeholder="YYYY-MM" value="${beer.drink_by || ''}">
      <label>Research notes</label>
      <textarea class="add-field" id="ef-research" rows="4">${esc(beer.research || '')}</textarea>
      <label>Food pairings</label>
      <textarea class="add-field" id="ef-food" rows="2">${esc(beer.food_pairings || '')}</textarea>
      <label>Considerations</label>
      <textarea class="add-field" id="ef-considerations" rows="2">${esc(beer.considerations || '')}</textarea>
      <label>Label / status</label>
      <input class="add-field" id="ef-label" placeholder="e.g. Test" value="${esc(beer.label || '')}">
    </div>
    <div id="editError" class="add-beer-error" hidden></div>
    <div class="modal-delete-row" style="margin-top:1rem">
      <button class="btn-secondary" id="editCancelBtn">Cancel</button>
      <button class="btn-primary" id="editSaveBtn">Save</button>
    </div>`;

  document.getElementById('editCancelBtn').addEventListener('click', () => openModal(beer.id));
  document.getElementById('editSaveBtn').addEventListener('click', () => {
    const eby = document.getElementById('ef-bottled-y').value.trim();
    const ebm = document.getElementById('ef-bottled-m').value;
    const ebd = document.getElementById('ef-bottled-d').value.trim();
    let date_bottled = null;
    if (eby) {
      date_bottled = eby;
      if (ebm) { date_bottled += `-${ebm}`; if (ebd) date_bottled += `-${String(ebd).padStart(2,'0')}`; }
    }
    const payload = {
      name:            document.getElementById('ef-name').value.trim(),
      brewer:          document.getElementById('ef-brewer').value.trim(),
      year:            parseInt(document.getElementById('ef-year').value) || null,
      abv:             parseFloat(document.getElementById('ef-abv').value) || null,
      quantity:        parseInt(document.getElementById('ef-qty').value) || 1,
      date_bottled,
      drink_after:     document.getElementById('ef-drink-after').value.trim() || null,
      drink_by:        document.getElementById('ef-drink-by').value.trim() || null,
      research:        document.getElementById('ef-research').value.trim() || null,
      food_pairings:   document.getElementById('ef-food').value.trim() || null,
      considerations:  document.getElementById('ef-considerations').value.trim() || null,
      label:           document.getElementById('ef-label').value.trim() || null,
    };
    if (!payload.name || !payload.brewer) {
      const err = document.getElementById('editError');
      err.textContent = 'Name and brewery are required.';
      err.removeAttribute('hidden');
      return;
    }
    fetch(`/api/beers/${beer.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(r => r.json())
      .then(updated => {
        updateRowFromResearch(updated);
        openModal(updated.id);
      });
  });
}

function setupReresearchButton(beer) {
  const btn = document.getElementById('reresearchBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    btn.disabled = true;
    btn.textContent = 'Researching…';
    btn.classList.add('loading');
    fetch(`/api/beers/${beer.id}/research`, { method: 'POST' })
      .then(r => r.json())
      .then(() => {
        // Poll for results, same pattern as Step 4
        let attempts = 0;
        const poll = setInterval(() => {
          if (++attempts > 30) {
            clearInterval(poll);
            btn.disabled = false;
            btn.textContent = 'Re-research';
            btn.classList.remove('loading');
            return;
          }
          fetch(`/api/beers/${beer.id}`)
            .then(r => r.json())
            .then(updated => {
              // Consider it done if research text changed or dates appeared
              if (updated.drink_after || updated.drink_by || updated.research !== beer.research) {
                clearInterval(poll);
                btn.classList.remove('loading');
                updateRowFromResearch(updated);
                openModal(updated.id);
              }
            });
        }, 3000);
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
  document.querySelectorAll('tr.wine-row').forEach(row => {
    row.addEventListener('click', () => openWineModal(row.dataset.id));
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
        <img class="card-thumb" src="${img ? img.getAttribute('src') : '/static/images/default.svg'}" alt=""
             loading="lazy" onerror="this.src='/static/images/default.svg'">
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

// ── Inject new row into the live table ────────────────────────────────────────

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
  tr.dataset.qty = beer.quantity || 1;
  if (beer.date_imbibed) tr.dataset.imbibed = '1';
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

  if (window.CELLAR_BREWERS && !window.CELLAR_BREWERS.includes(beer.brewer)) {
    window.CELLAR_BREWERS.push(beer.brewer);
    window.CELLAR_BREWERS.sort();
  }
}

// ── Add Beer modal ────────────────────────────────────────────────────────────

(function () {
  if (!document.getElementById('addBeerBtn')) return; // read-only / static site


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
        <div class="add-beer-success-name">${esc(beer.name)}</div>
        <div class="add-beer-success-brewer">${esc(beer.brewer)}</div>
        <div id="researchAnim" class="beer-mug-loader" aria-hidden="true">
          <div class="mug-body">
            <div class="mug-liquid" id="mugLiquid">
              <div class="mug-foam"></div>
              <span class="mug-bubble" style="left:28%;animation-delay:0s"></span>
              <span class="mug-bubble" style="left:55%;animation-delay:0.6s"></span>
              <span class="mug-bubble" style="left:42%;animation-delay:1.2s"></span>
            </div>
          </div>
          <div class="mug-handle"></div>
        </div>
        <div class="research-status" id="researchStatus">Researching drink window…</div>
        <button class="btn-primary" id="addBeerDoneBtn" style="margin-top:1rem">Done</button>
      </div>`;
    document.getElementById('addBeerDoneBtn').addEventListener('click', closeAddBeer);

    // Poll for drink window research results (written by background agent)
    let attempts = 0;
    const poll = setInterval(() => {
      if (++attempts > 30) {  // give up after 90 seconds
        clearInterval(poll);
        const anim = document.getElementById('researchAnim');
        if (anim) anim.hidden = true;
        const el = document.getElementById('researchStatus');
        if (el) el.textContent = 'No drink window found — you can add it manually later.';
        return;
      }
      fetch(`/api/beers/${beer.id}`)
        .then(r => r.json())
        .then(updated => {
          if (updated.drink_after || updated.drink_by) {
            clearInterval(poll);
            const anim = document.getElementById('researchAnim');
            if (anim) anim.hidden = true;
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

  // ── Event wiring ─────────────────────────────────────────────────────────

  document.getElementById('addBeerBtn').addEventListener('click', openAddBeer);
  document.getElementById('addBeerClose').addEventListener('click', closeAddBeer);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeAddBeer(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !overlay.hasAttribute('hidden')) closeAddBeer();
  });
})();

// ════════════════════════════════════════════════════════════════════════════
// WINE SECTION
// ════════════════════════════════════════════════════════════════════════════

// ── Wine status logic ─────────────────────────────────────────────────────────

const WINE_STATUS_CLASS = {
  'Drink Now':        'badge-drink-now',
  'Peak Approaching': 'badge-approaching',
  'Aging':            'badge-aging',
  'Past Peak':        'badge-past-peak',
  'Not Set':          'badge-not-set',
  'Happily Imbibed':  'badge-imbibed',
  'Test':             'badge-test',
};

function getWineStatus(drinkAfter, drinkBy, imbibed, label) {
  if (label) return label;
  if (imbibed) return 'Happily Imbibed';
  const today = new Date().toISOString().slice(0, 10);
  if (!drinkAfter && !drinkBy) return 'Not Set';
  if (drinkBy && today > drinkBy) return 'Past Peak';
  if (drinkAfter && today >= drinkAfter) return 'Drink Now';
  if (drinkAfter) {
    return daysLeft(drinkAfter) <= 60 ? 'Peak Approaching' : 'Aging';
  }
  return 'Not Set';
}

function applyWineBadges() {
  document.querySelectorAll('.wine-badge[data-after]').forEach(el => {
    const status = getWineStatus(el.dataset.after, el.dataset.by, el.dataset.imbibed, el.dataset.label);
    el.textContent = status;
    el.className = 'badge wine-badge ' + (WINE_STATUS_CLASS[status] || 'badge-not-set');
  });
  document.querySelectorAll('td.wine-days').forEach(td => {
    const DAY_CLASSES = ['days-drink-now', 'days-approaching', 'days-aging', 'days-soon', 'days-urgent'];
    DAY_CLASSES.forEach(c => td.classList.remove(c));
    const status = getWineStatus(td.dataset.after, td.dataset.by, td.dataset.imbibed, td.dataset.label);
    if (status === 'Drink Now') {
      const d = daysLeft(td.dataset.by);
      if (d !== null) {
        td.textContent = d;
        td.dataset.sortVal = d;
        td.classList.add('days-drink-now');
        if (d <= 30) td.classList.add('days-urgent');
        else if (d <= 90) td.classList.add('days-soon');
      }
    } else if (status === 'Peak Approaching') {
      const d = daysLeft(td.dataset.by);
      if (d !== null) { td.textContent = d; td.dataset.sortVal = d; td.classList.add('days-approaching'); }
    } else if (status === 'Aging') {
      const d = daysLeft(td.dataset.by);
      if (d !== null) { td.textContent = d; td.dataset.sortVal = d; td.classList.add('days-aging'); }
    } else if (status === 'Past Peak') {
      const d = daysLeft(td.dataset.by);
      if (d !== null) { td.textContent = d; td.dataset.sortVal = d; td.classList.add('days-urgent'); }
    } else {
      td.textContent = '—';
      td.dataset.sortVal = '';
    }
  });
}

// ── Wine sorting ──────────────────────────────────────────────────────────────

let wineSortCol = 'days_left';
let wineSortDir = 1;
const WINE_NUMERIC_COLS = new Set(['year', 'days_left']);

function wineCellValue(row, col) {
  if (col === 'days_left') {
    const td = row.querySelector('td.wine-days');
    return td ? td.dataset.sortVal || '' : '';
  }
  const cells = row.querySelectorAll('td');
  const colIndex = { name: 1, year: 2, producer: 3, region: 4, varietal: 5, drink_after: 6, drink_by: 7 };
  const idx = colIndex[col];
  if (idx === undefined) return '';
  const text = cells[idx].textContent.trim();
  return text === '—' ? '' : text;
}

function sortWineTable() {
  const tbody = document.getElementById('wineTableBody');
  if (!tbody) return;
  const rows = Array.from(tbody.querySelectorAll('tr.wine-row'));
  rows.sort((a, b) => {
    const ai = a.dataset.imbibed ? 1 : 0;
    const bi = b.dataset.imbibed ? 1 : 0;
    if (ai !== bi) return ai - bi;
    if (wineSortCol === 'days_left') {
      const ra = STATUS_SORT_RANK[a.querySelector('.wine-badge')?.textContent] ?? 3;
      const rb = STATUS_SORT_RANK[b.querySelector('.wine-badge')?.textContent] ?? 3;
      if (ra !== rb) return ra - rb;
    }
    const av = wineCellValue(a, wineSortCol);
    const bv = wineCellValue(b, wineSortCol);
    if (av === '' && bv === '') return 0;
    if (av === '') return 1;
    if (bv === '') return -1;
    if (WINE_NUMERIC_COLS.has(wineSortCol)) {
      return (parseFloat(av) - parseFloat(bv)) * wineSortDir;
    }
    return av.localeCompare(bv) * wineSortDir;
  });
  rows.forEach(r => tbody.appendChild(r));
  if (document.getElementById('wineCardGrid')) syncWineCards();
}

function setupWineSort() {
  document.querySelectorAll('th.wine-sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (wineSortCol === col) { wineSortDir *= -1; } else { wineSortCol = col; wineSortDir = 1; }
      updateWineSortIndicators();
      sortWineTable();
    });
  });
}

function updateWineSortIndicators() {
  document.querySelectorAll('th.wine-sortable').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.col === wineSortCol) {
      th.classList.add(wineSortDir === 1 ? 'sort-asc' : 'sort-desc');
    }
  });
}

// ── Wine filtering ────────────────────────────────────────────────────────────

function setupWineFilter() {
  document.getElementById('wineFilterText')?.addEventListener('input', applyWineFilters);
  document.getElementById('wineFilterStatus')?.addEventListener('change', applyWineFilters);
}

function applyWineFilters() {
  const textEl = document.getElementById('wineFilterText');
  const statusEl = document.getElementById('wineFilterStatus');
  const text = textEl ? textEl.value.toLowerCase() : '';
  const status = statusEl ? statusEl.value : '';
  let visible = 0, bottles = 0;
  document.querySelectorAll('tr.wine-row').forEach(row => {
    const name = row.querySelector('td.beer-name')?.textContent.toLowerCase() || '';
    const producer = row.querySelector('td.col-brewer')?.textContent.toLowerCase() || '';
    const rowStatus = row.querySelector('.wine-badge')?.textContent || '';
    const matchText = !text || name.includes(text) || producer.includes(text);
    const matchStatus = !status || rowStatus === status;
    row.style.display = matchText && matchStatus ? '' : 'none';
    if (matchText && matchStatus && !row.dataset.imbibed) {
      visible++;
      bottles += parseInt(row.dataset.qty || 1);
    }
  });
  document.querySelectorAll('.wine-card').forEach(card => {
    const row = document.querySelector(`tr.wine-row[data-id="${card.dataset.id}"]`);
    if (row) card.style.display = row.style.display;
  });
  updateWineCount(visible, bottles);
}

// ── Wine card view ────────────────────────────────────────────────────────────

function syncWineCards() {
  const grid = document.getElementById('wineCardGrid');
  if (!grid) return;
  grid.innerHTML = '';
  document.querySelectorAll('tr.wine-row').forEach(row => {
    const id = row.dataset.id;
    const img = row.querySelector('td.col-img img');
    const nameTd = row.querySelector('td.beer-name');
    const producer = row.querySelector('td.col-brewer')?.textContent.trim() || '';
    const year = row.querySelector('td.col-year')?.textContent.trim() || '';
    const rating = row.querySelector('td.col-rating')?.textContent.trim() || '';
    const daysTd = row.querySelector('td.wine-days');
    const badgeEl = row.querySelector('.wine-badge');

    const card = document.createElement('div');
    card.className = 'beer-card wine-card';
    card.dataset.id = id;
    if (row.dataset.imbibed) card.dataset.imbibed = row.dataset.imbibed;
    card.style.display = row.style.display;

    const metaParts = [];
    if (year && year !== '—') metaParts.push(`<span>${year}</span>`);
    if (rating && rating !== '—') metaParts.push(`<span class="card-rating">${rating}</span>`);

    card.innerHTML = `
      <div class="card-img-wrap">
        <img class="card-thumb" src="${img ? img.getAttribute('src') : '/static/images/default.svg'}" alt=""
             loading="lazy" onerror="this.src='/static/images/default.svg'">
      </div>
      <div class="card-body">
        <div class="card-header">
          <div class="card-name">${nameTd ? nameTd.innerHTML : ''}</div>
          <div class="card-brewer">${esc(producer)}</div>
        </div>
        ${metaParts.length ? `<div class="card-meta">${metaParts.join('<span class="card-sep">·</span>')}</div>` : ''}
        <div class="card-window">
          <span class="card-days"
                data-by="${daysTd ? daysTd.dataset.by : ''}"
                data-after="${daysTd ? daysTd.dataset.after : ''}"
                data-imbibed="${daysTd ? daysTd.dataset.imbibed : ''}"></span>
          <span class="badge wine-badge ${badgeEl ? badgeEl.className.replace('badge wine-badge ', '') : ''}"
                data-after="${badgeEl ? badgeEl.dataset.after : ''}"
                data-by="${badgeEl ? badgeEl.dataset.by : ''}"
                data-imbibed="${badgeEl ? badgeEl.dataset.imbibed : ''}">${badgeEl ? badgeEl.textContent : ''}</span>
        </div>
      </div>`;

    const cardDays = card.querySelector('span.card-days');
    if (daysTd) {
      cardDays.textContent = daysTd.textContent;
      daysTd.classList.forEach(c => { if (c.startsWith('days-')) cardDays.classList.add(c); });
    }
    const d = parseInt(daysTd?.textContent, 10);
    if (!isNaN(d) && badgeEl) {
      const cardBadge = card.querySelector('.wine-badge');
      const dw = d === 1 ? 'day' : 'days';
      const status = badgeEl.textContent;
      if (status === 'Drink Now')        cardBadge.textContent = `Drink within ${d} ${dw}`;
      else if (status === 'Peak Approaching') cardBadge.textContent = `Peak in ${d} ${dw}`;
      else if (status === 'Aging')       cardBadge.textContent = `Ready in ${d} ${dw}`;
    }
    cardDays.hidden = true;

    card.addEventListener('click', () => openWineModal(id));
    grid.appendChild(card);
  });
}

// ── Wine view toggle ──────────────────────────────────────────────────────────

const WINE_CARD_VIEW_KEY = 'cellar-wine-view';

function getWinePreferredView() {
  return localStorage.getItem(WINE_CARD_VIEW_KEY)
    || (window.matchMedia('(max-width: 640px)').matches ? 'card' : 'table');
}

function setWineView(view) {
  const tableWrap = document.querySelector('#wineSection .table-wrap');
  const cardGrid = document.getElementById('wineCardGrid');
  const sortControls = document.getElementById('wineSortControls');
  if (tableWrap) tableWrap.hidden = (view === 'card');
  if (cardGrid) cardGrid.hidden = (view === 'table');
  if (sortControls) sortControls.hidden = (view === 'table');
  const lbl = document.querySelector('#wineViewToggle .view-toggle-label');
  const icon = document.querySelector('#wineViewToggle .view-toggle-icon');
  if (lbl) lbl.textContent = view === 'card' ? 'Table' : 'Cards';
  if (icon) icon.textContent = view === 'card' ? '☰' : '⊞';
  localStorage.setItem(WINE_CARD_VIEW_KEY, view);
}

function setupWineViewToggle() {
  const btn = document.getElementById('wineViewToggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const current = localStorage.getItem(WINE_CARD_VIEW_KEY) || getWinePreferredView();
    const next = current === 'card' ? 'table' : 'card';
    if (next === 'card') syncWineCards();
    setWineView(next);
  });
}

function setupWineCardSort() {
  const sel = document.getElementById('wineCardSort');
  const dirBtn = document.getElementById('wineCardSortDir');
  if (!sel || !dirBtn) return;
  sel.value = wineSortCol;
  sel.addEventListener('change', () => {
    wineSortCol = sel.value;
    wineSortDir = 1;
    dirBtn.textContent = '▲';
    updateWineSortIndicators();
    sortWineTable();
  });
  dirBtn.addEventListener('click', () => {
    wineSortDir *= -1;
    dirBtn.textContent = wineSortDir === 1 ? '▲' : '▼';
    updateWineSortIndicators();
    sortWineTable();
  });
}

// ── Wine modal ────────────────────────────────────────────────────────────────

function renderWineModal(wine) {
  const status = getWineStatus(wine.drink_after, wine.drink_by, wine.date_imbibed, wine.label);
  const badgeClass = WINE_STATUS_CLASS[status] || 'badge-not-set';
  const imgSrc = wine.image_path || '/static/images/default.svg';

  let fp = null;
  try { fp = wine.flavor_profile ? JSON.parse(wine.flavor_profile) : null; } catch (e) {}

  let html = `
    <div class="modal-header">
      <img class="modal-label-img"
           src="${imgSrc}"
           alt="${esc(wine.name)}"
           onerror="this.src='/static/images/default.svg'">
      <div class="modal-header-text">
        <div class="modal-beer-name">${esc(wine.name)}</div>
        <div class="modal-brewer">${esc(wine.producer)}</div>
      </div>
    </div>

    <div class="modal-window">
      <div>
        <div class="modal-window-label">Drinking window</div>
        <div class="modal-window-value">${drinkWindowText(wine)}</div>
      </div>
      <span class="badge wine-badge ${badgeClass}" style="margin-left:auto">${status}</span>
    </div>

    <div class="modal-dates">
      ${wine.year ? `<div class="modal-date-item"><div class="modal-date-label">Vintage</div><div class="modal-date-value">${wine.year}</div></div>` : ''}
      ${wine.producer ? `<div class="modal-date-item"><div class="modal-date-label">Producer</div><div class="modal-date-value">${esc(wine.producer)}</div></div>` : ''}
      ${wine.region ? `<div class="modal-date-item"><div class="modal-date-label">Region</div><div class="modal-date-value">${esc(wine.region)}</div></div>` : ''}
      ${wine.varietal ? `<div class="modal-date-item"><div class="modal-date-label">Varietal</div><div class="modal-date-value">${esc(wine.varietal)}</div></div>` : ''}
      ${wine.rating != null ? `<div class="modal-date-item"><div class="modal-date-label">Rating</div><div class="modal-date-value">${Math.round(wine.rating)}${wine.rating_source ? ` <span style="font-size:0.8em;color:var(--text-muted)">(${esc(wine.rating_source)})</span>` : ''}</div></div>` : ''}
      <div class="modal-date-item"><div class="modal-date-label">Drink After</div><div class="modal-date-value">${formatDate(wine.drink_after)}</div></div>
      <div class="modal-date-item"><div class="modal-date-label">Drink By</div><div class="modal-date-value">${formatDate(wine.drink_by)}</div></div>
      <div class="modal-date-item"><div class="modal-date-label">Added</div><div class="modal-date-value">${formatDate(wine.date_added)}</div></div>
      ${wine.quantity > 1 ? `<div class="modal-date-item"><div class="modal-date-label">Bottles</div><div class="modal-date-value">${wine.quantity}</div></div>` : ''}
      ${wine.date_imbibed ? `<div class="modal-date-item"><div class="modal-date-label">Imbibed</div><div class="modal-date-value">${formatDate(wine.date_imbibed)}</div></div>` : ''}
    </div>`;

  if (fp && Object.keys(fp).length) {
    const labels = { sweetness: 'Sweetness', acidity: 'Acidity', tannins: 'Tannins', alcohol: 'Alcohol', body: 'Body', finish: 'Finish' };
    const scores = Object.entries(fp).filter(([k, v]) => labels[k] && v != null)
      .map(([k, v]) => `<span>${labels[k]} ${v}</span>`).join('');
    if (scores) {
      html += `<div class="modal-section"><div class="modal-section-title">Flavor Profile</div><div class="flavor-profile">${scores}</div></div>`;
    }
  }

  if (wine.date_imbibed && wine.imbibe_notes) {
    html += `<div class="modal-section"><div class="modal-section-title">Tasting Notes</div><div class="modal-section-body">${esc(wine.imbibe_notes)}</div></div>`;
  }

  if (!wine.date_imbibed && !window.READ_ONLY) {
    html += `
      <div class="modal-imbibe" id="wineImbibeSection">
        <button class="btn-imbibe" id="wineImbibeBtn">IMBIBE!</button>
        <div class="imbibe-confirm" id="wineImbibeConfirm" hidden>
          <textarea id="wineImbibeNotes" class="imbibe-notes" placeholder="Tasting notes (optional)…" rows="3"></textarea>
          <div class="imbibe-actions">
            <button class="btn-imbibe-confirm" id="wineImbibeConfirmBtn">Confirm</button>
            <button class="btn-imbibe-cancel" id="wineImbibeCancelBtn">Cancel</button>
          </div>
        </div>
      </div>`;
  }

  if (wine.tasting_history && wine.tasting_history.length > 0) {
    html += `<div class="modal-section"><div class="modal-section-title">Previous Tastings</div>`;
    for (const t of wine.tasting_history) {
      html += `<div class="tasting-entry"><div class="tasting-date">${formatDate(t.date_imbibed)}</div>${t.imbibe_notes ? `<div class="tasting-entry-notes">${esc(t.imbibe_notes)}</div>` : ''}</div>`;
    }
    html += `</div>`;
  }

  if (wine.research) {
    html += `<div class="modal-section"><div class="modal-section-title">Drinking Window Notes</div><div class="modal-section-body">${autoLink(esc(wine.research))}</div></div>`;
  }
  if (wine.considerations) {
    html += `<div class="modal-section"><div class="modal-section-title">Cellaring Notes</div><div class="modal-section-body">${esc(wine.considerations)}</div></div>`;
  }

  if (!window.READ_ONLY) {
    html += `
      <div class="modal-delete-row">
        <button class="btn-modal-edit" id="editWineBtn">Edit</button>
        <button class="btn-modal-reresearch" id="wineReresearchBtn">Re-research</button>
        <button class="btn-delete-beer" id="deleteWineBtn" data-id="${wine.id}">Delete</button>
      </div>`;
  }

  return html;
}

function openWineModal(wineId) {
  fetchWine(wineId).then(wine => {
    document.getElementById('modalContent').innerHTML = renderWineModal(wine);
    document.getElementById('modal').removeAttribute('hidden');
    setupWineImbibeButton(wine.id);
    setupWineDeleteButton(wine.id);
    setupWineEditButton(wine);
    setupWineReresearchButton(wine);
  });
}

function setupWineImbibeButton(wineId) {
  const btn = document.getElementById('wineImbibeBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    document.getElementById('wineImbibeConfirm').removeAttribute('hidden');
    btn.setAttribute('hidden', '');
    document.getElementById('wineImbibeNotes').focus();
  });
  document.getElementById('wineImbibeCancelBtn').addEventListener('click', () => {
    document.getElementById('wineImbibeConfirm').setAttribute('hidden', '');
    btn.removeAttribute('hidden');
  });
  document.getElementById('wineImbibeConfirmBtn').addEventListener('click', () => {
    const notes = document.getElementById('wineImbibeNotes').value.trim();
    fetch(`/api/wines/${wineId}/imbibe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: notes || null }),
    }).then(r => r.json()).then(data => {
      const wine = data.wine;
      const imbibedRecord = data.imbibed_record;
      if (imbibedRecord) {
        const row = document.querySelector(`tr.wine-row[data-id="${wineId}"]`);
        if (row) {
          const nameCell = row.querySelector('.beer-name');
          const badge = nameCell?.querySelector('.qty-badge');
          if (wine.quantity > 1) { if (badge) badge.textContent = `×${wine.quantity}`; }
          else if (badge) badge.remove();
          row.dataset.qty = wine.quantity;
        }
        injectNewWineRow(imbibedRecord);
        document.getElementById('modalContent').innerHTML = renderWineModal(wine);
        setupWineImbibeButton(wine.id);
        setupWineDeleteButton(wine.id);
        setupWineEditButton(wine);
        setupWineReresearchButton(wine);
      } else {
        const row = document.querySelector(`tr.wine-row[data-id="${wineId}"]`);
        if (row) {
          row.dataset.imbibed = '1';
          row.querySelectorAll('td.wine-days, .wine-badge').forEach(el => { el.dataset.imbibed = '1'; });
          applyWineBadges();
          sortWineTable();
        }
        const card = document.querySelector(`.wine-card[data-id="${wineId}"]`);
        if (card) card.dataset.imbibed = '1';
        syncWineCards();
        document.getElementById('modalContent').innerHTML = renderWineModal(wine);
      }
      initCount();
    });
  });
}

function setupWineDeleteButton(wineId) {
  const btn = document.getElementById('deleteWineBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (!confirm('Delete this wine from the cellar?')) return;
    fetch(`/api/wines/${wineId}`, { method: 'DELETE' }).then(r => {
      if (!r.ok) return;
      closeModal();
      document.querySelector(`tr.wine-row[data-id="${wineId}"]`)?.remove();
      document.querySelector(`.wine-card[data-id="${wineId}"]`)?.remove();
      initCount();
    });
  });
}

function setupWineEditButton(wine) {
  const btn = document.getElementById('editWineBtn');
  if (!btn) return;
  btn.addEventListener('click', () => renderWineEditForm(wine));
}

function renderWineEditForm(wine) {
  const producerList = (window.CELLAR_PRODUCERS || []).map(p => `<option value="${esc(p)}">`).join('');
  document.getElementById('modalContent').innerHTML = `
    <datalist id="editProducerList">${producerList}</datalist>
    <div class="edit-beer-form">
      <label>Wine name</label>
      <input class="add-field" id="wef-name" value="${esc(wine.name || '')}">
      <label>Producer</label>
      <input class="add-field" id="wef-producer" value="${esc(wine.producer || '')}" list="editProducerList">
      <label>Vintage</label>
      <input class="add-field" id="wef-year" type="number" min="1900" max="2100" value="${wine.year || ''}">
      <label>Region</label>
      <input class="add-field" id="wef-region" value="${esc(wine.region || '')}">
      <label>Varietal</label>
      <input class="add-field" id="wef-varietal" value="${esc(wine.varietal || '')}">
      <label>Rating</label>
      <input class="add-field" id="wef-rating" type="number" min="0" max="100" value="${wine.rating != null ? wine.rating : ''}">
      <label>Rating source</label>
      <input class="add-field" id="wef-rating-source" placeholder="e.g. Wine Spectator" value="${esc(wine.rating_source || '')}">
      <label>Quantity</label>
      <input class="add-field" id="wef-qty" type="number" min="1" value="${wine.quantity || 1}">
      <label>Drink after</label>
      <input class="add-field" id="wef-drink-after" placeholder="YYYY-MM-DD" value="${wine.drink_after || ''}">
      <label>Drink by</label>
      <input class="add-field" id="wef-drink-by" placeholder="YYYY-MM-DD" value="${wine.drink_by || ''}">
      <label>Window notes</label>
      <textarea class="add-field" id="wef-research" rows="4">${esc(wine.research || '')}</textarea>
      <label>Cellaring notes</label>
      <textarea class="add-field" id="wef-considerations" rows="3">${esc(wine.considerations || '')}</textarea>
      <label>Label</label>
      <input class="add-field" id="wef-label" placeholder="e.g. Test" value="${esc(wine.label || '')}">
    </div>
    <div id="wineEditError" class="add-beer-error" hidden></div>
    <div class="modal-delete-row" style="margin-top:1rem">
      <button class="btn-secondary" id="wineEditCancelBtn">Cancel</button>
      <button class="btn-primary" id="wineEditSaveBtn">Save</button>
    </div>`;

  document.getElementById('wineEditCancelBtn').addEventListener('click', () => openWineModal(wine.id));
  document.getElementById('wineEditSaveBtn').addEventListener('click', () => {
    const payload = {
      name:          document.getElementById('wef-name').value.trim(),
      producer:      document.getElementById('wef-producer').value.trim(),
      year:          parseInt(document.getElementById('wef-year').value) || null,
      region:        document.getElementById('wef-region').value.trim() || null,
      varietal:      document.getElementById('wef-varietal').value.trim() || null,
      rating:        parseFloat(document.getElementById('wef-rating').value) || null,
      rating_source: document.getElementById('wef-rating-source').value.trim() || null,
      quantity:      parseInt(document.getElementById('wef-qty').value) || 1,
      drink_after:   document.getElementById('wef-drink-after').value.trim() || null,
      drink_by:      document.getElementById('wef-drink-by').value.trim() || null,
      research:      document.getElementById('wef-research').value.trim() || null,
      considerations:document.getElementById('wef-considerations').value.trim() || null,
      label:         document.getElementById('wef-label').value.trim() || null,
    };
    if (!payload.name || !payload.producer) {
      const err = document.getElementById('wineEditError');
      err.textContent = 'Name and producer are required.';
      err.removeAttribute('hidden');
      return;
    }
    fetch(`/api/wines/${wine.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(r => r.json()).then(updated => {
      updateWineRowFromResearch(updated);
      openWineModal(updated.id);
    });
  });
}

function setupWineReresearchButton(wine) {
  const btn = document.getElementById('wineReresearchBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    btn.disabled = true;
    btn.textContent = 'Researching…';
    btn.classList.add('loading');
    fetch(`/api/wines/${wine.id}/research`, { method: 'POST' }).then(() => {
      let attempts = 0;
      const poll = setInterval(() => {
        if (++attempts > 30) {
          clearInterval(poll);
          btn.disabled = false;
          btn.textContent = 'Re-research';
          btn.classList.remove('loading');
          return;
        }
        fetch(`/api/wines/${wine.id}`).then(r => r.json()).then(updated => {
          if (updated.drink_after || updated.drink_by || updated.research !== wine.research) {
            clearInterval(poll);
            btn.classList.remove('loading');
            updateWineRowFromResearch(updated);
            openWineModal(updated.id);
          }
        });
      }, 3000);
    });
  });
}

// ── Inject new wine row ───────────────────────────────────────────────────────

function injectNewWineRow(wine) {
  const emptyRow = document.getElementById('wineEmptyRow');
  if (emptyRow) emptyRow.remove();

  const imgSrc = wine.image_path || '/static/images/default.svg';
  const yearText = wine.year || '—';
  const qtyHtml = wine.quantity > 1 ? ` <span class="qty-badge">×${wine.quantity}</span>` : '';
  const ratingText = wine.rating != null ? Math.round(wine.rating) : '—';

  const tr = document.createElement('tr');
  tr.className = 'wine-row';
  tr.dataset.id = wine.id;
  tr.dataset.qty = wine.quantity || 1;
  if (wine.date_imbibed) tr.dataset.imbibed = '1';
  tr.innerHTML = `
    <td class="col-img"><img class="beer-thumb" src="${imgSrc}" alt="${esc(wine.name)}" onerror="this.src='/static/images/default.svg'"></td>
    <td class="beer-name">${esc(wine.name)}${qtyHtml}</td>
    <td class="col-year">${yearText}</td>
    <td class="col-brewer">${esc(wine.producer)}</td>
    <td class="col-region">${esc(wine.region || '—')}</td>
    <td class="col-varietal">${esc(wine.varietal || '—')}</td>
    <td class="col-drink-after">${wine.drink_after || '—'}</td>
    <td class="col-drink-by">${wine.drink_by || '—'}</td>
    <td class="col-days-left wine-days"
        data-by="${wine.drink_by || ''}"
        data-after="${wine.drink_after || ''}"
        data-imbibed="${wine.date_imbibed || ''}"
        data-label="${wine.label || ''}">—</td>
    <td><span class="badge wine-badge"
              data-after="${wine.drink_after || ''}"
              data-by="${wine.drink_by || ''}"
              data-imbibed="${wine.date_imbibed || ''}"
              data-label="${wine.label || ''}"></span></td>`;

  document.getElementById('wineTableBody').appendChild(tr);
  tr.addEventListener('click', () => openWineModal(wine.id));

  applyWineBadges();
  sortWineTable();
  syncWineCards();
  applyWineFilters();

  if (window.CELLAR_PRODUCERS && !window.CELLAR_PRODUCERS.includes(wine.producer)) {
    window.CELLAR_PRODUCERS.push(wine.producer);
    window.CELLAR_PRODUCERS.sort();
  }
}

function updateWineRowFromResearch(wine) {
  const row = document.querySelector(`tr.wine-row[data-id="${wine.id}"]`);
  if (!row) return;
  const afterTd = row.querySelector('td.col-drink-after');
  const byTd = row.querySelector('td.col-drink-by');
  const daysTd = row.querySelector('td.wine-days');
  const badgeEl = row.querySelector('.wine-badge');
  if (afterTd) afterTd.textContent = wine.drink_after || '—';
  if (byTd) byTd.textContent = wine.drink_by || '—';
  if (daysTd) { daysTd.dataset.after = wine.drink_after || ''; daysTd.dataset.by = wine.drink_by || ''; }
  if (badgeEl) { badgeEl.dataset.after = wine.drink_after || ''; badgeEl.dataset.by = wine.drink_by || ''; }
  applyWineBadges();
  sortWineTable();
  syncWineCards();
}

// ── Section switcher ──────────────────────────────────────────────────────────

const SECTION_KEY = 'cellar_section';

function switchSection(section) {
  const beerSection = document.getElementById('beerSection');
  const wineSection = document.getElementById('wineSection');
  if (beerSection) beerSection.hidden = (section !== 'beer');
  if (wineSection) wineSection.hidden = (section !== 'wine');

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === section);
  });

  localStorage.setItem(SECTION_KEY, section);
}

function setupSectionTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchSection(btn.dataset.section));
  });
  const saved = localStorage.getItem(SECTION_KEY) || 'beer';
  switchSection(saved);
}

// ── Wine init ─────────────────────────────────────────────────────────────────

applyWineBadges();
setupWineSort();
setupWineFilter();
setupWineViewToggle();
setupWineCardSort();
updateWineSortIndicators();
sortWineTable();
setWineView(getWinePreferredView());
setupSectionTabs();
document.getElementById('wineTableBody')?.classList.add('ready');

// ── Add Wine modal ────────────────────────────────────────────────────────────

(function () {
  if (!document.getElementById('addWineBtn')) return;

  const overlay = document.createElement('div');
  overlay.id = 'addWineModal';
  overlay.setAttribute('hidden', '');
  overlay.innerHTML = `
    <div class="add-beer-box">
      <div class="add-beer-header">
        <span class="add-beer-title">Add Wine</span>
        <button class="add-beer-close" id="addWineClose">✕</button>
      </div>
      <div id="addWineBody"></div>
    </div>`;
  document.body.appendChild(overlay);

  const state = { step: 0, results: [], selected: null };

  function openAddWine() {
    overlay.removeAttribute('hidden');
    fetch('/api/auth')
      .then(r => { if (r.ok) return renderWStep1(); else renderWStep0(); })
      .catch(() => renderWStep0());
  }

  function closeAddWine() {
    overlay.setAttribute('hidden', '');
    state.results = [];
    state.selected = null;
  }

  function body() { return document.getElementById('addWineBody'); }

  function wStepIndicator(current) {
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

  function renderWStep0(errorMsg) {
    body().innerHTML = `
      <div class="add-beer-auth">
        <label>Enter cellar password</label>
        <input class="add-field" type="password" id="wAuthPwInput" placeholder="Password" autocomplete="current-password">
        ${errorMsg ? `<div class="add-beer-error">${esc(errorMsg)}</div>` : ''}
        <div class="add-beer-actions">
          <button class="btn-primary" id="wAuthSubmitBtn">Unlock</button>
        </div>
      </div>`;
    const input = document.getElementById('wAuthPwInput');
    const btn = document.getElementById('wAuthSubmitBtn');
    input.focus();
    function doAuth() {
      btn.disabled = true;
      fetch('/api/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: input.value }),
      }).then(r => { if (r.ok) renderWStep1(); else renderWStep0('Wrong password.'); })
        .catch(() => renderWStep0('Network error.'));
    }
    btn.addEventListener('click', doAuth);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doAuth(); });
  }

  function renderWStep1() {
    body().innerHTML = `
      ${wStepIndicator(1)}
      <div class="add-beer-form">
        <label>Wine name</label>
        <input class="add-field" id="wLookupName" type="text" placeholder="e.g. Brunello di Montalcino" autocomplete="off">
        <label>Producer</label>
        <input class="add-field" id="wLookupProducer" type="text" placeholder="Optional" autocomplete="off">
        <label>Vintage</label>
        <input class="add-field" id="wLookupYear" type="number" min="1900" max="2100" placeholder="YYYY">
      </div>
      <div class="add-beer-actions">
        <button class="btn-secondary" id="wAddManuallyBtn">Add Manually</button>
        <button class="btn-primary" id="wDoLookupBtn">Look Up</button>
      </div>`;
    document.getElementById('wLookupName').focus();
    document.getElementById('wDoLookupBtn').addEventListener('click', doWineLookup);
    document.getElementById('wAddManuallyBtn').addEventListener('click', () => { state.selected = null; renderWStep3({}); });
    document.getElementById('wLookupName').addEventListener('keydown', e => { if (e.key === 'Enter') doWineLookup(); });
  }

  function doWineLookup() {
    const name = document.getElementById('wLookupName').value.trim();
    const producer = document.getElementById('wLookupProducer').value.trim();
    state.year = parseInt(document.getElementById('wLookupYear').value) || null;
    if (!name) return;
    const q = [producer, name].filter(Boolean).join(' ');
    body().innerHTML = '<div class="add-beer-loading">Searching Grapeminds…</div>';
    fetch('/api/wine-lookup?q=' + encodeURIComponent(q))
      .then(r => { if (r.status === 403) { renderWStep0(); return null; } return r.json(); })
      .then(results => {
        if (!results) return;
        state.results = results;
        renderWStep2();
      })
      .catch(() => { body().innerHTML = '<div class="add-beer-loading">Search failed. Try again.</div>'; });
  }

  function renderWStep2() {
    const results = state.results;
    let listHtml = '';
    if (results.length === 0) {
      listHtml = '<div class="add-beer-loading">No results found in Grapeminds.</div>';
    } else {
      listHtml = '<div class="lookup-results">';
      results.forEach((r, i) => {
        const meta = [r.producer_display_name || r.producer_name, r.color].filter(Boolean).join(' · ');
        listHtml += `
          <div class="lookup-result" data-idx="${i}">
            <div class="lookup-result-thumb" style="background:var(--surface2);border-radius:4px"></div>
            <div class="lookup-result-info">
              <div class="lookup-result-name">${esc(r.display_name || '—')}</div>
              <div class="lookup-result-meta">${esc(meta)}</div>
            </div>
          </div>`;
      });
      listHtml += '</div>';
    }
    body().innerHTML = `
      ${wStepIndicator(2)}
      ${listHtml}
      <div class="add-beer-actions">
        <button class="btn-secondary" id="wBackToStep1Btn">← Back</button>
        <button class="btn-secondary" id="wNoneOfTheseBtn">Add manually</button>
      </div>`;
    document.querySelectorAll('#addWineBody .lookup-result').forEach(el => {
      el.addEventListener('click', () => selectWineResult(parseInt(el.dataset.idx, 10)));
    });
    document.getElementById('wBackToStep1Btn').addEventListener('click', renderWStep1);
    document.getElementById('wNoneOfTheseBtn').addEventListener('click', () => { state.selected = null; renderWStep3({}); });
  }

  function selectWineResult(idx) {
    const r = state.results[idx];
    state.selected = r;
    renderWStep3(r);
  }

  function renderWStep3(wine) {
    const producerList = (window.CELLAR_PRODUCERS || []).map(p => `<option value="${esc(p)}">`).join('');
    const s = state.selected || {};
    body().innerHTML = `
      ${wStepIndicator(3)}
      <datalist id="wProducerList">${producerList}</datalist>
      <div class="add-beer-form">
        <label>Wine name *</label>
        <input class="add-field" id="wf-name" value="${esc(s.display_name || wine.name || '')}">
        <label>Producer *</label>
        <input class="add-field" id="wf-producer" value="${esc(s.producer_name || s.producer_display_name || wine.producer || '')}" list="wProducerList">
        <label>Vintage</label>
        <input class="add-field" id="wf-year" type="number" min="1900" max="2100" value="${state.year || ''}">
        <label>Region</label>
        <input class="add-field" id="wf-region" value="">
        <label>Varietal</label>
        <input class="add-field" id="wf-varietal" value="">
        <label>Quantity</label>
        <input class="add-field" id="wf-qty" type="number" min="1" value="1">
        <label>Label</label>
        <input class="add-field" id="wf-label" placeholder="e.g. Test" value="">
      </div>
      <div class="add-beer-error" id="wSubmitError" hidden></div>
      <div class="add-beer-actions">
        <button class="btn-secondary" id="wBackToStep2Btn">${state.results.length ? '← Back' : '← Back'}</button>
        <button class="btn-primary" id="wSubmitWineBtn">Add to Cellar</button>
      </div>`;
    document.getElementById('wBackToStep2Btn').addEventListener('click', () => {
      if (state.results.length) renderWStep2(); else renderWStep1();
    });
    document.getElementById('wSubmitWineBtn').addEventListener('click', doWineSubmit);
  }

  function doWineSubmit() {
    const name = document.getElementById('wf-name').value.trim();
    const producer = document.getElementById('wf-producer').value.trim();
    const errEl = document.getElementById('wSubmitError');
    if (!name || !producer) {
      errEl.textContent = 'Wine name and producer are required.';
      errEl.removeAttribute('hidden');
      return;
    }
    errEl.setAttribute('hidden', '');
    const s = state.selected || {};
    const payload = {
      name,
      producer,
      year:         parseInt(document.getElementById('wf-year').value) || null,
      region:       document.getElementById('wf-region').value.trim() || null,
      varietal:     document.getElementById('wf-varietal').value.trim() || null,
      quantity:     parseInt(document.getElementById('wf-qty').value) || 1,
      label:        document.getElementById('wf-label').value.trim() || null,
      grapeminds_id: s.id || null,
    };
    const btn = document.getElementById('wSubmitWineBtn');
    btn.disabled = true;
    fetch('/api/wines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(r => {
      if (r.status === 403) { renderWStep0(); return null; }
      if (!r.ok) { btn.disabled = false; errEl.textContent = 'Server error. Try again.'; errEl.removeAttribute('hidden'); return null; }
      return r.json();
    }).then(wine => {
      if (!wine) return;
      renderWStep4(wine);
      injectNewWineRow(wine);
    });
  }

  function renderWStep4(wine) {
    body().innerHTML = `
      ${wStepIndicator(4)}
      <div class="add-beer-success">
        <div class="add-beer-success-name">${esc(wine.name)}</div>
        <div class="add-beer-success-brewer">${esc(wine.producer)}</div>
        <div id="wResearchAnim" class="beer-mug-loader" aria-hidden="true">
          <div class="mug-body">
            <div class="mug-liquid" id="wMugLiquid">
              <div class="mug-foam"></div>
              <span class="mug-bubble" style="left:28%;animation-delay:0s"></span>
              <span class="mug-bubble" style="left:55%;animation-delay:0.6s"></span>
              <span class="mug-bubble" style="left:42%;animation-delay:1.2s"></span>
            </div>
          </div>
          <div class="mug-handle"></div>
        </div>
        <div class="research-status" id="wResearchStatus">Fetching drinking window…</div>
        <button class="btn-primary" id="addWineDoneBtn" style="margin-top:1rem">Done</button>
      </div>`;
    document.getElementById('addWineDoneBtn').addEventListener('click', closeAddWine);

    if (!wine.grapeminds_id) {
      const anim = document.getElementById('wResearchAnim');
      if (anim) anim.hidden = true;
      const el = document.getElementById('wResearchStatus');
      if (el) el.textContent = 'No Grapeminds match — add a drinking window via Edit if needed.';
      return;
    }

    let attempts = 0;
    const poll = setInterval(() => {
      if (++attempts > 30) {
        clearInterval(poll);
        const anim = document.getElementById('wResearchAnim');
        if (anim) anim.hidden = true;
        const el = document.getElementById('wResearchStatus');
        if (el) el.textContent = 'No window found yet — you can re-research later.';
        return;
      }
      fetch(`/api/wines/${wine.id}`).then(r => r.json()).then(updated => {
        if (updated.drink_after || updated.drink_by) {
          clearInterval(poll);
          const anim = document.getElementById('wResearchAnim');
          if (anim) anim.hidden = true;
          const el = document.getElementById('wResearchStatus');
          if (el) el.textContent = '✓ Drinking window set';
          updateWineRowFromResearch(updated);
        }
      }).catch(() => {});
    }, 3000);
  }

  document.getElementById('addWineBtn').addEventListener('click', openAddWine);
  document.getElementById('addWineClose').addEventListener('click', closeAddWine);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeAddWine(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !overlay.hasAttribute('hidden')) closeAddWine();
  });
})();
