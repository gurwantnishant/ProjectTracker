/* ============================================================
   AUDIT.JS
   Records an audit trail of every create/update/delete across
   Projects, Milestones, Tasks (+ Subtasks), Portfolios, and
   Members — without touching any of those modules directly.

   How it works: DataStore already broadcasts a change event
   (via onChange) every time a collection is saved. This module
   keeps its own last-known copy of each collection, and on every
   change event diffs the new copy against its last-known copy to
   figure out what was created/updated/deleted, then writes
   human-readable entries to DataStore's auditLog collection.

   No "who" is tracked (Projectly has no login system) — just
   what changed and when.
   ============================================================ */

const AuditLog = (() => {
  const KIND_TYPE = { projects: 'project', tasks: 'task', milestones: 'milestone', portfolios: 'portfolio', members: 'member' };
  const TYPE_LABEL = { project: 'Project', task: 'Task', milestone: 'Milestone', portfolio: 'Portfolio', member: 'Member' };
  const TYPE_ICON = { project: '📁', task: '☑', milestone: '🎯', portfolio: '🗂', member: '👤' };

  const FIELD_LABELS = {
    name: 'Name', description: 'Description', owner: 'Owner', department: 'Department',
    startDate: 'Start date', dueDate: 'Due date', priority: 'Priority', status: 'Status',
    color: 'Color', budget: 'Budget', actualCost: 'Actual cost', tags: 'Tags',
    portfolioId: 'Portfolio', archived: 'Archived', plannedDate: 'Planned date',
    actualDate: 'Actual date', completion: 'Completion %', dependsOn: 'Depends on',
    dependencies: 'Dependencies',
    assignedTo: 'Assigned to', milestoneId: 'Milestone', projectId: 'Project',
    estimatedHours: 'Estimated hours', actualHours: 'Actual hours', progress: 'Progress %',
    role: 'Role'
  };

  // Fields that are auto-derived or internal — never worth an audit line on their own.
  const EXCLUDE_FIELDS = {
    project: ['id', 'createdAt', 'progress'],
    task: ['id', 'createdAt', 'comments', 'subtasks'],
    milestone: ['id', 'createdAt'],
    portfolio: ['id', 'createdAt'],
    member: ['id', 'createdAt']
  };

  let snapshot = {};
  let ready = false;

  function labelFor(field) { return FIELD_LABELS[field] || field; }

  function fmtValue(field, value) {
    if (value === null || value === undefined || value === '') return '—';
    if (field === 'archived') return value ? 'Yes' : 'No';
    if (field === 'portfolioId') { const p = DataStore.getPortfolios().find(x => x.id === value); return p ? p.name : value; }
    if (field === 'milestoneId') { const m = DataStore.getMilestones().find(x => x.id === value); return m ? m.name : value; }
    if (field === 'startDate' || field === 'dueDate' || field === 'plannedDate' || field === 'actualDate') return Utils.fmtDate(value);
    if (field === 'dependencies') {
      if (!value.length) return '—';
      const tasks = DataStore.getTasks();
      return value.map(d => {
        const pred = tasks.find(x => x.id === d.taskId);
        const lag = d.lag ? ` ${d.lag > 0 ? '+' : ''}${d.lag}d` : '';
        return `${pred ? pred.name : d.taskId} (${d.type}${lag})`;
      }).join(', ');
    }
    if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
    if (typeof value === 'object') return '(changed)';
    return String(value);
  }

  function diffEntity(type, before, after) {
    const exclude = new Set(EXCLUDE_FIELDS[type] || ['id', 'createdAt']);
    const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    const changes = [];
    keys.forEach(field => {
      if (exclude.has(field)) return;
      const a = before ? before[field] : undefined;
      const b = after ? after[field] : undefined;
      const an = a === undefined ? null : a, bn = b === undefined ? null : b;
      if (JSON.stringify(an) === JSON.stringify(bn)) return;
      changes.push({ field, label: labelFor(field), from: fmtValue(field, an), to: fmtValue(field, bn) });
    });
    return changes;
  }

  function diffSubtasks(before, after) {
    const changes = [];
    const beforeMap = new Map((before || []).map(s => [s.id, s]));
    const afterMap = new Map((after || []).map(s => [s.id, s]));
    afterMap.forEach((s, id) => {
      const b = beforeMap.get(id);
      if (!b) { changes.push({ field: 'subtask', label: 'Subtask', from: null, to: `Added "${s.name}"` }); return; }
      if (b.completed !== s.completed) {
        const verb = s.completed ? 'Completed' : 'Reopened';
        changes.push({ field: 'subtask', label: 'Subtask', from: null, to: `${verb} "${s.name}"` });
      }
      if (b.name !== s.name) changes.push({ field: 'subtask', label: 'Subtask', from: null, to: `Renamed "${b.name}" to "${s.name}"` });
    });
    beforeMap.forEach((s, id) => { if (!afterMap.has(id)) changes.push({ field: 'subtask', label: 'Subtask', from: null, to: `Removed "${s.name}"` }); });
    return changes;
  }

  function contextProjectId(type, item) {
    if (type === 'project') return item.id;
    if (type === 'task' || type === 'milestone') return item.projectId || null;
    return null;
  }

  function makeEntry(type, item, action, changes) {
    return {
      id: Utils.uid('audit'),
      entityType: type,
      entityId: item.id,
      entityName: item.name || '(unnamed)',
      contextProjectId: contextProjectId(type, item),
      action,
      changes,
      timestamp: Date.now()
    };
  }

  function diffCollection(type, before, after) {
    const beforeMap = new Map(before.map(i => [i.id, i]));
    const afterMap = new Map(after.map(i => [i.id, i]));
    const entries = [];
    afterMap.forEach((item, id) => {
      if (!beforeMap.has(id)) { entries.push(makeEntry(type, item, 'created', [])); return; }
      const b = beforeMap.get(id);
      let changes = diffEntity(type, b, item);
      if (type === 'task') changes = changes.concat(diffSubtasks(b.subtasks, item.subtasks));
      if (changes.length) entries.push(makeEntry(type, item, 'updated', changes));
    });
    beforeMap.forEach((item, id) => { if (!afterMap.has(id)) entries.push(makeEntry(type, item, 'deleted', [])); });
    return entries;
  }

  const GETTERS = {
    projects: () => DataStore.getProjects(),
    tasks: () => DataStore.getTasks(),
    milestones: () => DataStore.getMilestones(),
    portfolios: () => DataStore.getPortfolios(),
    members: () => DataStore.getMembers()
  };

  async function handleChange(kind) {
    if (kind === 'init') {
      snapshot = {
        projects: DataStore.getProjects(), tasks: DataStore.getTasks(), milestones: DataStore.getMilestones(),
        portfolios: DataStore.getPortfolios(), members: DataStore.getMembers()
      };
      ready = true;
      return;
    }
    const type = KIND_TYPE[kind];
    if (!type || !ready) return;
    const after = GETTERS[kind]();
    const before = snapshot[kind] || [];
    const entries = diffCollection(type, before, after);
    snapshot[kind] = after;
    if (entries.length) await DataStore.appendAuditLog(entries);
  }

  DataStore.onChange(handleChange);

  // ---------------- Activity Log page ----------------
  let filters = { type: '', action: '', query: '' };
  let visibleCount = 100;

  function fmtDateTime(ts) {
    const d = new Date(ts);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function actionBadge(action) {
    const label = action === 'created' ? 'Created' : action === 'deleted' ? 'Deleted' : 'Updated';
    return `<span class="badge badge--action-${action}">${label}</span>`;
  }

  function entryRowHtml(e) {
    const proj = e.contextProjectId ? DataStore.getProjects().find(p => p.id === e.contextProjectId) : null;
    const changesHtml = e.changes.length
      ? `<div class="audit-changes">${e.changes.map(c => c.field === 'subtask'
          ? `<div class="audit-change">${Utils.escapeHtml(c.to)}</div>`
          : `<div class="audit-change"><strong>${Utils.escapeHtml(c.label)}:</strong> ${Utils.escapeHtml(c.from)} → ${Utils.escapeHtml(c.to)}</div>`
        ).join('')}</div>`
      : '';
    return `
      <div class="audit-row">
        <div class="audit-row__icon">${TYPE_ICON[e.entityType] || '•'}</div>
        <div class="audit-row__body">
          <div class="audit-row__head">
            ${actionBadge(e.action)}
            <span class="audit-row__type">${TYPE_LABEL[e.entityType] || e.entityType}</span>
            <span class="audit-row__name">${Utils.escapeHtml(e.entityName)}</span>
            ${proj && e.entityType !== 'project' ? `<span class="text-faint" style="font-size:12px;">in ${Utils.escapeHtml(proj.name)}</span>` : ''}
            <span class="audit-row__time text-faint">${fmtDateTime(e.timestamp)}</span>
          </div>
          ${changesHtml}
        </div>
      </div>
    `;
  }

  function applyFilters(list) {
    return list.filter(e => {
      if (filters.type && e.entityType !== filters.type) return false;
      if (filters.action && e.action !== filters.action) return false;
      if (filters.query && !e.entityName.toLowerCase().includes(filters.query.toLowerCase())) return false;
      return true;
    });
  }

  function render(main) {
    visibleCount = 100;
    renderBody(main);
  }

  function renderBody(main) {
    const all = DataStore.getAuditLog();
    const filtered = applyFilters(all);
    const visible = filtered.slice(0, visibleCount);

    main.innerHTML = `
      <div class="view-header">
        <div>
          <div class="view-header__title">Activity Log</div>
          <div class="view-header__subtitle">${filtered.length} of ${all.length} events</div>
        </div>
      </div>

      <div class="toolbar">
        <input type="text" id="auditSearch" placeholder="Search by name..." value="${Utils.escapeHtml(filters.query)}" style="min-width:180px;">
        <select id="auditTypeFilter">
          <option value="">All types</option>
          ${Object.keys(TYPE_LABEL).map(t => `<option value="${t}" ${filters.type === t ? 'selected' : ''}>${TYPE_LABEL[t]}</option>`).join('')}
        </select>
        <select id="auditActionFilter">
          <option value="">All actions</option>
          <option value="created" ${filters.action === 'created' ? 'selected' : ''}>Created</option>
          <option value="updated" ${filters.action === 'updated' ? 'selected' : ''}>Updated</option>
          <option value="deleted" ${filters.action === 'deleted' ? 'selected' : ''}>Deleted</option>
        </select>
      </div>

      <div id="auditList">
        ${visible.length ? visible.map(entryRowHtml).join('') : `<div class="card empty-state"><div class="empty-state__icon">🕓</div>No activity ${all.length ? 'matches your filters' : 'yet'}.</div>`}
      </div>
      ${filtered.length > visible.length ? `<div style="text-align:center; margin-top:14px;"><button class="btn-secondary" id="auditLoadMore">Show more (${filtered.length - visible.length} remaining)</button></div>` : ''}
    `;

    document.getElementById('auditSearch').addEventListener('input', Utils.debounce((e) => { filters.query = e.target.value; visibleCount = 100; renderBody(main); }, 200));
    document.getElementById('auditTypeFilter').addEventListener('change', (e) => { filters.type = e.target.value; visibleCount = 100; renderBody(main); });
    document.getElementById('auditActionFilter').addEventListener('change', (e) => { filters.action = e.target.value; visibleCount = 100; renderBody(main); });
    const loadMoreBtn = document.getElementById('auditLoadMore');
    if (loadMoreBtn) loadMoreBtn.addEventListener('click', () => { visibleCount += 100; renderBody(main); });
  }

  return { render };
})();
