/* ============================================================
   WORKSPACE.JS
   Project Workspace — the header + section navigation shown when
   a project is selected (replaces the old detail modal). Reuses
   existing modules for every section wherever possible; only
   Docs and Status Reports are new lightweight panels.
   ============================================================ */

const Workspace = (() => {
  const SECTIONS = [
    { key: 'planning', label: 'Planning', icon: '🗓' },
    { key: 'details', label: 'Details', icon: '📋' },
    { key: 'resources', label: 'Resources', icon: '👥' },
    { key: 'financials', label: 'Financials', icon: '💰' },
    { key: 'ridac', label: 'RIDAC', icon: '🛡' },
    { key: 'analytics', label: 'Analytics', icon: '📊' },
    { key: 'docs', label: 'Docs', icon: '📁' },
    { key: 'statusreports', label: 'Status Reports', icon: '📨' }
  ];

  let planningSubView = 'tasks'; // 'tasks' | 'timeline'

  function statusClass(s) { return 'badge--status-' + (s || '').toLowerCase().replace(/\s+/g, ''); }
  function priClass(p) { return 'badge--pri-' + (p || '').toLowerCase(); }

  // Public entry point — every "select a project" interaction in the app
  // (Projects list, Dashboard hero, global search, notifications) should
  // call this instead of opening the old modal.
  function open(projectId, section) {
    App.navigate('workspace', { projectId, section: section || 'details' });
  }

  function render(main, opts = {}) {
    const project = DataStore.getProjects().find(p => p.id === opts.projectId);
    if (!project) {
      main.innerHTML = `
        <div class="card empty-state">
          <div class="empty-state__icon">📁</div>
          <div>This project could not be found — it may have been deleted.</div>
          <button class="btn-primary" id="wsBackToProjects" style="margin-top:14px;">← Back to Projects</button>
        </div>`;
      document.getElementById('wsBackToProjects').addEventListener('click', () => App.navigate('projects'));
      const title = document.getElementById('topbarTitle');
      if (title) title.textContent = 'Project Workspace';
      return;
    }

    const section = SECTIONS.find(s => s.key === opts.section) ? opts.section : 'details';
    const title = document.getElementById('topbarTitle');
    if (title) title.textContent = project.name;

    main.innerHTML = `
      <div class="card workspace-header">
        <button class="btn-ghost btn-sm workspace-header__back" id="wsBackBtn">← Back to Projects</button>
        <div class="flex" style="justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:14px;">
          <div>
            <div class="workspace-header__name">${Utils.escapeHtml(project.name)}</div>
            <div class="flex gap-8" style="margin-top:8px; flex-wrap:wrap;">
              <span class="badge ${statusClass(project.status)}">${project.status}</span>
              <span class="badge ${priClass(project.priority)}">${project.priority}</span>
              ${(project.tags || []).slice(0, 4).map(t => `<span class="tag">${Utils.escapeHtml(t)}</span>`).join('')}
            </div>
          </div>
          <div class="flex gap-8">
            <button class="btn-secondary btn-sm" id="wsQuickEditBtn">✏ Edit</button>
          </div>
        </div>
        <div class="workspace-header__meta">
          <div class="workspace-header__meta-item">Owner<strong><span class="avatar" style="width:20px;height:20px;font-size:9px;vertical-align:middle;margin-right:5px;">${Utils.initials(project.owner)}</span>${Utils.escapeHtml(project.owner || 'Unassigned')}</strong></div>
          <div class="workspace-header__meta-item">Progress<strong style="min-width:140px;">${project.progress}%<div class="progress-bar" style="--card-color:${Utils.colorHex(project.color)}"><div class="progress-bar__fill" style="width:${project.progress}%"></div></div></strong></div>
          <div class="workspace-header__meta-item">Due Date<strong>${Utils.fmtDate(project.dueDate)}</strong></div>
        </div>
      </div>

      <div class="workspace-nav" id="workspaceNav">
        ${SECTIONS.map(s => `<button class="workspace-nav__item ${s.key === section ? 'is-active' : ''}" data-section="${s.key}">${s.icon} ${s.label}</button>`).join('')}
      </div>

      <div id="workspaceSectionHost"></div>
    `;

    document.getElementById('wsBackBtn').addEventListener('click', () => App.navigate('projects'));
    document.getElementById('wsQuickEditBtn').addEventListener('click', () => Projects.openEditModal(project));
    document.querySelectorAll('.workspace-nav__item').forEach(btn => {
      btn.addEventListener('click', () => open(project.id, btn.dataset.section));
    });

    renderSection(document.getElementById('workspaceSectionHost'), project, section);
  }

  function renderSection(host, project, section) {
    switch (section) {
      case 'planning': renderPlanning(host, project); break;
      case 'details': Projects.renderDetailsPanel(host, project); break;
      case 'resources': Workforce.renderProjectResources(host, project.id); break;
      case 'financials': renderFinancials(host, project); break;
      case 'ridac': Ridac.render(host, project.id); break;
      case 'analytics': Dashboard.renderProjectView(host, project, DataStore.getProjects()); break;
      case 'docs': renderDocsPlaceholder(host, project); break;
      case 'statusreports': renderStatusReports(host, project); break;
    }
  }

  // ---------------- Planning: existing Tasks + Gantt, scoped to this project ----------------
  function renderPlanning(host, project) {
    host.innerHTML = `
      <div class="tab-bar">
        <button class="tab-btn ${planningSubView === 'tasks' ? 'is-active' : ''}" data-sub="tasks">Tasks</button>
        <button class="tab-btn ${planningSubView === 'timeline' ? 'is-active' : ''}" data-sub="timeline">Timeline</button>
      </div>
      <div id="planningSubHost"></div>
    `;
    host.querySelectorAll('[data-sub]').forEach(btn => {
      btn.addEventListener('click', () => { planningSubView = btn.dataset.sub; renderPlanning(host, project); });
    });
    const subHost = host.querySelector('#planningSubHost');
    if (planningSubView === 'tasks') {
      Tasks.setProjectFilter(project.id);
      Tasks.render(subHost);
    } else {
      Gantt.setProjectFilter(project.id);
      Gantt.render(subHost);
    }
  }

  // ---------------- Financials: existing budget/actual info, surfaced on its own ----------------
  function renderFinancials(host, project) {
    const hasBudget = !!project.budget;
    const actual = project.actualCost || 0;
    host.innerHTML = `
      <div class="dash-grid">
        <div class="card panel">
          <div class="panel__title">Budget vs Actual</div>
          ${typeof Dashboard !== 'undefined' ? Dashboard.budgetBarHtml(project) : ''}
        </div>
        <div class="card panel">
          <div class="panel__title">Figures</div>
          <div style="font-size:13px; line-height:2;">
            <div><strong>Budget:</strong> ${hasBudget ? '$' + Number(project.budget).toLocaleString() : '<span class="text-faint">Not set</span>'}</div>
            <div><strong>Actual Cost:</strong> ${actual ? '$' + actual.toLocaleString() : '<span class="text-faint">$0</span>'}</div>
            <div><strong>Remaining:</strong> ${hasBudget ? '$' + Math.max(0, project.budget - actual).toLocaleString() : '<span class="text-faint">—</span>'}</div>
          </div>
          <button class="btn-secondary btn-sm" id="finEditBtn" style="margin-top:10px;">✏ Edit Budget</button>
        </div>
      </div>
    `;
    const btn = host.querySelector('#finEditBtn');
    if (btn) btn.addEventListener('click', () => Projects.openEditModal(project));
  }

  // ---------------- Docs: clean placeholder module structure ----------------
  function renderDocsPlaceholder(host) {
    host.innerHTML = `
      <div class="card empty-state">
        <div class="empty-state__icon">📁</div>
        <div>Docs isn't built out yet for this project.</div>
        <div class="text-faint" style="font-size:12px; margin-top:6px;">This tab is reserved for project documents, links, and file attachments.</div>
      </div>
    `;
  }

  // ---------------- Status Reports: recent activity for this project + email export ----------------
  function renderStatusReports(host, project) {
    const entries = DataStore.getAuditLog().filter(e => e.contextProjectId === project.id).slice(0, 12);
    host.innerHTML = `
      <div class="card panel" id="statusReportHost">
        <div class="flex" style="justify-content:space-between; align-items:center; margin-bottom:4px;">
          <div class="panel__title mb-0">Status Snapshot</div>
          <button class="btn-secondary btn-sm" id="statusEmailBtn">📧 Email Status Report</button>
        </div>
        <div class="form-grid" style="margin:16px 0;">
          <div><div class="text-faint" style="font-size:11px;">STATUS</div><div><span class="badge ${statusClass(project.status)}">${project.status}</span></div></div>
          <div><div class="text-faint" style="font-size:11px;">PROGRESS</div><div>${project.progress}%</div></div>
          <div><div class="text-faint" style="font-size:11px;">DUE DATE</div><div>${Utils.fmtDate(project.dueDate)}</div></div>
          <div><div class="text-faint" style="font-size:11px;">OPEN RIDAC ITEMS</div><div>${typeof Ridac !== 'undefined' ? Ridac.forProject(project.id).filter(r => !Ridac.isClosed(r)).length : 0}</div></div>
        </div>
        <div class="panel__title" style="margin-top:8px;">Recent Activity</div>
        ${entries.length ? entries.map(e => `
          <div style="padding:8px 0; border-bottom:1px solid var(--border-soft); font-size:12.5px;">
            <strong>${Utils.escapeHtml(e.entityName)}</strong> — ${e.action === 'created' ? 'Created' : e.action === 'deleted' ? 'Deleted' : 'Updated'} <span class="text-faint">· ${new Date(e.timestamp).toLocaleDateString()}</span>
          </div>
        `).join('') : `<div class="text-faint" style="font-size:12.5px;">No recorded activity yet.</div>`}
      </div>
    `;
    const btn = host.querySelector('#statusEmailBtn');
    if (btn && typeof EmailExport !== 'undefined') {
      btn.addEventListener('click', () => EmailExport.openModal(() => document.getElementById('statusReportHost'), `${project.name} — Status Report`));
    } else if (btn) {
      btn.disabled = true;
    }
  }

  return { open, render };
})();
