/* ============================================================
   RIDAC.JS
   Risk / Issue / Decision / Action / Concern governance register.
   One register per project (every record carries a projectId).
   Rendered inside the Project Workspace's "RIDAC" section — see
   workspace.js — using DataStore.getRidacs()/setRidacs() exactly
   the way Projects/Tasks/Milestones already use their collections.
   ============================================================ */

const Ridac = (() => {
  const TYPES = [
    { key: 'Risk',     prefix: 'R', icon: '⚠️' },
    { key: 'Issue',    prefix: 'I', icon: '🐞' },
    { key: 'Decision', prefix: 'D', icon: '🧭' },
    { key: 'Action',   prefix: 'A', icon: '✅' },
    { key: 'Concern',  prefix: 'C', icon: '💬' }
  ];
  const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
  const PROBABILITIES = ['Low', 'Medium', 'High'];

  // Per-type State options. "Closed" is always the final option in every
  // list so overdue/closed logic can treat it as the one universal
  // "done" value regardless of type.
  const STATE_OPTIONS = {
    Risk: ['Open', 'Mitigating', 'Monitoring', 'Closed'],
    Issue: ['Open', 'In Progress', 'Resolved', 'Closed'],
    Decision: ['Pending', 'Under Review', 'Decided', 'Closed'],
    Action: ['Not Started', 'In Progress', 'Completed', 'Closed'],
    Concern: ['Open', 'Acknowledged', 'Resolved', 'Closed']
  };
  const RISK_STATUSES = ['Identified', 'Mitigating', 'Monitoring', 'Closed'];
  const DECISION_STATUSES = ['Pending', 'Options Under Review', 'Decided', 'Closed'];

  let filters = { type: '', state: '', priority: '', owner: '', overdueOnly: false, query: '' };
  let groupByType = true;
  let sortKey = 'number';
  let sortDir = 'asc';

  function typeConfig(t) { return TYPES.find(x => x.key === t) || TYPES[0]; }
  function priClass(p) { return 'badge--pri-' + (p || '').toLowerCase(); }

  // Reuses the app's existing status badge palette instead of introducing
  // new colors: every RIDAC state buckets into one of the four looks
  // Projectly already has badges for (not-started / in-progress / on-hold / completed).
  function stateBadgeClass(state) {
    if (state === 'Closed' || state === 'Completed' || state === 'Resolved' || state === 'Decided') return 'badge--status-completed';
    if (state === 'On Hold') return 'badge--status-onhold';
    if (state === 'Open' || state === 'Not Started' || state === 'Pending' || state === 'Identified' || state === 'Acknowledged') return 'badge--status-notstarted';
    return 'badge--status-inprogress';
  }

  function isClosed(r) { return r.state === 'Closed'; }
  function isOverdue(r) { return !isClosed(r) && !!r.dueDate && r.dueDate < Utils.todayISO(); }

  function nextNumber(projectId, type) {
    const cfg = typeConfig(type);
    let max = 0;
    DataStore.getRidacs().filter(r => r.projectId === projectId && r.type === type).forEach(r => {
      const m = /(\d+)\s*$/.exec(r.number || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return `${cfg.prefix}-${String(max + 1).padStart(3, '0')}`;
  }

  function forProject(projectId) {
    return DataStore.getRidacs().filter(r => r.projectId === projectId);
  }

  function getOverdue(projectId) {
    return forProject(projectId).filter(isOverdue);
  }

  function applyFilters(list) {
    return list.filter(r => {
      if (filters.type && r.type !== filters.type) return false;
      if (filters.state && r.state !== filters.state) return false;
      if (filters.priority && r.priority !== filters.priority) return false;
      if (filters.owner && r.assignedTo !== filters.owner) return false;
      if (filters.overdueOnly && !isOverdue(r)) return false;
      if (filters.query) {
        const q = filters.query.toLowerCase();
        if (!(r.title || '').toLowerCase().includes(q) &&
            !(r.number || '').toLowerCase().includes(q) &&
            !(r.description || '').toLowerCase().includes(q) &&
            !(r.assignedTo || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }

  function sortList(list) {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      av = (av === undefined || av === null) ? '' : av;
      bv = (bv === undefined || bv === null) ? '' : bv;
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }

  // ---------------- grid ----------------
  const COLUMNS = [
    { key: 'type', label: 'Type' },
    { key: 'number', label: 'Number' },
    { key: 'title', label: 'Title' },
    { key: 'state', label: 'State' },
    { key: 'priority', label: 'Priority' },
    { key: 'dueDate', label: 'Due Date' },
    { key: 'impact', label: 'Impact' },
    { key: 'assignedTo', label: 'Assigned To' },
    { key: 'probability', label: 'Probability' },
    { key: 'riskStatus', label: 'Risk Status' },
    { key: 'decisionStatus', label: 'Decision Status' }
  ];

  function sortArrow(key) {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  }

  function headerRowHtml() {
    return `<tr>${COLUMNS.map(c => `<th data-sort="${c.key}" style="cursor:pointer; user-select:none;">${c.label}${sortArrow(c.key)}</th>`).join('')}<th></th></tr>`;
  }

  function rowHtml(r) {
    const cfg = typeConfig(r.type);
    const overdue = isOverdue(r);
    return `<tr class="is-clickable" data-id="${r.id}">
      <td>${cfg.icon} ${r.type}</td>
      <td><span class="text-faint" style="font-family:var(--font-mono);">${Utils.escapeHtml(r.number)}</span></td>
      <td><strong>${Utils.escapeHtml(r.title || 'Untitled')}</strong></td>
      <td><span class="badge ${stateBadgeClass(r.state)}">${Utils.escapeHtml(r.state || '—')}</span></td>
      <td>${r.priority ? `<span class="badge ${priClass(r.priority)}">${r.priority}</span>` : '<span class="text-faint">—</span>'}</td>
      <td>${r.dueDate ? `<span class="${overdue ? 'project-card__flag flag--risk' : ''}" style="${overdue ? '' : 'padding:0;'}">${overdue ? '🔴 ' : ''}${Utils.fmtDate(r.dueDate)}</span>` : '<span class="text-faint">—</span>'}</td>
      <td>${r.impact ? `<span class="badge ${priClass(r.impact)}">${r.impact}</span>` : '<span class="text-faint">—</span>'}</td>
      <td>${r.assignedTo ? Utils.escapeHtml(r.assignedTo) : '<span class="text-faint">Unassigned</span>'}</td>
      <td>${r.probability || '<span class="text-faint">—</span>'}</td>
      <td>${r.riskStatus ? `<span class="badge ${stateBadgeClass(r.riskStatus)}">${r.riskStatus}</span>` : '<span class="text-faint">—</span>'}</td>
      <td>${r.decisionStatus ? `<span class="badge ${stateBadgeClass(r.decisionStatus)}">${r.decisionStatus}</span>` : '<span class="text-faint">—</span>'}</td>
      <td><button class="project-card__menu" data-menu="${r.id}">⋯</button></td>
    </tr>`;
  }

  function tableHtml(rows) {
    return `<div class="table-scroll"><table class="data-table">
      <thead>${headerRowHtml()}</thead>
      <tbody>${rows.map(rowHtml).join('')}</tbody>
    </table></div>`;
  }

  function groupedHtml(rows) {
    let html = '';
    TYPES.forEach(t => {
      const typeRows = sortList(rows.filter(r => r.type === t.key));
      if (!typeRows.length) return;
      const overdueCount = typeRows.filter(isOverdue).length;
      html += `
        <div class="panel__title" style="display:flex; align-items:center; gap:8px; margin: 18px 0 8px;">
          <span>${t.icon} ${t.key}s</span>
          <span class="tag">${typeRows.length}</span>
          ${overdueCount ? `<span class="project-card__flag flag--risk">${overdueCount} overdue</span>` : ''}
          <button class="btn-ghost btn-sm" style="margin-left:auto;" data-quick-add="${t.key}">+ Add ${t.key}</button>
        </div>
        ${tableHtml(typeRows)}
      `;
    });
    return html;
  }

  function contextMenu(anchor, id, projectId) {
    const r = DataStore.getRidacs().find(x => x.id === id);
    if (!r) return;
    const rect = anchor.getBoundingClientRect();
    document.querySelectorAll('.ctx-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'ctx-menu card';
    menu.style.cssText = `position:fixed; top:${rect.bottom + 4}px; left:${rect.left - 120}px; z-index:150; padding:6px; min-width:150px;`;
    menu.innerHTML = `
      <div class="btn-ghost" data-act="open" style="display:block; text-align:left; width:100%;">👁 Open</div>
      <div class="btn-ghost" data-act="edit" style="display:block; text-align:left; width:100%;">✏ Edit</div>
      <div class="btn-ghost" data-act="close" style="display:block; text-align:left; width:100%;">${isClosed(r) ? '↩ Reopen' : '✔ Mark Closed'}</div>
      <div class="btn-ghost" data-act="delete" style="display:block; text-align:left; width:100%; color:#C8393A;">🗑 Delete</div>
    `;
    document.body.appendChild(menu);
    const remove = () => menu.remove();
    setTimeout(() => document.addEventListener('click', remove, { once: true }), 0);
    menu.querySelectorAll('[data-act]').forEach(item => item.addEventListener('click', (e) => {
      e.stopPropagation();
      const act = item.dataset.act;
      if (act === 'open' || act === 'edit') openDetailModal(id, { startEditing: act === 'edit' });
      if (act === 'close') toggleClosed(r);
      if (act === 'delete') App.deleteWithUndo({ label: `${r.number} ${r.title}`, kind: 'ridac', id: r.id });
      remove();
    }));
  }

  function toggleClosed(r) {
    const all = DataStore.getRidacs();
    const idx = all.findIndex(x => x.id === r.id);
    if (idx === -1) return;
    const closing = !isClosed(r);
    all[idx] = { ...r, state: closing ? 'Closed' : (STATE_OPTIONS[r.type][0]), closedAt: closing ? Date.now() : null, updatedAt: Date.now() };
    DataStore.setRidacs([...all]);
    Utils.toast(closing ? `${r.number} marked closed` : `${r.number} reopened`);
  }

  // ---------------- CSV export ----------------
  function exportCSV(projectId) {
    const rows = sortList(applyFilters(forProject(projectId)));
    const header = ['Type', 'Number', 'Title', 'State', 'Priority', 'Due Date', 'Impact', 'Assigned To', 'Probability', 'Risk Status', 'Decision Status', 'Description'];
    const csvRows = rows.map(r => [
      r.type, r.number, r.title, r.state, r.priority || '', r.dueDate || '', r.impact || '',
      r.assignedTo || '', r.probability || '', r.riskStatus || '', r.decisionStatus || '', r.description || ''
    ]);
    const csv = [header, ...csvRows].map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'ridac-register.csv'; a.click();
    URL.revokeObjectURL(url);
    Utils.toast('Exported ridac-register.csv');
  }

  // ---------------- main render ----------------
  function render(host, projectId) {
    if (!host) return;
    const all = forProject(projectId);
    const filtered = sortList(applyFilters(all));
    const owners = [...new Set(all.map(r => r.assignedTo).filter(Boolean))];
    const overdueTotal = all.filter(isOverdue).length;

    host.innerHTML = `
      <div class="view-header">
        <div>
          <div class="view-header__title">RIDAC Register</div>
          <div class="view-header__subtitle">${filtered.length} of ${all.length} items${overdueTotal ? ` · ${overdueTotal} overdue` : ''}</div>
        </div>
        <div class="view-header__actions">
          <button class="btn-secondary" id="ridacExportBtn">⬇ Export CSV</button>
          <button class="btn-primary" id="ridacAddBtn">+ Add RIDAC</button>
        </div>
      </div>

      <div class="toolbar">
        <input type="text" id="ridacSearch" placeholder="Search RIDAC..." value="${Utils.escapeHtml(filters.query)}" style="min-width:200px;">
        <select id="ridacTypeFilter"><option value="">All types</option>${TYPES.map(t => `<option value="${t.key}" ${filters.type === t.key ? 'selected' : ''}>${t.icon} ${t.key}</option>`).join('')}</select>
        <select id="ridacStateFilter"><option value="">All states</option>${[...new Set(Object.values(STATE_OPTIONS).flat())].map(s => `<option ${filters.state === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <select id="ridacPriorityFilter"><option value="">All priorities</option>${PRIORITIES.map(p => `<option ${filters.priority === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
        <select id="ridacOwnerFilter"><option value="">All owners</option>${owners.map(o => `<option ${filters.owner === o ? 'selected' : ''}>${Utils.escapeHtml(o)}</option>`).join('')}</select>
        <button class="btn-ghost" id="ridacOverdueToggle">${filters.overdueOnly ? '🔴 Overdue only' : '⏰ Show overdue'}</button>
        <div class="view-toggle" style="margin-left:auto;">
          <button data-mode="grouped" class="${groupByType ? 'is-active' : ''}">Group by Type</button>
          <button data-mode="flat" class="${!groupByType ? 'is-active' : ''}">Flat List</button>
        </div>
      </div>

      <div id="ridacBody"></div>
    `;

    document.getElementById('ridacAddBtn').addEventListener('click', () => openTypePicker(projectId));
    document.getElementById('ridacExportBtn').addEventListener('click', () => exportCSV(projectId));
    document.getElementById('ridacSearch').addEventListener('input', Utils.debounce((e) => { filters.query = e.target.value; render(host, projectId); }, 200));
    document.getElementById('ridacTypeFilter').addEventListener('change', (e) => { filters.type = e.target.value; render(host, projectId); });
    document.getElementById('ridacStateFilter').addEventListener('change', (e) => { filters.state = e.target.value; render(host, projectId); });
    document.getElementById('ridacPriorityFilter').addEventListener('change', (e) => { filters.priority = e.target.value; render(host, projectId); });
    document.getElementById('ridacOwnerFilter').addEventListener('change', (e) => { filters.owner = e.target.value; render(host, projectId); });
    document.getElementById('ridacOverdueToggle').addEventListener('click', () => { filters.overdueOnly = !filters.overdueOnly; render(host, projectId); });
    host.querySelectorAll('.view-toggle button').forEach(b => b.addEventListener('click', () => { groupByType = b.dataset.mode === 'grouped'; render(host, projectId); }));

    const body = document.getElementById('ridacBody');
    if (!filtered.length) {
      body.innerHTML = `<div class="card empty-state"><div class="empty-state__icon">🛡</div>${all.length ? 'No RIDAC items match your filters.' : 'No RIDAC items yet. Add a Risk, Issue, Decision, Action, or Concern to start this project\'s register.'}</div>`;
    } else if (groupByType) {
      body.innerHTML = groupedHtml(filtered);
    } else {
      body.innerHTML = tableHtml(filtered);
    }

    body.querySelectorAll('tr[data-id]').forEach(tr => {
      tr.addEventListener('click', (e) => { if (e.target.closest('[data-menu]')) return; openDetailModal(tr.dataset.id); });
    });
    body.querySelectorAll('[data-menu]').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); contextMenu(btn, btn.dataset.menu, projectId); });
    });
    body.querySelectorAll('th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        else { sortKey = key; sortDir = 'asc'; }
        render(host, projectId);
      });
    });
    body.querySelectorAll('[data-quick-add]').forEach(btn => {
      btn.addEventListener('click', () => openFormModal(btn.dataset.quickAdd, null, projectId, host));
    });

    // Keep a reference so record CRUD elsewhere (modals) can refresh this exact host.
    lastHost = host;
    lastProjectId = projectId;
  }

  let lastHost = null, lastProjectId = null;
  function refresh() { if (lastHost && lastProjectId) render(lastHost, lastProjectId); }

  // ---------------- type picker (for the generic "+ Add RIDAC" button) ----------------
  function openTypePicker(projectId) {
    Utils.openModal({
      title: 'Add RIDAC Item',
      bodyHtml: `
        <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:10px;">
          ${TYPES.map(t => `<button type="button" class="btn-secondary" data-pick="${t.key}" style="justify-content:flex-start; padding:14px; font-size:14px;">${t.icon}&nbsp; ${t.key}</button>`).join('')}
        </div>
      `,
      onMount: (root, close) => {
        root.querySelectorAll('[data-pick]').forEach(btn => {
          btn.addEventListener('click', () => { close(); openFormModal(btn.dataset.pick, null, projectId); });
        });
      }
    });
  }

  // ---------------- type-specific form ----------------
  function coreFieldsHtml(r) {
    return `
      <div class="form-field span-2"><label>Title</label><input type="text" id="rf_title" value="${Utils.escapeHtml(r.title || '')}" placeholder="Short, specific summary"></div>
      <div class="form-field span-2"><label>Description</label><textarea id="rf_desc" placeholder="Full details">${Utils.escapeHtml(r.description || '')}</textarea></div>
      <div class="form-field"><label>State</label><select id="rf_state">${STATE_OPTIONS[r.type].map(s => `<option ${r.state === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="form-field"><label>Priority</label><select id="rf_priority">${PRIORITIES.map(p => `<option ${r.priority === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
      <div class="form-field"><label>${r.type === 'Decision' ? 'Decision Required By' : 'Due Date'}</label><input type="date" id="rf_dueDate" value="${r.dueDate || ''}"></div>
      <div class="form-field"><label>Assigned To</label><select id="rf_assignedTo">${Utils.peopleOptionsHtml(r.assignedTo || '')}</select></div>
      <div class="form-field span-2"><label>Created By (optional)</label><input type="text" id="rf_createdBy" value="${Utils.escapeHtml(r.createdBy || '')}" placeholder="e.g. who raised this"></div>
    `;
  }

  function typeFieldsHtml(r) {
    if (r.type === 'Risk') {
      return `
        <div class="form-field"><label>Impact</label><select id="rf_impact">${PRIORITIES.map(p => `<option ${r.impact === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
        <div class="form-field"><label>Probability</label><select id="rf_probability">${PROBABILITIES.map(p => `<option ${r.probability === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
        <div class="form-field"><label>Risk Status</label><select id="rf_riskStatus">${RISK_STATUSES.map(s => `<option ${r.riskStatus === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="form-field span-2"><label>Mitigation Plan</label><textarea id="rf_mitigationPlan" placeholder="How will this risk be reduced?">${Utils.escapeHtml(r.mitigationPlan || '')}</textarea></div>
        <div class="form-field span-2"><label>Contingency Plan</label><textarea id="rf_contingencyPlan" placeholder="What happens if it occurs anyway?">${Utils.escapeHtml(r.contingencyPlan || '')}</textarea></div>
      `;
    }
    if (r.type === 'Issue') {
      return `
        <div class="form-field"><label>Impact</label><select id="rf_impact">${PRIORITIES.map(p => `<option ${r.impact === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
        <div class="form-field span-2"><label>Root Cause</label><textarea id="rf_rootCause" placeholder="What caused this issue?">${Utils.escapeHtml(r.rootCause || '')}</textarea></div>
        <div class="form-field span-2"><label>Resolution Plan</label><textarea id="rf_resolutionPlan" placeholder="How will this be resolved?">${Utils.escapeHtml(r.resolutionPlan || '')}</textarea></div>
      `;
    }
    if (r.type === 'Decision') {
      return `
        <div class="form-field"><label>Decision Status</label><select id="rf_decisionStatus">${DECISION_STATUSES.map(s => `<option ${r.decisionStatus === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="form-field span-2"><label>Options Considered</label><textarea id="rf_options" placeholder="- Option A\n- Option B">${Utils.escapeHtml(r.options || '')}</textarea></div>
        <div class="form-field span-2"><label>Recommendation</label><textarea id="rf_recommendation" placeholder="What is recommended and why?">${Utils.escapeHtml(r.recommendation || '')}</textarea></div>
        <div class="form-field span-2"><label>Final Decision</label><textarea id="rf_finalDecision" placeholder="What was ultimately decided">${Utils.escapeHtml(r.finalDecision || '')}</textarea></div>
      `;
    }
    if (r.type === 'Action') {
      return `
        <div class="form-field"><label>Completion (%)</label><input type="number" id="rf_completion" min="0" max="100" value="${r.completion ?? 0}"></div>
      `;
    }
    return ''; // Concern uses only the core fields
  }

  function formHtml(r) {
    return `<div class="form-grid">${coreFieldsHtml(r)}${typeFieldsHtml(r)}</div>`;
  }

  function readForm(root, type) {
    const val = (id) => root.querySelector(id) ? root.querySelector(id).value.trim() : undefined;
    const data = {
      title: val('#rf_title') || 'Untitled',
      description: val('#rf_desc'),
      state: root.querySelector('#rf_state').value,
      priority: root.querySelector('#rf_priority').value,
      dueDate: root.querySelector('#rf_dueDate').value || null,
      assignedTo: root.querySelector('#rf_assignedTo').value,
      createdBy: val('#rf_createdBy')
    };
    if (type === 'Risk') {
      Object.assign(data, {
        impact: root.querySelector('#rf_impact').value,
        probability: root.querySelector('#rf_probability').value,
        riskStatus: root.querySelector('#rf_riskStatus').value,
        mitigationPlan: val('#rf_mitigationPlan'),
        contingencyPlan: val('#rf_contingencyPlan')
      });
    } else if (type === 'Issue') {
      Object.assign(data, {
        impact: root.querySelector('#rf_impact').value,
        rootCause: val('#rf_rootCause'),
        resolutionPlan: val('#rf_resolutionPlan')
      });
    } else if (type === 'Decision') {
      Object.assign(data, {
        decisionStatus: root.querySelector('#rf_decisionStatus').value,
        options: val('#rf_options'),
        recommendation: val('#rf_recommendation'),
        finalDecision: val('#rf_finalDecision')
      });
    } else if (type === 'Action') {
      Object.assign(data, { completion: Utils.clamp(parseInt(root.querySelector('#rf_completion').value) || 0, 0, 100) });
    }
    return data;
  }

  function openFormModal(type, record, projectId, refreshHost) {
    const isEdit = !!record;
    const draft = record || { type, state: STATE_OPTIONS[type][0], priority: 'Medium', probability: 'Medium', impact: 'Medium' };
    const cfg = typeConfig(type);
    Utils.openModal({
      title: isEdit ? `Edit ${type} — ${record.number}` : `New ${type}`,
      wide: true,
      bodyHtml: formHtml(draft),
      footerHtml: `<button class="btn-secondary" data-close>Cancel</button>${isEdit ? `<button class="btn-danger" id="ridacDelBtn">Delete</button>` : ''}<button class="btn-primary" id="ridacSaveBtn">${isEdit ? 'Save Changes' : `Create ${type}`}</button>`,
      onMount: (root, close) => {
        root.querySelector('[data-close]').addEventListener('click', close);
        if (isEdit) {
          root.querySelector('#ridacDelBtn').addEventListener('click', () => {
            close();
            App.deleteWithUndo({ label: `${record.number} ${record.title}`, kind: 'ridac', id: record.id });
            refresh();
          });
        }
        root.querySelector('#ridacSaveBtn').addEventListener('click', () => {
          const data = readForm(root, type);
          const wasClosed = isEdit && isClosed(record);
          const nowClosed = data.state === 'Closed';
          if (isEdit) {
            const all = DataStore.getRidacs();
            const idx = all.findIndex(x => x.id === record.id);
            if (idx === -1) return;
            all[idx] = {
              ...record, ...data, updatedAt: Date.now(),
              closedAt: nowClosed ? (record.closedAt || Date.now()) : (wasClosed && !nowClosed ? null : record.closedAt)
            };
            DataStore.setRidacs([...all]);
            Utils.toast(`${record.number} updated`);
          } else {
            const item = {
              id: Utils.uid('ridac'), projectId, type,
              number: nextNumber(projectId, type),
              ...data,
              impact: data.impact ?? null, probability: data.probability ?? null,
              riskStatus: data.riskStatus ?? null, decisionStatus: data.decisionStatus ?? null,
              mitigationPlan: data.mitigationPlan ?? '', contingencyPlan: data.contingencyPlan ?? '',
              rootCause: data.rootCause ?? '', resolutionPlan: data.resolutionPlan ?? '',
              options: data.options ?? '', recommendation: data.recommendation ?? '', finalDecision: data.finalDecision ?? '',
              completion: data.completion ?? 0,
              comments: [],
              closedAt: nowClosed ? Date.now() : null,
              createdAt: Date.now(), updatedAt: Date.now()
            };
            DataStore.setRidacs([...DataStore.getRidacs(), item]);
            Utils.toast(`${item.number} "${item.title}" created`);
          }
          close();
          refresh();
        });
      }
    });
  }

  // ---------------- detail modal (view + comments) ----------------
  function detailFieldHtml(label, value) {
    if (value === undefined || value === null || value === '') return '';
    return `<div style="margin-bottom:10px;"><div class="text-faint" style="font-size:11px; text-transform:uppercase; letter-spacing:.03em;">${label}</div><div style="font-size:13px; white-space:pre-wrap;">${Utils.escapeHtml(String(value))}</div></div>`;
  }

  function commentsHtml(r) {
    const list = r.comments || [];
    if (!list.length) return `<div class="text-faint" style="font-size:12.5px;">No comments yet.</div>`;
    return list.slice().reverse().map(c => `
      <div style="padding:8px 0; border-bottom:1px solid var(--border-soft);">
        <div class="flex gap-8" style="font-size:11.5px; color:var(--ink-faint); margin-bottom:2px;">
          <strong style="color:var(--ink-soft);">${Utils.escapeHtml(c.author || 'Someone')}</strong>
          <span>${new Date(c.timestamp).toLocaleString()}</span>
        </div>
        <div style="font-size:13px; white-space:pre-wrap;">${Utils.escapeHtml(c.text)}</div>
      </div>
    `).join('');
  }

  function openDetailModal(id, opts = {}) {
    const r = DataStore.getRidacs().find(x => x.id === id);
    if (!r) return;
    if (opts.startEditing) { openFormModal(r.type, r, r.projectId); return; }
    const cfg = typeConfig(r.type);
    const overdue = isOverdue(r);
    Utils.openModal({
      title: `${cfg.icon} ${r.number} — ${r.title}`,
      wide: true,
      bodyHtml: `
        <div class="flex gap-8" style="margin-bottom:14px; flex-wrap:wrap;">
          <span class="badge ${stateBadgeClass(r.state)}">${r.state}</span>
          ${r.priority ? `<span class="badge ${priClass(r.priority)}">${r.priority} priority</span>` : ''}
          ${overdue ? `<span class="project-card__flag flag--risk">🔴 Overdue</span>` : ''}
        </div>
        <div class="form-grid">
          <div>${detailFieldHtml('Description', r.description)}</div>
          <div>
            ${detailFieldHtml('Assigned To', r.assignedTo)}
            ${detailFieldHtml(r.type === 'Decision' ? 'Decision Required By' : 'Due Date', r.dueDate ? Utils.fmtDate(r.dueDate) : '')}
            ${detailFieldHtml('Created By', r.createdBy)}
          </div>
        </div>
        ${r.type === 'Risk' ? `
          <div class="form-grid" style="margin-top:6px;">
            <div>${detailFieldHtml('Impact', r.impact)}${detailFieldHtml('Probability', r.probability)}${detailFieldHtml('Risk Status', r.riskStatus)}</div>
            <div>${detailFieldHtml('Mitigation Plan', r.mitigationPlan)}${detailFieldHtml('Contingency Plan', r.contingencyPlan)}</div>
          </div>` : ''}
        ${r.type === 'Issue' ? `
          <div class="form-grid" style="margin-top:6px;">
            <div>${detailFieldHtml('Impact', r.impact)}${detailFieldHtml('Root Cause', r.rootCause)}</div>
            <div>${detailFieldHtml('Resolution Plan', r.resolutionPlan)}</div>
          </div>` : ''}
        ${r.type === 'Decision' ? `
          <div class="form-grid" style="margin-top:6px;">
            <div>${detailFieldHtml('Decision Status', r.decisionStatus)}${detailFieldHtml('Options Considered', r.options)}</div>
            <div>${detailFieldHtml('Recommendation', r.recommendation)}${detailFieldHtml('Final Decision', r.finalDecision)}</div>
          </div>` : ''}
        ${r.type === 'Action' ? `
          <div style="margin-top:6px;">
            <div class="text-faint" style="font-size:11px; text-transform:uppercase; margin-bottom:4px;">Completion</div>
            <div class="progress-bar"><div class="progress-bar__fill" style="width:${r.completion || 0}%"></div></div>
          </div>` : ''}
        <div class="panel__title" style="margin-top:20px;">Comments</div>
        <div id="ridacCommentsList" style="max-height:220px; overflow-y:auto; margin-bottom:10px;">${commentsHtml(r)}</div>
        <div class="flex gap-8">
          <input type="text" id="ridacCommentInput" placeholder="Add a comment..." style="flex:1; padding:9px 12px; border-radius:var(--radius-sm); border:1px solid var(--border); background:var(--bg); color:var(--ink); font-size:13px;">
          <button class="btn-secondary btn-sm" id="ridacCommentBtn">Post</button>
        </div>
      `,
      footerHtml: `
        <button class="btn-secondary" id="ridacDetailCloseBtn">${isClosed(r) ? '↩ Reopen' : '✔ Mark Closed'}</button>
        <button class="btn-secondary" id="ridacDetailEditBtn">✏ Edit</button>
        <button class="btn-danger" id="ridacDetailDelBtn">Delete</button>
      `,
      onMount: (root, close) => {
        root.querySelector('#ridacDetailEditBtn').addEventListener('click', () => { close(); openFormModal(r.type, r, r.projectId); });
        root.querySelector('#ridacDetailDelBtn').addEventListener('click', () => {
          close();
          App.deleteWithUndo({ label: `${r.number} ${r.title}`, kind: 'ridac', id: r.id });
          refresh();
        });
        root.querySelector('#ridacDetailCloseBtn').addEventListener('click', () => { toggleClosed(r); close(); refresh(); });
        root.querySelector('#ridacCommentBtn').addEventListener('click', () => {
          const input = root.querySelector('#ridacCommentInput');
          const text = input.value.trim();
          if (!text) return;
          const all = DataStore.getRidacs();
          const idx = all.findIndex(x => x.id === r.id);
          if (idx === -1) return;
          const comment = { id: Utils.uid('cmt'), author: r.assignedTo || 'You', text, timestamp: Date.now() };
          all[idx] = { ...all[idx], comments: [...(all[idx].comments || []), comment] };
          DataStore.setRidacs([...all]);
          close();
          openDetailModal(id);
          refresh();
        });
      }
    });
  }

  return {
    TYPES, STATE_OPTIONS, PRIORITIES,
    forProject, getOverdue, isOverdue, isClosed,
    render, refresh, openTypePicker, openFormModal, openDetailModal
  };
})();
