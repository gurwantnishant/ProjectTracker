/* ============================================================
   PROJECTS.JS
   ============================================================ */

const Projects = (() => {
  let viewMode = 'cards'; // 'cards' | 'table'
  let filters = { status: '', priority: '', department: '', query: '', showArchived: false };

  const STATUSES = ['Not Started', 'In Progress', 'On Hold', 'Completed', 'Cancelled'];
  const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

  function statusClass(s) { return 'badge--status-' + s.toLowerCase().replace(/\s+/g, ''); }
  function priClass(p) { return 'badge--pri-' + p.toLowerCase(); }

  function flagFor(p) {
    if (p.status === 'Completed' || p.status === 'Cancelled') return null;
    const today = Utils.todayISO();
    const daysLeft = Utils.daysBetween(today, p.dueDate);
    if (daysLeft < 0) return { cls: 'flag--risk', label: '🔴 At Risk' };
    if (daysLeft <= 7) return { cls: 'flag--warning', label: '🟡 Warning' };
    return { cls: 'flag--ontrack', label: '🟢 On Track' };
  }

  function applyFilters(projects) {
    return projects.filter(p => {
      if (!filters.showArchived && p.archived) return false;
      if (filters.showArchived && !p.archived) return false;
      if (filters.status && p.status !== filters.status) return false;
      if (filters.priority && p.priority !== filters.priority) return false;
      if (filters.department && p.department !== filters.department) return false;
      if (filters.query) {
        const q = filters.query.toLowerCase();
        if (!p.name.toLowerCase().includes(q) && !(p.owner || '').toLowerCase().includes(q) && !(p.tags || []).some(t => t.toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }

  function portfolioTag(portfolioId) {
    if (typeof Portfolios === 'undefined') return '';
    const pf = Portfolios.getAll().find(x => x.id === portfolioId);
    if (!pf) return '';
    return `<span class="tag" style="margin:2px 0 8px; display:inline-flex; align-items:center; gap:5px;"><span class="row-color-dot" style="background:${Utils.colorHex(pf.color)}; margin:0;"></span>${Utils.escapeHtml(pf.name)}</span>`;
  }

  function taskCountFor(projectId) {
    const tasks = DataStore.getTasks().filter(t => t.projectId === projectId);
    return { total: tasks.length, done: tasks.filter(t => t.status === 'Completed').length };
  }

  function render(main, opts = {}) {
    const all = DataStore.getProjects();
    const departments = [...new Set(all.map(p => p.department).filter(Boolean))];
    const filtered = applyFilters(all);

    main.innerHTML = `
      <div class="view-header">
        <div>
          <div class="view-header__title">Projects</div>
          <div class="view-header__subtitle">${filtered.length} of ${all.filter(p => !p.archived).length} projects</div>
        </div>
        <div class="view-header__actions">
          <button class="btn-primary" id="newProjectBtn">+ New Project</button>
        </div>
      </div>

      <div class="toolbar">
        <input type="text" id="projSearch" placeholder="Search projects..." value="${Utils.escapeHtml(filters.query)}" style="min-width:200px;">
        <select id="projStatusFilter"><option value="">All statuses</option>${STATUSES.map(s => `<option ${filters.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <select id="projPriorityFilter"><option value="">All priorities</option>${PRIORITIES.map(s => `<option ${filters.priority === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <select id="projDeptFilter"><option value="">All departments</option>${departments.map(d => `<option ${filters.department === d ? 'selected' : ''}>${d}</option>`).join('')}</select>
        <button class="btn-ghost" id="projArchivedToggle">${filters.showArchived ? '📁 Show active' : '🗄 Show archived'}</button>
        <div class="view-toggle" style="margin-left:auto;">
          <button data-mode="cards" class="${viewMode === 'cards' ? 'is-active' : ''}">Cards</button>
          <button data-mode="table" class="${viewMode === 'table' ? 'is-active' : ''}">Table</button>
        </div>
      </div>

      <div id="projectsBody"></div>
    `;

    document.getElementById('newProjectBtn').addEventListener('click', () => openCreateModal());
    document.getElementById('projSearch').addEventListener('input', Utils.debounce((e) => { filters.query = e.target.value; render(main, opts); }, 200));
    document.getElementById('projStatusFilter').addEventListener('change', (e) => { filters.status = e.target.value; render(main, opts); });
    document.getElementById('projPriorityFilter').addEventListener('change', (e) => { filters.priority = e.target.value; render(main, opts); });
    document.getElementById('projDeptFilter').addEventListener('change', (e) => { filters.department = e.target.value; render(main, opts); });
    document.getElementById('projArchivedToggle').addEventListener('click', () => { filters.showArchived = !filters.showArchived; render(main, opts); });
    main.querySelectorAll('.view-toggle button').forEach(b => b.addEventListener('click', () => { viewMode = b.dataset.mode; render(main, opts); }));

    const body = document.getElementById('projectsBody');
    if (!filtered.length) {
      body.innerHTML = `<div class="card empty-state"><div class="empty-state__icon">🔍</div>No projects match your filters.</div>`;
      return;
    }
    if (viewMode === 'cards') renderCards(body, filtered, opts);
    else renderTable(body, filtered, opts);
  }

  function renderCards(body, projects, opts) {
    body.innerHTML = `<div class="project-grid">${projects.map(p => {
      const flag = flagFor(p);
      const counts = taskCountFor(p.id);
      return `<div class="card project-card" style="--card-color:${Utils.colorHex(p.color)}" data-id="${p.id}">
        <div class="project-card__top">
          <div>
            <div class="project-card__name">${Utils.escapeHtml(p.name)}</div>
            <span class="badge ${statusClass(p.status)}">${p.status}</span>
            <span class="badge ${priClass(p.priority)}">${p.priority}</span>
          </div>
          <button class="project-card__menu" data-menu="${p.id}">⋯</button>
        </div>
        <div class="project-card__desc">${Utils.escapeHtml(p.description || 'No description yet.')}</div>
        ${p.portfolioId ? portfolioTag(p.portfolioId) : ''}
        <div class="progress-bar" style="--card-color:${Utils.colorHex(p.color)}"><div class="progress-bar__fill" style="width:${p.progress}%"></div></div>
        <div class="project-card__meta">
          <span><span class="avatar">${Utils.initials(p.owner)}</span> ${Utils.escapeHtml(p.owner)}</span>
          ${flag ? `<span class="project-card__flag ${flag.cls}">${flag.label}</span>` : ''}
        </div>
        <div class="project-card__meta">
          <span class="text-faint">Due ${Utils.fmtDate(p.dueDate)}</span>
          <span class="text-faint">${counts.done}/${counts.total} tasks</span>
        </div>
      </div>`;
    }).join('')}</div>`;

    body.querySelectorAll('.project-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.project-card__menu')) return;
        openDetailModal(card.dataset.id);
      });
    });
    body.querySelectorAll('[data-menu]').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); openContextMenu(btn, btn.dataset.menu); });
    });

    if (opts.focusId) {
      const el = body.querySelector(`[data-id="${opts.focusId}"]`);
      if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); openDetailModal(opts.focusId); }
    }
  }

  function renderTable(body, projects, opts) {
    body.innerHTML = `<div class="table-scroll"><table class="data-table">
      <thead><tr><th>Project</th><th>Owner</th><th>Status</th><th>Progress</th><th>Due Date</th><th>Priority</th><th></th></tr></thead>
      <tbody>
        ${projects.map(p => `
          <tr class="is-clickable" data-id="${p.id}">
            <td><span class="row-color-dot" style="background:${Utils.colorHex(p.color)}"></span><strong>${Utils.escapeHtml(p.name)}</strong></td>
            <td>${Utils.escapeHtml(p.owner)}</td>
            <td><span class="badge ${statusClass(p.status)}">${p.status}</span></td>
            <td style="min-width:120px;"><div class="progress-bar" style="--card-color:${Utils.colorHex(p.color)}"><div class="progress-bar__fill" style="width:${p.progress}%"></div></div></td>
            <td>${Utils.fmtDate(p.dueDate)}</td>
            <td><span class="badge ${priClass(p.priority)}">${p.priority}</span></td>
            <td><button class="project-card__menu" data-menu="${p.id}">⋯</button></td>
          </tr>`).join('')}
      </tbody>
    </table></div>`;
    body.querySelectorAll('tr[data-id]').forEach(row => {
      row.addEventListener('click', (e) => { if (e.target.closest('[data-menu]')) return; openDetailModal(row.dataset.id); });
    });
    body.querySelectorAll('[data-menu]').forEach(btn => btn.addEventListener('click', (e) => { e.stopPropagation(); openContextMenu(btn, btn.dataset.menu); }));
  }

  function openContextMenu(anchor, id) {
    const project = DataStore.getProjects().find(p => p.id === id);
    if (!project) return;
    const rect = anchor.getBoundingClientRect();
    document.querySelectorAll('.ctx-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'ctx-menu card';
    menu.style.cssText = `position:fixed; top:${rect.bottom + 4}px; left:${rect.left - 120}px; z-index:150; padding:6px; min-width:150px;`;
    menu.innerHTML = `
      <div class="btn-ghost" data-act="edit" style="display:block; text-align:left; width:100%;">✏ Edit</div>
      <div class="btn-ghost" data-act="duplicate" style="display:block; text-align:left; width:100%;">⧉ Duplicate</div>
      <div class="btn-ghost" data-act="archive" style="display:block; text-align:left; width:100%;">${project.archived ? '📤 Unarchive' : '🗄 Archive'}</div>
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
    const projects = DataStore.getProjects();
    const project = projects.find(p => p.id === id);
    if (!project) return;
    if (act === 'edit') openEditModal(project);
    if (act === 'duplicate') {
      const copy = { ...project, id: Utils.uid('proj'), name: project.name + ' (Copy)', progress: 0, createdAt: Date.now() };
      DataStore.setProjects([...projects, copy]);
      Utils.toast(`Duplicated "${project.name}"`);
    }
    if (act === 'archive') {
      project.archived = !project.archived;
      DataStore.setProjects([...projects]);
      Utils.toast(project.archived ? 'Project archived' : 'Project restored');
    }
    if (act === 'delete') {
      App.deleteWithUndo({ label: project.name, kind: 'project', id: project.id });
    }
  }

  function formHtml(p) {
    const portfolios = (typeof Portfolios !== 'undefined' ? Portfolios.getAll() : []).filter(pf => !pf.archived);
    return `
      <div class="form-grid">
        <div class="form-field span-2"><label>Project Name</label><input type="text" id="f_name" value="${Utils.escapeHtml(p.name || '')}" placeholder="e.g. Fabric Migration"></div>
        <div class="form-field span-2"><label>Description</label><textarea id="f_desc" placeholder="What is this project about?">${Utils.escapeHtml(p.description || '')}</textarea></div>
        <div class="form-field"><label>Owner</label><select id="f_owner">${Utils.managerOptionsHtml(p.owner || '')}</select></div>
        <div class="form-field"><label>Department</label><input type="text" id="f_dept" value="${Utils.escapeHtml(p.department || '')}"></div>
        <div class="form-field"><label>Start Date</label><input type="date" id="f_start" value="${p.startDate || Utils.todayISO()}"></div>
        <div class="form-field"><label>Due Date</label><input type="date" id="f_due" value="${p.dueDate || Utils.todayISO()}"></div>
        <div class="form-field"><label>Priority</label><select id="f_priority">${PRIORITIES.map(x => `<option ${p.priority === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
        <div class="form-field"><label>Status</label><select id="f_status">${STATUSES.map(x => `<option ${p.status === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
        <div class="form-field"><label>Portfolio</label><select id="f_portfolio"><option value="">No portfolio</option>${portfolios.map(pf => `<option value="${pf.id}" ${p.portfolioId === pf.id ? 'selected' : ''}>${Utils.escapeHtml(pf.name)}</option>`).join('')}</select></div>
        <div class="form-field"><label>Tags (comma separated)</label><input type="text" id="f_tags" value="${Utils.escapeHtml((p.tags || []).join(', '))}"></div>
        <div class="form-field"><label>Budget ($, optional)</label><input type="number" id="f_budget" min="0" step="1000" value="${p.budget ?? ''}" placeholder="e.g. 150000"></div>
        <div class="form-field"><label>Actual Cost ($, optional)</label><input type="number" id="f_actualCost" min="0" step="1000" value="${p.actualCost ?? ''}" placeholder="e.g. 82000"></div>
        <div class="form-field span-2"><label>Color</label><div class="color-picker" id="f_colorPicker">${Utils.colorPickerHtml(p.color || 'indigo')}</div></div>
      </div>
    `;
  }

  function readForm(root) {
    const budgetRaw = root.querySelector('#f_budget').value;
    const actualRaw = root.querySelector('#f_actualCost').value;
    return {
      name: root.querySelector('#f_name').value.trim() || 'Untitled Project',
      description: root.querySelector('#f_desc').value.trim(),
      owner: root.querySelector('#f_owner').value,
      department: root.querySelector('#f_dept').value.trim(),
      startDate: root.querySelector('#f_start').value,
      dueDate: root.querySelector('#f_due').value,
      priority: root.querySelector('#f_priority').value,
      status: root.querySelector('#f_status').value,
      portfolioId: root.querySelector('#f_portfolio').value || null,
      tags: root.querySelector('#f_tags').value.split(',').map(t => t.trim()).filter(Boolean),
      budget: budgetRaw ? Math.max(0, parseFloat(budgetRaw)) : null,
      actualCost: actualRaw ? Math.max(0, parseFloat(actualRaw)) : null
    };
  }

  function openCreateModal() {
    const draft = { status: 'Not Started', priority: 'Medium', color: 'indigo' };
    let getColor;
    App.navigate('projects');
    Utils.openModal({
      title: 'New Project',
      bodyHtml: formHtml(draft),
      footerHtml: `<button class="btn-secondary" data-close>Cancel</button><button class="btn-primary" id="saveProjectBtn">Create Project</button>`,
      onMount: (root, close) => {
        getColor = Utils.bindColorPicker(root);
        root.querySelector('[data-close]').addEventListener('click', close);
        root.querySelector('#saveProjectBtn').addEventListener('click', () => {
          const data = readForm(root);
          const project = { id: Utils.uid('proj'), ...data, progress: 0, color: getColor(), archived: false, createdAt: Date.now() };
          DataStore.setProjects([...DataStore.getProjects(), project]);
          Utils.toast(`Created "${project.name}"`);
          close();
        });
      }
    });
  }

  function openEditModal(project) {
    let getColor;
    Utils.openModal({
      title: 'Edit Project',
      bodyHtml: formHtml(project),
      footerHtml: `<button class="btn-secondary" data-close>Cancel</button><button class="btn-primary" id="saveProjectBtn">Save Changes</button>`,
      onMount: (root, close) => {
        getColor = Utils.bindColorPicker(root);
        root.querySelector('[data-close]').addEventListener('click', close);
        root.querySelector('#saveProjectBtn').addEventListener('click', () => {
          const data = readForm(root);
          const projects = DataStore.getProjects();
          const idx = projects.findIndex(p => p.id === project.id);
          projects[idx] = { ...project, ...data, color: getColor() };
          DataStore.setProjects([...projects]);
          Utils.toast('Project updated');
          close();
        });
      }
    });
  }

  function openDetailModal(id) {
    const project = DataStore.getProjects().find(p => p.id === id);
    if (!project) return;
    const tasks = DataStore.getTasks().filter(t => t.projectId === id);
    const flag = flagFor(project);
    Utils.openModal({
      title: project.name,
      wide: true,
      bodyHtml: `
        <div class="tab-bar">
          <button class="tab-btn is-active" data-tab="overview">Overview</button>
          <button class="tab-btn" data-tab="charter">Charter${project.charter && project.charter.trim() ? ' 📜' : ''}</button>
        </div>
        <div data-tab-panel="overview">
          <div class="flex gap-8" style="margin-bottom: 14px; flex-wrap:wrap;">
            <span class="badge ${statusClass(project.status)}">${project.status}</span>
            <span class="badge ${priClass(project.priority)}">${project.priority}</span>
            ${flag ? `<span class="project-card__flag ${flag.cls}">${flag.label}</span>` : ''}
            ${(project.tags || []).map(t => `<span class="tag">${Utils.escapeHtml(t)}</span>`).join('')}
          </div>
          <p class="text-soft">${Utils.escapeHtml(project.description || 'No description yet.')}</p>
          <div class="form-grid" style="margin: 16px 0;">
            <div><div class="text-faint" style="font-size:11px;">OWNER</div><div>${Utils.escapeHtml(project.owner)}</div></div>
            <div><div class="text-faint" style="font-size:11px;">DEPARTMENT</div><div>${Utils.escapeHtml(project.department || '—')}</div></div>
            <div><div class="text-faint" style="font-size:11px;">START DATE</div><div>${Utils.fmtDate(project.startDate)}</div></div>
            <div><div class="text-faint" style="font-size:11px;">DUE DATE</div><div>${Utils.fmtDate(project.dueDate)}</div></div>
            <div><div class="text-faint" style="font-size:11px;">PORTFOLIO</div><div>${project.portfolioId ? portfolioTag(project.portfolioId) : '<span class="text-faint">—</span>'}</div></div>
            ${project.budget ? `<div><div class="text-faint" style="font-size:11px;">BUDGET</div><div>$${Number(project.actualCost || 0).toLocaleString()} / $${Number(project.budget).toLocaleString()}</div></div>` : ''}
          </div>
          <div class="progress-bar" style="--card-color:${Utils.colorHex(project.color)}"><div class="progress-bar__fill" style="width:${project.progress}%"></div></div>
          <div class="panel__title" style="margin-top:20px;">Tasks (${tasks.length})</div>
          ${tasks.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>Task</th><th>Assignee</th><th>Status</th><th>Due</th></tr></thead>
            <tbody>${tasks.slice(0, 8).map(t => `<tr><td>${Utils.escapeHtml(t.name)}</td><td>${Utils.escapeHtml(t.assignedTo)}</td><td><span class="badge ${statusClass(t.status)}">${t.status}</span></td><td>${Utils.fmtDate(t.dueDate)}</td></tr>`).join('')}</tbody>
          </table></div>` : `<div class="text-faint">No tasks yet for this project.</div>`}
          <div id="milestonesSection"></div>
        </div>
        <div data-tab-panel="charter" style="display:none;">
          <div id="charterHost"></div>
        </div>
      `,
      footerHtml: `
        <button class="btn-secondary" id="viewTasksBtn">View All Tasks</button>
        <button class="btn-secondary" id="editProjBtn">✏ Edit</button>
        <button class="btn-danger" id="delProjBtn">Delete</button>
      `,
      onMount: (root, close) => {
        root.querySelector('#editProjBtn').addEventListener('click', () => { close(); openEditModal(project); });
        root.querySelector('#delProjBtn').addEventListener('click', () => { close(); App.deleteWithUndo({ label: project.name, kind: 'project', id: project.id }); });
        root.querySelector('#viewTasksBtn').addEventListener('click', () => { close(); Tasks.filterByProject(project.id); });
        if (typeof Milestones !== 'undefined') Milestones.renderForProject(root.querySelector('#milestonesSection'), project.id);

        root.querySelectorAll('.tab-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            root.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('is-active'));
            btn.classList.add('is-active');
            root.querySelectorAll('[data-tab-panel]').forEach(p => {
              p.style.display = p.dataset.tabPanel === btn.dataset.tab ? '' : 'none';
            });
          });
        });
        renderCharterTab(root.querySelector('#charterHost'), project);
      }
    });
  }

  // ---------------- charter tab ----------------
  const CHARTER_PLACEHOLDER = [
    'Objective:', '', 'Success Criteria:', '', 'Scope (in / out):', '', 'Sponsor:', '', 'Key Risks:', ''
  ].join('\n');

  function renderCharterTab(host, project) {
    if (!host) return;
    const hasCharter = !!(project.charter && project.charter.trim());
    host.innerHTML = hasCharter ? `
      <div class="flex" style="justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
        <div class="panel__title mb-0">Project Charter</div>
        <button class="btn-secondary btn-sm" id="editCharterBtn">✏ Edit</button>
      </div>
      <div class="charter-body">${Utils.escapeHtml(project.charter)}</div>
    ` : `
      <div class="empty-state">
        <div class="empty-state__icon">📜</div>
        <div>No charter yet for this project.</div>
        <div class="text-faint" style="font-size:12px; margin: 6px 0 14px;">Capture why this project exists — objective, success criteria, scope, sponsor, key risks.</div>
        <button class="btn-primary btn-sm" id="editCharterBtn">+ Add Charter</button>
      </div>
    `;
    host.querySelector('#editCharterBtn').addEventListener('click', () => renderCharterEditor(host, project));
  }

  function renderCharterEditor(host, project) {
    host.innerHTML = `
      <div class="panel__title" style="margin-bottom:4px;">Project Charter</div>
      <div class="text-faint" style="font-size:11.5px; margin-bottom:8px;">Free-form — write it however works for your team. No fixed structure required.</div>
      <textarea id="charterText" class="charter-textarea" placeholder="${Utils.escapeHtml(CHARTER_PLACEHOLDER)}">${Utils.escapeHtml(project.charter || '')}</textarea>
      <div class="flex gap-8" style="justify-content:flex-end; margin-top:12px;">
        <button class="btn-secondary btn-sm" id="cancelCharterBtn">Cancel</button>
        <button class="btn-primary btn-sm" id="saveCharterBtn">Save Charter</button>
      </div>
    `;
    host.querySelector('#cancelCharterBtn').addEventListener('click', () => renderCharterTab(host, project));
    host.querySelector('#saveCharterBtn').addEventListener('click', () => {
      const text = host.querySelector('#charterText').value.trim();
      const all = DataStore.getProjects();
      const idx = all.findIndex(p => p.id === project.id);
      if (idx === -1) return;
      all[idx] = { ...all[idx], charter: text };
      DataStore.setProjects([...all]);
      project.charter = text;
      const tabBtn = document.querySelector('.tab-btn[data-tab="charter"]');
      if (tabBtn) tabBtn.textContent = `Charter${text ? ' 📜' : ''}`;
      Utils.toast('Charter saved');
      renderCharterTab(host, project);
    });
  }

  return { render, openCreateModal, openEditModal, openDetailModal };
})();
