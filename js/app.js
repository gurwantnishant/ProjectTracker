/* ============================================================
   APP.JS - shell, routing, topbar behaviors, init
   ============================================================ */

const App = (() => {
  const VIEWS = [
    { key: 'dashboard', label: 'Dashboard', icon: '🏠' },
    { key: 'portfolios', label: 'Portfolios', icon: '🗂' },
    { key: 'projects', label: 'Projects', icon: '📁' },
    { key: 'tasks', label: 'Tasks', icon: '📋' },
    { key: 'gantt', label: 'Timeline', icon: '📅' },
    { key: 'workforce', label: 'Workforce', icon: '👥' },
    { key: 'activity', label: 'Activity', icon: '🕓' },
    { key: 'settings', label: 'Settings', icon: '⚙' }
  ];

  const state = {
    view: 'dashboard',
    searchQuery: ''
  };

  let undoStack = []; // {label, restore}

  function currentView() { return state.view; }

  function navigate(view, opts = {}) {
    state.view = view;
    if (opts.focusId) state.focusId = opts.focusId; else state.focusId = null;
    state.workforceProjectId = opts.projectId || null;
    if (view === 'workspace') {
      state.workspaceProjectId = opts.projectId || state.workspaceProjectId;
      state.workspaceSection = opts.section || state.workspaceSection || 'details';
      if (state.workspaceProjectId) {
        const hash = `#project/${state.workspaceProjectId}/${state.workspaceSection}`;
        if (location.hash !== hash) history.pushState(null, '', hash);
      }
    } else if (location.hash) {
      history.pushState(null, '', location.pathname + location.search);
    }
    // Projects stays visually highlighted while browsing a project's workspace.
    const highlightView = view === 'workspace' ? 'projects' : view;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('is-active', n.dataset.view === highlightView));
    renderMain();
    if (window.innerWidth <= 860) document.querySelector('.app-shell').classList.remove('mobile-nav-open');
  }

  function refreshTopbarProjectSelect() {
    const sel = document.getElementById('topbarProjectSelect');
    if (!sel) return;
    const projects = DataStore.getProjects().filter(p => !p.archived).sort((a, b) => a.name.localeCompare(b.name));
    const current = Dashboard.getSelectedProjectId();
    sel.innerHTML = `<option value="all">📊 All Projects</option>` +
      projects.map(p => `<option value="${p.id}">${Utils.escapeHtml(p.name)}</option>`).join('');
    sel.value = projects.find(p => p.id === current) ? current : 'all';
  }

  function renderMain() {
    const main = document.getElementById('mainContent');
    const title = VIEWS.find(v => v.key === state.view)?.label || '';
    document.getElementById('topbarTitle').textContent = title;
    main.innerHTML = '';
    switch (state.view) {
      case 'dashboard': Dashboard.render(main); break;
      case 'portfolios': Portfolios.render(main, { focusId: state.focusId }); break;
      case 'projects': Projects.render(main, { focusId: state.focusId }); break;
      case 'tasks': Tasks.render(main, { focusId: state.focusId }); break;
      case 'gantt': Gantt.render(main); break;
      case 'workforce': Workforce.render(main, { projectId: state.workforceProjectId }); break;
      case 'activity': AuditLog.render(main); break;
      case 'settings': renderSettings(main); break;
      case 'workspace': Workspace.render(main, { projectId: state.workspaceProjectId, section: state.workspaceSection }); break;
    }
    refreshTopbarProjectSelect();
  }

  function renderSettings(main) {
    const mode = DataStore.mode;
    const dark = DataStore.getSetting('darkMode', false);
    main.innerHTML = `
      <div class="view-header">
        <div>
          <div class="view-header__title">Settings</div>
          <div class="view-header__subtitle">Workspace preferences and data</div>
        </div>
      </div>
      <div class="dash-grid">
        <div class="card panel">
          <div class="panel__title">Appearance</div>
          <div class="flex gap-8" style="justify-content: space-between; padding: 6px 0;">
            <div>
              <div style="font-weight:600;">Dark mode</div>
              <div class="text-soft" style="font-size:12px;">Easier on the eyes for late-night planning.</div>
            </div>
            <label class="switch">
              <input type="checkbox" id="darkModeToggle" ${dark ? 'checked' : ''}>
            </label>
          </div>
        </div>
        <div class="card panel">
          <div class="panel__title">Data & storage</div>
          <div style="font-size: 13px; line-height: 1.8;">
            <div><strong>Backend:</strong> ${mode === 'firestore' ? '🔥 Firestore (synced)' : '💾 LocalStorage (this browser only)'}</div>
            <div class="text-soft" style="margin-top: 6px;">
              ${mode === 'firestore'
                ? 'Your data is stored in Firestore and available from any device that opens this app.'
                : 'To sync across devices, add your Firebase project config to <code>js/firebase-config.js</code> and reload.'}
            </div>
          </div>
        </div>
        <div class="card panel">
          <div class="panel__title">Export</div>
          <button class="btn-secondary" id="exportBtn">⬇ Export to CSV</button>
        </div>
        <div class="card panel">
          <div class="panel__title">Import</div>
          <input type="file" id="importFile" accept=".csv" style="font-size:12px;">
          <div class="text-soft" style="font-size: 12px; margin-top: 8px;">Import projects from a CSV with columns: name, description, owner, startDate, dueDate, priority, status, progress, department.</div>
        </div>
        <div class="card panel">
          <div class="panel__title">Keyboard shortcuts</div>
          <div style="font-size: 12.5px; line-height: 2;">
            <div><kbd>N</kbd> New project/task depending on view</div>
            <div><kbd>/</kbd> Focus search</div>
            <div><kbd>G</kbd> then <kbd>D</kbd>/<kbd>O</kbd>/<kbd>P</kbd>/<kbd>T</kbd>/<kbd>C</kbd> Go to Dashboard/Portfolios/Projects/Tasks/Calendar</div>
            <div><kbd>Esc</kbd> Close modal</div>
          </div>
        </div>
        <div class="card panel">
          <div class="panel__title">Demo data</div>
          <div class="text-soft" style="font-size:12px; margin-bottom: 10px;">Loads sample projects, tasks, portfolios, milestones and a starter RIDAC register so you can explore the app. Only runs when you click it.</div>
          <button class="btn-secondary" id="loadDemoDataBtn">Load demo data</button>
        </div>
        <div class="card panel">
          <div class="panel__title">Clear all data</div>
          <div class="text-soft" style="font-size:12px; margin-bottom: 10px;">Permanently deletes all projects, tasks, portfolios, milestones and RIDAC items from your database. This does not add anything back.</div>
          <button class="btn-danger" id="clearDataBtn">Clear all data</button>
        </div>
      </div>
    `;
    document.getElementById('darkModeToggle').addEventListener('change', (e) => setDarkMode(e.target.checked));
    document.getElementById('exportBtn').addEventListener('click', exportCSV);
    document.getElementById('importFile').addEventListener('change', importCSV);
    document.getElementById('loadDemoDataBtn').addEventListener('click', () => {
      if (!confirm('This will ADD sample projects, tasks, portfolios, milestones and a starter RIDAC register alongside any data you already have. Continue?')) return;
      const { projects, tasks, portfolios, milestones, ridac } = SampleData.generate();
      DataStore.setProjects([...DataStore.getProjects(), ...projects]);
      DataStore.setTasks([...DataStore.getTasks(), ...tasks]);
      DataStore.setPortfolios([...DataStore.getPortfolios(), ...portfolios]);
      DataStore.setMilestones([...DataStore.getMilestones(), ...milestones]);
      if (ridac && ridac.length) DataStore.setRidacs([...DataStore.getRidacs(), ...ridac]);
      Utils.toast('Demo data loaded');
    });
    document.getElementById('clearDataBtn').addEventListener('click', () => {
      if (!confirm('This will permanently delete ALL current projects, tasks, portfolios, and milestones. This cannot be undone. Continue?')) return;
      DataStore.setProjects([]);
      DataStore.setTasks([]);
      DataStore.setPortfolios([]);
      DataStore.setMilestones([]);
      DataStore.setRidacs([]);
      Utils.toast('All data cleared');
    });
  }

  function exportCSV() {
    const projects = DataStore.getProjects();
    const header = ['Project', 'Owner', 'Status', 'Priority', 'Progress', 'Start Date', 'Due Date', 'Department'];
    const rows = projects.map(p => [p.name, p.owner, p.status, p.priority, p.progress + '%', p.startDate, p.dueDate, p.department]);
    const csv = [header, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'projectly-projects.csv'; a.click();
    URL.revokeObjectURL(url);
    Utils.toast('Exported projects.csv');
  }

  function importCSV(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const lines = reader.result.split('\n').filter(Boolean);
      const [, ...dataLines] = lines;
      const projects = DataStore.getProjects();
      dataLines.forEach(line => {
        const cols = line.match(/(".*?"|[^,]+)/g)?.map(c => c.replace(/^"|"$/g, '').replace(/""/g, '"')) || [];
        if (!cols[0]) return;
        projects.push({
          id: Utils.uid('proj'), name: cols[0] || 'Untitled', owner: cols[1] || '', status: cols[2] || 'Not Started',
          priority: cols[3] || 'Medium', progress: parseInt(cols[4]) || 0, startDate: cols[5] || Utils.todayISO(),
          dueDate: cols[6] || Utils.todayISO(), department: cols[7] || '', description: '', tags: [], color: 'indigo', archived: false, createdAt: Date.now()
        });
      });
      DataStore.setProjects(projects);
      Utils.toast(`Imported ${dataLines.length} project(s)`);
    };
    reader.readAsText(file);
  }

  function setDarkMode(on) {
    document.documentElement.setAttribute('data-theme', on ? 'dark' : 'light');
    DataStore.setSetting('darkMode', on);
  }

  function deleteWithUndo({ label, kind, id }) {
    if (kind === 'project') {
      const projects = DataStore.getProjects();
      const idx = projects.findIndex(p => p.id === id);
      if (idx === -1) return;
      const removed = projects[idx];
      const remainingTasks = DataStore.getTasks();
      const removedTasks = remainingTasks.filter(t => t.projectId === id);
      const remainingRidacs = DataStore.getRidacs();
      const removedRidacs = remainingRidacs.filter(r => r.projectId === id);
      DataStore.setProjects(projects.filter(p => p.id !== id));
      DataStore.setTasks(remainingTasks.filter(t => t.projectId !== id));
      if (removedRidacs.length) DataStore.setRidacs(remainingRidacs.filter(r => r.projectId !== id));
      Utils.toast(`Deleted "${label}"`, {
        actionLabel: 'Undo', tone: 'default',
        onAction: () => {
          DataStore.setProjects([...DataStore.getProjects(), removed]);
          DataStore.setTasks([...DataStore.getTasks(), ...removedTasks]);
          if (removedRidacs.length) DataStore.setRidacs([...DataStore.getRidacs(), ...removedRidacs]);
        }
      });
    } else if (kind === 'task') {
      const tasks = DataStore.getTasks();
      const idx = tasks.findIndex(t => t.id === id);
      if (idx === -1) return;
      const removed = tasks[idx];
      DataStore.setTasks(tasks.filter(t => t.id !== id));
      Utils.toast(`Deleted "${label}"`, {
        actionLabel: 'Undo',
        onAction: () => DataStore.setTasks([...DataStore.getTasks(), removed])
      });
    } else if (kind === 'milestone') {
      const milestones = DataStore.getMilestones();
      const idx = milestones.findIndex(m => m.id === id);
      if (idx === -1) return;
      const removed = milestones[idx];
      DataStore.setMilestones(milestones.filter(m => m.id !== id));
      Utils.toast(`Deleted "${label}"`, {
        actionLabel: 'Undo',
        onAction: () => DataStore.setMilestones([...DataStore.getMilestones(), removed])
      });
    } else if (kind === 'portfolio') {
      const portfolios = DataStore.getPortfolios();
      const idx = portfolios.findIndex(p => p.id === id);
      if (idx === -1) return;
      const removed = portfolios[idx];
      const projects = DataStore.getProjects();
      const affectedIds = projects.filter(p => p.portfolioId === id).map(p => p.id);
      DataStore.setProjects(projects.map(p => (p.portfolioId === id ? { ...p, portfolioId: null } : p)));
      DataStore.setPortfolios(portfolios.filter(p => p.id !== id));
      Utils.toast(`Deleted "${label}"`, {
        actionLabel: 'Undo',
        onAction: () => {
          DataStore.setPortfolios([...DataStore.getPortfolios(), removed]);
          DataStore.setProjects(DataStore.getProjects().map(p => (affectedIds.includes(p.id) ? { ...p, portfolioId: id } : p)));
        }
      });
    } else if (kind === 'ridac') {
      const ridacs = DataStore.getRidacs();
      const idx = ridacs.findIndex(r => r.id === id);
      if (idx === -1) return;
      const removed = ridacs[idx];
      DataStore.setRidacs(ridacs.filter(r => r.id !== id));
      Utils.toast(`Deleted "${label}"`, {
        actionLabel: 'Undo',
        onAction: () => DataStore.setRidacs([...DataStore.getRidacs(), removed])
      });
    }
  }

  // ---------------- one-time migration: seed People from existing data ----------------
  async function seedMembersFromExistingData() {
    const ownerNames = new Set(
      [...DataStore.getProjects().map(p => p.owner), ...DataStore.getPortfolios().map(p => p.owner), ...DataStore.getMilestones().map(m => m.owner)]
        .map(n => (n || '').trim()).filter(Boolean)
    );
    const assigneeNames = new Set(
      DataStore.getTasks().map(t => (t.assignedTo || '').trim()).filter(Boolean)
    );
    const allNames = new Set([...ownerNames].concat([...assigneeNames]));
    const members = [...allNames].map(name => ({ id: Utils.uid('mem'), name, status: 'Active', createdAt: Date.now() }));
    if (members.length) await DataStore.setMembers(members);
  }

  // ---------------- global search ----------------
  function runGlobalSearch(q) {
    const box = document.getElementById('searchResults');
    if (!q) { box.style.display = 'none'; box.innerHTML = ''; return; }
    const lower = q.toLowerCase();
    const projects = DataStore.getProjects().filter(p =>
      p.name.toLowerCase().includes(lower) || (p.owner || '').toLowerCase().includes(lower) ||
      (p.status || '').toLowerCase().includes(lower) || (p.tags || []).some(t => t.toLowerCase().includes(lower))
    ).slice(0, 5);
    const tasks = DataStore.getTasks().filter(t =>
      t.name.toLowerCase().includes(lower) || (t.assignedTo || '').toLowerCase().includes(lower) ||
      (t.status || '').toLowerCase().includes(lower)
    ).slice(0, 6);
    const portfolios = DataStore.getPortfolios().filter(p =>
      !p.archived && (p.name.toLowerCase().includes(lower) || (p.owner || '').toLowerCase().includes(lower))
    ).slice(0, 4);

    if (!projects.length && !tasks.length && !portfolios.length) {
      box.innerHTML = `<div class="search-results__empty">No matches for "${Utils.escapeHtml(q)}"</div>`;
      box.style.display = 'block';
      return;
    }
    let html = '';
    if (portfolios.length) {
      html += `<div class="search-results__group-label">Portfolios</div>`;
      portfolios.forEach(p => {
        html += `<div class="search-results__item" data-type="portfolio" data-id="${p.id}">
          <span class="row-color-dot" style="background:${Utils.colorHex(p.color)}"></span>
          <div><div style="font-weight:600;">${Utils.escapeHtml(p.name)}</div><div class="text-faint" style="font-size:11px;">${Utils.escapeHtml(p.owner || 'Unowned')}</div></div>
        </div>`;
      });
    }
    if (projects.length) {
      html += `<div class="search-results__group-label">Projects</div>`;
      projects.forEach(p => {
        html += `<div class="search-results__item" data-type="project" data-id="${p.id}">
          <span class="row-color-dot" style="background:${Utils.colorHex(p.color)}"></span>
          <div><div style="font-weight:600;">${Utils.escapeHtml(p.name)}</div><div class="text-faint" style="font-size:11px;">${Utils.escapeHtml(p.owner)} · ${Utils.escapeHtml(p.status)}</div></div>
        </div>`;
      });
    }
    if (tasks.length) {
      html += `<div class="search-results__group-label">Tasks</div>`;
      tasks.forEach(t => {
        html += `<div class="search-results__item" data-type="task" data-id="${t.id}">
          <span>📋</span>
          <div><div style="font-weight:600;">${Utils.escapeHtml(t.name)}</div><div class="text-faint" style="font-size:11px;">${Utils.escapeHtml(t.assignedTo)} · ${Utils.escapeHtml(t.status)}</div></div>
        </div>`;
      });
    }
    box.innerHTML = html;
    box.style.display = 'block';
    box.querySelectorAll('.search-results__item').forEach(el => {
      el.addEventListener('click', () => {
        const { type, id } = el.dataset;
        document.getElementById('globalSearchInput').value = '';
        box.style.display = 'none';
        if (type === 'portfolio') navigate('portfolios', { focusId: id });
        else if (type === 'project') navigate('projects', { focusId: id });
        else navigate('tasks', { focusId: id });
      });
    });
  }

  // ---------------- init ----------------
  function buildSidebar() {
    const nav = document.getElementById('sidebarNav');
    nav.innerHTML = VIEWS.map(v => `<div class="nav-item" data-view="${v.key}"><span class="nav-item__icon">${v.icon}</span><span class="nav-item__label">${v.label}</span></div>`).join('');
    nav.querySelectorAll('.nav-item').forEach(el => el.addEventListener('click', () => navigate(el.dataset.view)));
  }

  function bindTopbar() {
    document.getElementById('sidebarCollapseBtn').addEventListener('click', () => {
      const shell = document.querySelector('.app-shell');
      shell.classList.toggle('sidebar-collapsed');
      DataStore.setSetting('sidebarCollapsed', shell.classList.contains('sidebar-collapsed'));
    });
    document.getElementById('mobileNavBtn').addEventListener('click', () => {
      document.querySelector('.app-shell').classList.toggle('mobile-nav-open');
    });
    const input = document.getElementById('globalSearchInput');
    input.addEventListener('input', Utils.debounce(() => runGlobalSearch(input.value.trim()), 120));
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-box')) document.getElementById('searchResults').style.display = 'none';
    });
    document.getElementById('notifBellBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      Notifications.togglePanel();
    });
    document.getElementById('topbarProjectSelect').addEventListener('change', (e) => {
      Dashboard.setSelectedProjectId(e.target.value);
      navigate('dashboard');
    });
  }

  function bindKeyboardShortcuts() {
    let pendingG = false;
    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
      if (e.key === 'Escape') {
        const root = document.getElementById('modalRoot');
        if (root.classList.contains('is-open')) { root.classList.remove('is-open'); root.innerHTML = ''; }
        return;
      }
      if (typing) return;
      if (pendingG) {
        pendingG = false;
        if (e.key.toLowerCase() === 'd') navigate('dashboard');
        if (e.key.toLowerCase() === 'p') navigate('projects');
        if (e.key.toLowerCase() === 'o') navigate('portfolios');
        if (e.key.toLowerCase() === 't') navigate('tasks');
        if (e.key.toLowerCase() === 'c') navigate('gantt');
        return;
      }
      if (e.key.toLowerCase() === 'g') { pendingG = true; setTimeout(() => pendingG = false, 800); return; }
      if (e.key === '/') { e.preventDefault(); document.getElementById('globalSearchInput').focus(); return; }
      if (e.key.toLowerCase() === 'n') {
        if (state.view === 'projects') Projects.openCreateModal();
        else if (state.view === 'tasks') Tasks.openCreateModal();
        else if (state.view === 'portfolios') Portfolios.openCreateModal();
      }
    });
  }

  // Lightweight hash routing for the Project Workspace, e.g. #project/<id>/ridac.
  // No router dependency — just a manual parse/listen pair.
  function parseWorkspaceHash() {
    const m = location.hash.match(/^#project\/([^/]+)\/([^/]+)$/);
    return m ? { projectId: m[1], section: m[2] } : null;
  }

  function bindHashRouting() {
    window.addEventListener('hashchange', () => {
      const route = parseWorkspaceHash();
      if (route && DataStore.getProjects().some(p => p.id === route.projectId)) {
        navigate('workspace', route);
      } else if (!route && state.view === 'workspace') {
        navigate('projects');
      }
    });
    window.addEventListener('popstate', () => {
      const route = parseWorkspaceHash();
      if (route && DataStore.getProjects().some(p => p.id === route.projectId)) navigate('workspace', route);
      else if (!route && state.view === 'workspace') navigate('projects');
    });
  }

  async function init() {
    await DataStore.ready;
    // NOTE: sample/demo data is no longer auto-seeded here. An empty
    // Firestore/LocalStorage store now stays empty — real data only gets
    // saved when the user actually creates it. Demo data can still be
    // loaded on purpose from Settings > "Load demo data".
    if (!DataStore.getMembers().length) {
      await seedMembersFromExistingData();
    }
    setDarkMode(DataStore.getSetting('darkMode', false));
    if (DataStore.getSetting('sidebarCollapsed', false)) document.querySelector('.app-shell').classList.add('sidebar-collapsed');
    buildSidebar();
    bindTopbar();
    bindKeyboardShortcuts();
    bindHashRouting();
    Notifications.init();
    const initialRoute = parseWorkspaceHash();
    if (initialRoute && DataStore.getProjects().some(p => p.id === initialRoute.projectId)) navigate('workspace', initialRoute);
    else navigate('dashboard');
    DataStore.onChange((kind) => {
      if (['projects', 'tasks', 'portfolios', 'milestones', 'members', 'roles', 'skills', 'allocations', 'leaveRecords', 'holidays', 'ridac'].includes(kind)) {
        Notifications.recompute();
        renderMain();
      }
    });
  }

  return { navigate, currentView, deleteWithUndo, init, state };
})();

document.addEventListener('DOMContentLoaded', App.init);
