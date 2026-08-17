/* ============================================================
   UTILS.JS - shared helpers used across all modules
   ============================================================ */

const Utils = (() => {

  const PROJECT_COLORS = [
    { key: 'indigo', hex: '#5B5FEF' },
    { key: 'coral',  hex: '#FF6B6B' },
    { key: 'teal',   hex: '#00C2A8' },
    { key: 'amber',  hex: '#FFB020' },
    { key: 'violet', hex: '#B15CFF' },
    { key: 'pink',   hex: '#FF6FA5' },
    { key: 'sky',    hex: '#2FA9E8' },
    { key: 'lime',   hex: '#8FCB3B' }
  ];

  function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  // Format: MMDD YY (e.g. 0803 26 for August 3, 2026)
  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return '—';
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    return `${mm}${dd} ${yy}`;
  }

  function daysBetween(a, b) {
    const A = new Date(a + 'T00:00:00');
    const B = new Date(b + 'T00:00:00');
    return Math.round((B - A) / 86400000);
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function addDays(iso, n) {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  function colorHex(key) {
    const found = PROJECT_COLORS.find(c => c.key === key);
    return found ? found.hex : PROJECT_COLORS[0].hex;
  }

  function initials(name) {
    if (!name) return '?';
    return name.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  }

  function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- toast ----
  function toast(message, opts = {}) {
    const { actionLabel, onAction, tone = 'default', duration = 5000 } = opts;
    const host = document.getElementById('toastHost');
    const el = document.createElement('div');
    el.className = `toast toast--${tone}`;
    el.innerHTML = `
      <span class="toast__msg">${escapeHtml(message)}</span>
      ${actionLabel ? `<button class="toast__action">${escapeHtml(actionLabel)}</button>` : ''}
      <button class="toast__close" aria-label="Dismiss">✕</button>
    `;
    host.appendChild(el);
    const remove = () => { el.classList.add('toast--out'); setTimeout(() => el.remove(), 200); };
    if (actionLabel) el.querySelector('.toast__action').addEventListener('click', () => { onAction && onAction(); remove(); });
    el.querySelector('.toast__close').addEventListener('click', remove);
    const timer = setTimeout(remove, duration);
    el.addEventListener('mouseenter', () => clearTimeout(timer));
    return remove;
  }

  // ---- modal ----
  function openModal({ title, bodyHtml, footerHtml, onMount, wide }) {
    const root = document.getElementById('modalRoot');
    root.innerHTML = `
      <div class="modal-backdrop" id="modalBackdrop">
        <div class="modal ${wide ? 'modal--wide' : ''}" role="dialog" aria-modal="true">
          <div class="modal__header">
            <h3>${escapeHtml(title)}</h3>
            <button class="modal__close" id="modalCloseBtn" aria-label="Close">✕</button>
          </div>
          <div class="modal__body">${bodyHtml}</div>
          ${footerHtml ? `<div class="modal__footer">${footerHtml}</div>` : ''}
        </div>
      </div>
    `;
    root.classList.add('is-open');
    const close = () => { root.classList.remove('is-open'); root.innerHTML = ''; };
    document.getElementById('modalCloseBtn').addEventListener('click', close);
    document.getElementById('modalBackdrop').addEventListener('click', (e) => {
      if (e.target.id === 'modalBackdrop') close();
    });
    if (onMount) onMount(root, close);
    return close;
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // ---- shared team member option lists (used by Projects, Portfolios, Tasks) ----
  // People no longer split into manager/member buckets — Workforce Planning >
  // People is the single source of truth. Both Owner and Assignee dropdowns
  // list every active person, alphabetically. Kept as two named functions
  // (rather than collapsing call sites) so Owner/Assignee could diverge again
  // later (e.g. filtering Owner to a specific job Role) without touching
  // Projects/Portfolios/Tasks/Milestones/Import.
  function peopleOptionsHtml(current) {
    const list = DataStore.getMembers().filter(m => m.status !== 'Inactive').sort((a, b) => a.name.localeCompare(b.name));
    const names = list.map(m => m.name);
    const extra = (current && !names.includes(current))
      ? `<option value="${escapeHtml(current)}" selected>${escapeHtml(current)} (not in People)</option>`
      : '';
    return `<option value="">Unassigned</option>${extra}${list.map(m =>
      `<option value="${escapeHtml(m.name)}" ${current === m.name ? 'selected' : ''}>${escapeHtml(m.name)}</option>`
    ).join('')}`;
  }

  function managerOptionsHtml(current) { return peopleOptionsHtml(current); }
  function memberOptionsHtml(current) { return peopleOptionsHtml(current); }

  // ---- shared Role / Skill option lists (Workforce Planning) ----
  function workforceRoleOptionsHtml(current, placeholder = 'No role') {
    const list = (typeof DataStore.getRoles === 'function' ? DataStore.getRoles() : []).slice().sort((a, b) => a.name.localeCompare(b.name));
    return `<option value="">${escapeHtml(placeholder)}</option>${list.map(r =>
      `<option value="${r.id}" ${current === r.id ? 'selected' : ''}>${escapeHtml(r.name)}</option>`
    ).join('')}`;
  }

  // ---- shared color picker (used by Projects, Portfolios, etc.) ----
  function colorPickerHtml(selected) {
    return PROJECT_COLORS.map(c => `<div class="color-swatch ${c.key === selected ? 'is-selected' : ''}" data-color="${c.key}" style="background:${c.hex}"></div>`).join('');
  }

  function bindColorPicker(root) {
    let selected = root.querySelector('.color-swatch.is-selected')?.dataset.color || 'indigo';
    root.querySelectorAll('.color-swatch').forEach(sw => sw.addEventListener('click', () => {
      root.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('is-selected'));
      sw.classList.add('is-selected');
      selected = sw.dataset.color;
    }));
    return () => selected;
  }

  return {
    PROJECT_COLORS, uid, fmtDate, daysBetween, todayISO, addDays, clamp,
    colorHex, initials, escapeHtml, toast, openModal, debounce,
    colorPickerHtml, bindColorPicker, managerOptionsHtml, memberOptionsHtml,
    peopleOptionsHtml, workforceRoleOptionsHtml
  };
})();
