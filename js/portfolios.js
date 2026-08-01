/* ============================================================
   PORTFOLIOS.JS
   Groups projects together and rolls their status up into a
   Portfolio Dashboard: KPIs, a health score with an explanation,
   and Grid / Cards / Timeline views of the portfolios themselves.
   ============================================================ */

const Portfolios = (() => {
  let viewMode = 'cards'; // 'cards' | 'grid' | 'timeline'
  let filters = { query: '', owner: '', showArchived: false };

  function getAll() { return DataStore.getPortfolios(); }

  function projectsFor(portfolioId) {
    return DataStore.getProjects().filter(p => p.portfolioId === portfolioId && !p.archived);
  }

  // ---------------- health + KPIs ----------------
  function computeHealth(projects) {
    const active = projects.filter(p => p.status !== 'Cancelled');
    if (!active.length) return { score: 100, band: 'green', reasons: ['No active projects to evaluate yet.'] };
    const today = Utils.todayISO();
    const delayed = active.filter(p => p.status !== 'Completed' && p.dueDate < today);
    const delayedRatio = delayed.length / active.length;
    const avgProgress = active.reduce((s, p) => s + (p.progress || 0), 0) / active.length;
    const budgeted = active.filter(p => p.budget);
    const avgBudgetUse = budgeted.length
      ? budgeted.reduce((s, p) => s + (Number(p.actualCost || 0) / Number(p.budget)), 0) / budgeted.length
      : null;

    let score = 100;
    score -= delayedRatio * 45;
    score -= Math.max(0, 60 - avgProgress) * 0.3;
    if (avgBudgetUse !== null && avgBudgetUse > 1) score -= Math.min(25, (avgBudgetUse - 1) * 100);
    score = Utils.clamp(Math.round(score), 0, 100);
    const band = score >= 75 ? 'green' : score >= 50 ? 'yellow' : 'red';

    const reasons = [];
    if (delayed.length) reasons.push(`${delayed.length} of ${active.length} active project(s) are past their due date.`);
    if (avgBudgetUse !== null && avgBudgetUse > 1) reasons.push(`Budget usage is averaging ${(avgBudgetUse * 100).toFixed(0)}% of plan across budgeted projects.`);
    if (avgProgress < 40) reasons.push(`Average progress across active projects is only ${Math.round(avgProgress)}%.`);
    if (!reasons.length) reasons.push('All active projects are on schedule, within budget, and progressing well.');
    return { score, band, reasons };
  }

  function kpis(projects) {
    const today = Utils.todayISO();
    const active = projects.filter(p => !['Completed', 'Cancelled'].includes(p.status));
    const completed = projects.filter(p => p.status === 'Completed');
    const delayed = projects.filter(p => p.status !== 'Completed' && p.status !== 'Cancelled' && p.dueDate < today);
    const avgProgress = projects.length ? Math.round(projects.reduce((s, p) => s + (p.progress || 0), 0) / projects.length) : 0;
    const budgeted = projects.filter(p => p.budget);
    const budgetTotal = budgeted.reduce((s, p) => s + Number(p.budget || 0), 0);
    const actualTotal = budgeted.reduce((s, p) => s + Number(p.actualCost || 0), 0);
    const budgetUsedPct = budgetTotal ? Math.round((actualTotal / budgetTotal) * 100) : null;
    const owners = new Set(projects.map(p => p.owner).filter(Boolean));
    const openTasks = DataStore.getTasks().filter(t => projects.some(p => p.id === t.projectId) && t.status !== 'Completed');
    const loadPerOwner = owners.size ? Math.round((openTasks.length / owners.size) * 10) / 10 : 0;
    return { total: projects.length, active: active.length, completed: completed.length, delayed: delayed.length, avgProgress, budgetUsedPct, loadPerOwner, ownerCount: owners.size };
  }

  // ---------------- filters ----------------
  function applyFilters(list) {
    return list.filter(p => {
      if (!filters.showArchived && p.archived) return false;
      if (filters.showArchived && !p.archived) return false;
      if (filters.owner && p.owner !== filters.owner) return false;
      if (filters.query) {
        const q = filters.query.toLowerCase();
        if (!p.name.toLowerCase().includes(q) && !(p.owner || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }

  // ---------------- list page ----------------
  function render(main, opts = {}) {
    const all = getAll();
    const owners = [...new Set(all.map(p => p.owner).filter(Boolean))];
    const filtered = applyFilters(all);

    main.innerHTML = `
      <div class="view-header">
        <div>
          <div class="view-header__title">Portfolios</div>
          <div class="view-header__subtitle">${filtered.length} of ${all.filter(p => !p.archived).length} portfolios</div>
        </div>
        <div class="view-header__actions">
          <button class="btn-primary" id="newPortfolioBtn">+ New Portfolio</button>
        </div>
      </div>
      <div class="toolbar">
        <input type="text" id="portSearch" placeholder="Search portfolios..." value="${Utils.escapeHtml(filters.query)}" style="min-width:200px;">
        <select id="portOwnerFilter"><option value="">All owners</option>${owners.map(o => `<option ${filters.owner === o ? 'selected' : ''}>${Utils.escapeHtml(o)}</option>`).join('')}</select>
        <button class="btn-ghost" id="portArchivedToggle">${filters.showArchived ? '📁 Show active' : '🗄 Show archived'}</button>
        <div class="view-toggle" style="margin-left:auto;">
          <button data-mode="cards" class="${viewMode === 'cards' ? 'is-active' : ''}">Cards</button>
          <button data-mode="grid" class="${viewMode === 'grid' ? 'is-active' : ''}">Grid</button>
          <button data-mode="timeline" class="${viewMode === 'timeline' ? 'is-active' : ''}">Timeline</button>
        </div>
      </div>
      <div id="portfoliosBody"></div>
    `;

    document.getElementById('newPortfolioBtn').addEventListener('click', () => openCreateModal());
    document.getElementById('portSearch').addEventListener('input', Utils.debounce((e) => { filters.query = e.target.value; render(main, opts); }, 200));
    document.getElementById('portOwnerFilter').addEventListener('change', (e) => { filters.owner = e.target.value; render(main, opts); });
    document.getElementById('portArchivedToggle').addEventListener('click', () => { filters.showArchived = !filters.showArchived; render(main, opts); });
    main.querySelectorAll('.view-toggle button').forEach(b => b.addEventListener('click', () => { viewMode = b.dataset.mode; render(main, opts); }));

    const body = document.getElementById('portfoliosBody');
    if (!filtered.length) {
      body.innerHTML = `<div class="card empty-state"><div class="empty-state__icon">🗂</div>No portfolios yet. Create one to start grouping your projects.</div>`;
      return;
    }
    if (viewMode === 'cards') renderCards(body, filtered);
    else if (viewMode === 'grid') renderGrid(body, filtered);
    else renderTimeline(body, filtered);

    if (opts.focusId) {
      const el = body.querySelector(`[data-id="${opts.focusId}"]`);
      if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); openDetailModal(opts.focusId); }
    }
  }

  function renderCards(body, list) {
    body.innerHTML = `<div class="project-grid">${list.map(p => {
      const projects = projectsFor(p.id);
      const health = computeHealth(projects);
      return `<div class="card project-card" style="--card-color:${Utils.colorHex(p.color)}" data-id="${p.id}">
        <div class="project-card__top">
          <div>
            <div class="project-card__name">${Utils.escapeHtml(p.name)}</div>
            <span class="health-badge health-badge--${health.band}">● Health ${health.score}/100</span>
          </div>
          <button class="project-card__menu" data-menu="${p.id}">⋯</button>
        </div>
        <div class="project-card__desc">${Utils.escapeHtml(p.description || 'No description yet.')}</div>
        <div class="project-card__meta">
          <span><span class="avatar">${Utils.initials(p.owner || '?')}</span> ${Utils.escapeHtml(p.owner || 'Unowned')}</span>
          <span class="text-faint">${projects.length} project(s)</span>
        </div>
      </div>`;
    }).join('')}</div>`;

    body.querySelectorAll('.project-card').forEach(card => card.addEventListener('click', (e) => {
      if (e.target.closest('.project-card__menu')) return;
      openDetailModal(card.dataset.id);
    }));
    body.querySelectorAll('[data-menu]').forEach(btn => btn.addEventListener('click', (e) => { e.stopPropagation(); openContextMenu(btn, btn.dataset.menu); }));
  }

  function renderGrid(body, list) {
    body.innerHTML = `<div class="table-scroll"><table class="data-table">
      <thead><tr><th>Portfolio</th><th>Owner</th><th>Projects</th><th>Active</th><th>Completed</th><th>Delayed</th><th>Progress</th><th>Health</th><th></th></tr></thead>
      <tbody>${list.map(p => {
        const projects = projectsFor(p.id);
        const k = kpis(projects);
        const health = computeHealth(projects);
        return `<tr class="is-clickable" data-id="${p.id}">
          <td><span class="row-color-dot" style="background:${Utils.colorHex(p.color)}"></span><strong>${Utils.escapeHtml(p.name)}</strong></td>
          <td>${Utils.escapeHtml(p.owner || '—')}</td>
          <td>${k.total}</td>
          <td>${k.active}</td>
          <td>${k.completed}</td>
          <td>${k.delayed}</td>
          <td>${k.avgProgress}%</td>
          <td><span class="health-badge health-badge--${health.band}">${health.score}</span></td>
          <td><button class="project-card__menu" data-menu="${p.id}">⋯</button></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
    body.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', (e) => { if (e.target.closest('[data-menu]')) return; openDetailModal(tr.dataset.id); }));
    body.querySelectorAll('[data-menu]').forEach(btn => btn.addEventListener('click', (e) => { e.stopPropagation(); openContextMenu(btn, btn.dataset.menu); }));
  }

  function renderTimeline(body, list) {
    const withRange = list.map(p => {
      const projects = projectsFor(p.id);
      if (!projects.length) return { portfolio: p, start: null, end: null };
      let start = projects[0].startDate, end = projects[0].dueDate;
      projects.forEach(pr => { if (pr.startDate < start) start = pr.startDate; if (pr.dueDate > end) end = pr.dueDate; });
      return { portfolio: p, start, end };
    }).filter(x => x.start);

    if (!withRange.length) {
      body.innerHTML = `<div class="card empty-state"><div class="empty-state__icon">📅</div>No dated projects yet in these portfolios.</div>`;
      return;
    }

    let rangeStart = withRange[0].start, rangeEnd = withRange[0].end;
    withRange.forEach(x => { if (x.start < rangeStart) rangeStart = x.start; if (x.end > rangeEnd) rangeEnd = x.end; });
    rangeStart = Utils.addDays(rangeStart, -5);
    rangeEnd = Utils.addDays(rangeEnd, 5);
    const pxPerDay = 6;
    const totalDays = Math.max(1, Utils.daysBetween(rangeStart, rangeEnd));
    const trackWidth = totalDays * pxPerDay;

    const ticks = [];
    let cursor = new Date(rangeStart + 'T00:00:00');
    cursor.setDate(1);
    const endD = new Date(rangeEnd + 'T00:00:00');
    while (cursor <= endD) {
      const monthStartIso = cursor.toISOString().slice(0, 10);
      const next = new Date(cursor);
      next.setMonth(next.getMonth() + 1);
      const clampedStart = monthStartIso < rangeStart ? rangeStart : monthStartIso;
      const clampedEnd = next.toISOString().slice(0, 10) > rangeEnd ? rangeEnd : next.toISOString().slice(0, 10);
      ticks.push({ label: cursor.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }), days: Math.max(1, Utils.daysBetween(clampedStart, clampedEnd)) });
      cursor = next;
    }

    const rows = withRange.map(x => {
      const left = Utils.daysBetween(rangeStart, x.start) * pxPerDay;
      const width = Math.max(6, Utils.daysBetween(x.start, x.end) * pxPerDay);
      return `<div class="gantt-row">
        <div class="gantt-label-col"><span class="row-color-dot" style="background:${Utils.colorHex(x.portfolio.color)}"></span>${Utils.escapeHtml(x.portfolio.name)}</div>
        <div class="gantt-track">
          <div class="gantt-bar" data-id="${x.portfolio.id}" style="left:${left}px; width:${width}px; background:${Utils.colorHex(x.portfolio.color)}; cursor:pointer;">${Utils.escapeHtml(x.portfolio.name)}</div>
        </div>
      </div>`;
    }).join('');

    body.innerHTML = `<div class="gantt-wrap"><div class="gantt-grid" style="min-width:${220 + trackWidth}px;">
      <div class="gantt-header">
        <div class="gantt-label-col">Portfolio</div>
        ${ticks.map(t => `<div class="gantt-tick" style="width:${t.days * pxPerDay}px;">${t.label}</div>`).join('')}
      </div>
      <div>${rows}</div>
    </div></div>`;

    body.querySelectorAll('.gantt-bar[data-id]').forEach(bar => bar.addEventListener('click', () => openDetailModal(bar.dataset.id)));
  }

  // ---------------- context menu ----------------
  function openContextMenu(anchor, id) {
    const portfolio = getAll().find(p => p.id === id);
    if (!portfolio) return;
    const rect = anchor.getBoundingClientRect();
    document.querySelectorAll('.ctx-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'ctx-menu card';
    menu.style.cssText = `position:fixed; top:${rect.bottom + 4}px; left:${rect.left - 120}px; z-index:150; padding:6px; min-width:150px;`;
    menu.innerHTML = `
      <div class="btn-ghost" data-act="edit" style="display:block; text-align:left; width:100%;">✏ Edit</div>
      <div class="btn-ghost" data-act="archive" style="display:block; text-align:left; width:100%;">${portfolio.archived ? '📤 Unarchive' : '🗄 Archive'}</div>
      <div class="btn-ghost" data-act="delete" style="display:block; text-align:left; width:100%; color:#C8393A;">🗑 Delete</div>
    `;
    document.body.appendChild(menu);
    const remove = () => menu.remove();
    setTimeout(() => document.addEventListener('click', remove, { once: true }), 0);
    menu.querySelectorAll('[data-act]').forEach(item => item.addEventListener('click', (e) => {
      e.stopPropagation();
      handleAction(item.dataset.act, id);
      remove();
    }));
  }

  function handleAction(act, id) {
    const all = getAll();
    const portfolio = all.find(p => p.id === id);
    if (!portfolio) return;
    if (act === 'edit') openEditModal(portfolio);
    if (act === 'archive') {
      portfolio.archived = !portfolio.archived;
      DataStore.setPortfolios([...all]);
      Utils.toast(portfolio.archived ? 'Portfolio archived' : 'Portfolio restored');
    }
    if (act === 'delete') deletePortfolio(portfolio);
  }

  function deletePortfolio(portfolio) {
    App.deleteWithUndo({ label: portfolio.name, kind: 'portfolio', id: portfolio.id });
  }

  // ---------------- forms ----------------
  function formHtml(p) {
    return `
      <div class="form-grid">
        <div class="form-field span-2"><label>Portfolio Name</label><input type="text" id="pf_name" value="${Utils.escapeHtml(p.name || '')}" placeholder="e.g. Data Platform Modernization"></div>
        <div class="form-field span-2"><label>Description</label><textarea id="pf_desc" placeholder="What ties these projects together?">${Utils.escapeHtml(p.description || '')}</textarea></div>
        <div class="form-field"><label>Owner</label><select id="pf_owner">${Utils.managerOptionsHtml(p.owner || '')}</select></div>
        <div class="form-field span-2"><label>Color</label><div class="color-picker" id="pf_colorPicker">${Utils.colorPickerHtml(p.color || 'indigo')}</div></div>
      </div>
    `;
  }

  function readForm(root) {
    return {
      name: root.querySelector('#pf_name').value.trim() || 'Untitled Portfolio',
      description: root.querySelector('#pf_desc').value.trim(),
      owner: root.querySelector('#pf_owner').value
    };
  }

  function openCreateModal() {
    const draft = { color: 'indigo' };
    let getColor;
    App.navigate('portfolios');
    Utils.openModal({
      title: 'New Portfolio',
      bodyHtml: formHtml(draft),
      footerHtml: `<button class="btn-secondary" data-close>Cancel</button><button class="btn-primary" id="savePortBtn">Create Portfolio</button>`,
      onMount: (root, close) => {
        getColor = Utils.bindColorPicker(root);
        root.querySelector('[data-close]').addEventListener('click', close);
        root.querySelector('#savePortBtn').addEventListener('click', () => {
          const data = readForm(root);
          const portfolio = { id: Utils.uid('port'), ...data, color: getColor(), archived: false, createdAt: Date.now() };
          DataStore.setPortfolios([...DataStore.getPortfolios(), portfolio]);
          Utils.toast(`Created "${portfolio.name}"`);
          close();
        });
      }
    });
  }

  function openEditModal(portfolio) {
    let getColor;
    Utils.openModal({
      title: 'Edit Portfolio',
      bodyHtml: formHtml(portfolio),
      footerHtml: `<button class="btn-secondary" data-close>Cancel</button><button class="btn-primary" id="savePortBtn">Save Changes</button>`,
      onMount: (root, close) => {
        getColor = Utils.bindColorPicker(root);
        root.querySelector('[data-close]').addEventListener('click', close);
        root.querySelector('#savePortBtn').addEventListener('click', () => {
          const data = readForm(root);
          const all = DataStore.getPortfolios();
          const idx = all.findIndex(x => x.id === portfolio.id);
          all[idx] = { ...portfolio, ...data, color: getColor() };
          DataStore.setPortfolios([...all]);
          Utils.toast('Portfolio updated');
          close();
        });
      }
    });
  }

  // ---------------- manage projects ----------------
  function openManageProjectsModal(portfolio) {
    const allProjects = DataStore.getProjects().filter(p => !p.archived);
    Utils.openModal({
      title: `Manage Projects — ${portfolio.name}`,
      bodyHtml: `<div style="max-height:360px; overflow-y:auto;">${allProjects.length ? allProjects.map(p => `
        <label class="flex gap-8" style="padding:9px 4px; border-bottom:1px solid var(--border-soft); cursor:pointer;">
          <input type="checkbox" data-project-id="${p.id}" ${p.portfolioId === portfolio.id ? 'checked' : ''}>
          <span class="row-color-dot" style="background:${Utils.colorHex(p.color)}"></span>
          <span style="flex:1;">${Utils.escapeHtml(p.name)}</span>
          <span class="text-faint" style="font-size:11.5px;">${p.portfolioId && p.portfolioId !== portfolio.id ? 'In another portfolio' : ''}</span>
        </label>`).join('') : `<div class="text-faint">No projects available yet.</div>`}</div>`,
      footerHtml: `<button class="btn-secondary" data-close>Cancel</button><button class="btn-primary" id="saveAssignBtn">Save</button>`,
      onMount: (root, close) => {
        root.querySelector('[data-close]').addEventListener('click', close);
        const saveBtn = root.querySelector('#saveAssignBtn');
        if (saveBtn) saveBtn.addEventListener('click', () => {
          const checks = root.querySelectorAll('[data-project-id]');
          const projects = DataStore.getProjects();
          checks.forEach(chk => {
            const idx = projects.findIndex(p => p.id === chk.dataset.projectId);
            if (idx === -1) return;
            if (chk.checked) projects[idx] = { ...projects[idx], portfolioId: portfolio.id };
            else if (projects[idx].portfolioId === portfolio.id) projects[idx] = { ...projects[idx], portfolioId: null };
          });
          DataStore.setProjects([...projects]);
          Utils.toast('Portfolio membership updated');
          close();
          openDetailModal(portfolio.id);
        });
      }
    });
  }

  // ---------------- portfolio dashboard modal ----------------
  function metricMini(label, value, color) {
    return `<div class="card metric-card"><div class="metric-card__label">${label}</div><div class="metric-card__value" style="color:${color || 'var(--ink)'}">${value}</div></div>`;
  }

  function openDetailModal(id) {
    const portfolio = getAll().find(p => p.id === id);
    if (!portfolio) return;
    const projects = DataStore.getProjects().filter(p => p.portfolioId === id && !p.archived);
    const health = computeHealth(projects);
    const k = kpis(projects);

    Utils.openModal({
      title: portfolio.name,
      wide: true,
      bodyHtml: `
        <div class="flex gap-8" style="margin-bottom:14px; flex-wrap:wrap; justify-content:space-between;">
          <div class="flex gap-8" style="flex-wrap:wrap;">
            <span class="health-badge health-badge--${health.band}">● Health: ${health.score}/100</span>
            <span class="tag">${Utils.escapeHtml(portfolio.owner || 'Unowned')}</span>
            ${portfolio.archived ? `<span class="tag">Archived</span>` : ''}
          </div>
          <button class="btn-secondary btn-sm" id="manageProjectsBtn">📁 Manage Projects</button>
        </div>
        <p class="text-soft">${Utils.escapeHtml(portfolio.description || 'No description yet.')}</p>
        <div class="metric-grid" style="grid-template-columns: repeat(4, 1fr); margin-top: 16px;">
          ${metricMini('Total Projects', k.total)}
          ${metricMini('Active', k.active)}
          ${metricMini('Completed', k.completed)}
          ${metricMini('Delayed', k.delayed, k.delayed ? 'var(--coral)' : 'var(--ink)')}
          ${metricMini('Overall Progress', k.avgProgress + '%')}
          ${metricMini('Budget Used', k.budgetUsedPct !== null ? k.budgetUsedPct + '%' : '—', (k.budgetUsedPct && k.budgetUsedPct > 100) ? 'var(--coral)' : 'var(--ink)')}
          ${metricMini('Owners Involved', k.ownerCount)}
          ${metricMini('Open Tasks / Owner', k.loadPerOwner)}
        </div>
        <div class="panel__title" style="margin-top:20px;">Why this score? <span class="text-faint" style="font-weight:500; font-size:11.5px;">— schedule, budget and progress across active projects</span></div>
        <ul style="margin:6px 0 16px; padding-left:18px; font-size:12.5px; color:var(--ink-soft);">
          ${health.reasons.map(r => `<li>${Utils.escapeHtml(r)}</li>`).join('')}
        </ul>
        <div class="panel__title">Projects in this Portfolio (${projects.length})</div>
        ${projects.length ? projects.map(p => `
          <div style="margin-bottom:12px;">
            <div class="flex" style="justify-content: space-between; margin-bottom: 5px; font-size: 12.5px;">
              <span class="flex gap-8"><span class="row-color-dot" style="background:${Utils.colorHex(p.color)}"></span><strong>${Utils.escapeHtml(p.name)}</strong></span>
              <span class="text-soft">${p.progress}%</span>
            </div>
            <div class="progress-bar" style="--card-color:${Utils.colorHex(p.color)}"><div class="progress-bar__fill" style="width:${p.progress}%"></div></div>
          </div>
        `).join('') : `<div class="text-faint">No projects assigned yet. Use "Manage Projects" to add some.</div>`}
      `,
      footerHtml: `
        <button class="btn-secondary" id="editPortBtn">✏ Edit</button>
        <button class="btn-danger" id="delPortBtn">Delete</button>
      `,
      onMount: (root, close) => {
        root.querySelector('#manageProjectsBtn').addEventListener('click', () => { close(); openManageProjectsModal(portfolio); });
        root.querySelector('#editPortBtn').addEventListener('click', () => { close(); openEditModal(portfolio); });
        root.querySelector('#delPortBtn').addEventListener('click', () => { close(); deletePortfolio(portfolio); });
      }
    });
  }

  return { getAll, projectsFor, computeHealth, kpis, render, openCreateModal, openEditModal, openDetailModal };
})();
