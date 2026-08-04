/* ============================================================
   TASKS.JS
   ============================================================ */

const Tasks = (() => {
  let viewMode = 'grid'; // 'grid' | 'kanban' | 'list'
  let filters = { status: '', priority: '', project: '', assignee: '', query: '' };
  let selected = new Set();

  const STATUSES = ['Not Started', 'In Progress', 'Blocked', 'Testing', 'Completed'];
  const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
  const KANBAN_COLUMNS = ['Not Started', 'In Progress', 'Blocked', 'Testing', 'Completed'];

  function statusClass(s) { return 'badge--status-' + s.toLowerCase().replace(/\s+/g, ''); }
  function priClass(p) { return 'badge--pri-' + p.toLowerCase(); }
  function projectOf(t) { return DataStore.getProjects().find(p => p.id === t.projectId); }

  function filterByProject(projectId) {
    filters.project = projectId;
    App.navigate('tasks');
  }

  function applyFilters(tasks) {
    return tasks.filter(t => {
      if (filters.status && t.status !== filters.status) return false;
      if (filters.priority && t.priority !== filters.priority) return false;
      if (filters.project && t.projectId !== filters.project) return false;
      if (filters.assignee && t.assignedTo !== filters.assignee) return false;
      if (filters.query) {
        const q = filters.query.toLowerCase();
        if (!t.name.toLowerCase().includes(q) && !(t.assignedTo || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }

  function dependencyWarning(t) {
    if (!t.dependency) return null;
    const dep = DataStore.getTasks().find(x => x.id === t.dependency.taskId);
    if (!dep) return null;
    if (t.dependency.type === 'FS' && dep.status !== 'Completed' && t.status !== 'Not Started') {
      return `Blocked by "${dep.name}" (must finish first)`;
    }
    return null;
  }

  function render(main, opts = {}) {
    const all = DataStore.getTasks();
    const projects = DataStore.getProjects();
    const assignees = [...new Set(all.map(t => t.assignedTo).filter(Boolean))];
    const filtered = applyFilters(all);
    selected.clear();

    main.innerHTML = `
      <div class="view-header">
        <div>
          <div class="view-header__title">Tasks</div>
          <div class="view-header__subtitle">${filtered.length} of ${all.length} tasks</div>
        </div>
        <div class="view-header__actions">
          <button class="btn-primary" id="newTaskBtn">+ New Task</button>
        </div>
      </div>

      <div class="toolbar">
        <input type="text" id="taskSearch" placeholder="Search tasks..." value="${Utils.escapeHtml(filters.query)}" style="min-width:180px;">
        <select id="taskProjectFilter"><option value="">All projects</option>${projects.map(p => `<option value="${p.id}" ${filters.project === p.id ? 'selected' : ''}>${Utils.escapeHtml(p.name)}</option>`).join('')}</select>
        <select id="taskStatusFilter"><option value="">All statuses</option>${STATUSES.map(s => `<option ${filters.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <select id="taskPriorityFilter"><option value="">All priorities</option>${PRIORITIES.map(s => `<option ${filters.priority === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <select id="taskAssigneeFilter"><option value="">Everyone</option>${assignees.map(a => `<option ${filters.assignee === a ? 'selected' : ''}>${Utils.escapeHtml(a)}</option>`).join('')}</select>
        <div class="view-toggle" style="margin-left:auto;">
          <button data-mode="grid" class="${viewMode === 'grid' ? 'is-active' : ''}">Grid</button>
          <button data-mode="kanban" class="${viewMode === 'kanban' ? 'is-active' : ''}">Kanban</button>
          <button data-mode="list" class="${viewMode === 'list' ? 'is-active' : ''}">List</button>
        </div>
      </div>

      <div id="bulkBar" class="toolbar" style="display:none; background:var(--primary-soft); padding:10px 14px; border-radius: var(--radius-sm);">
        <span id="bulkCount" style="font-weight:700; font-size:13px;"></span>
        <select id="bulkStatusSelect"><option value="">Set status...</option>${STATUSES.map(s => `<option>${s}</option>`).join('')}</select>
        <button class="btn-secondary btn-sm" id="bulkDeleteBtn">Delete selected</button>
        <button class="btn-ghost btn-sm" id="bulkClearBtn">Clear selection</button>
      </div>

      <div id="tasksBody"></div>
    `;

    document.getElementById('newTaskBtn').addEventListener('click', () => openCreateModal());
    document.getElementById('taskSearch').addEventListener('input', Utils.debounce((e) => { filters.query = e.target.value; render(main, opts); }, 200));
    document.getElementById('taskProjectFilter').addEventListener('change', (e) => { filters.project = e.target.value; render(main, opts); });
    document.getElementById('taskStatusFilter').addEventListener('change', (e) => { filters.status = e.target.value; render(main, opts); });
    document.getElementById('taskPriorityFilter').addEventListener('change', (e) => { filters.priority = e.target.value; render(main, opts); });
    document.getElementById('taskAssigneeFilter').addEventListener('change', (e) => { filters.assignee = e.target.value; render(main, opts); });
    main.querySelectorAll('.view-toggle button').forEach(b => b.addEventListener('click', () => { viewMode = b.dataset.mode; render(main, opts); }));

    const body = document.getElementById('tasksBody');
    if (!filtered.length) {
      body.innerHTML = `<div class="card empty-state"><div class="empty-state__icon">📋</div>No tasks match your filters.</div>`;
      return;
    }
    if (viewMode === 'grid') renderGrid(body, filtered, opts);
    else if (viewMode === 'kanban') renderKanban(body, filtered);
    else renderList(body, filtered, opts);
  }

  function refreshBulkBar() {
    const bar = document.getElementById('bulkBar');
    if (!bar) return;
    if (selected.size === 0) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    document.getElementById('bulkCount').textContent = `${selected.size} selected`;
  }

  function bindBulkBar() {
    const statusSel = document.getElementById('bulkStatusSelect');
    const delBtn = document.getElementById('bulkDeleteBtn');
    const clearBtn = document.getElementById('bulkClearBtn');
    if (!statusSel) return;
    statusSel.addEventListener('change', (e) => {
      if (!e.target.value) return;
      const tasks = DataStore.getTasks().map(t => selected.has(t.id) ? { ...t, status: e.target.value, progress: e.target.value === 'Completed' ? 100 : t.progress } : t);
      DataStore.setTasks(tasks);
      Utils.toast(`Updated ${selected.size} task(s) to ${e.target.value}`);
    });
    delBtn.addEventListener('click', () => {
      const count = selected.size;
      DataStore.setTasks(DataStore.getTasks().filter(t => !selected.has(t.id)));
      Utils.toast(`Deleted ${count} task(s)`);
    });
    clearBtn.addEventListener('click', () => { selected.clear(); App.navigate('tasks'); });
  }

  function renderGrid(body, tasks, opts) {
    body.innerHTML = `<div class="project-grid">${tasks.map(t => {
      const proj = projectOf(t);
      const warn = dependencyWarning(t);
      return `<div class="card project-card" style="--card-color:${Utils.colorHex(proj?.color)}" data-id="${t.id}">
        <div class="project-card__top">
          <div>
            <label class="flex gap-8" style="margin-bottom:4px;"><input type="checkbox" class="task-select" data-id="${t.id}"> <span class="project-card__name" style="margin:0;">${Utils.escapeHtml(t.name)}</span></label>
            <span class="badge ${statusClass(t.status)}">${t.status}</span>
            <span class="badge ${priClass(t.priority)}">${t.priority}</span>
          </div>
        </div>
        <div class="project-card__desc">${Utils.escapeHtml(proj ? proj.name : 'No project')}</div>
        <div class="progress-bar" style="--card-color:${Utils.colorHex(proj?.color)}"><div class="progress-bar__fill" style="width:${t.progress}%"></div></div>
        ${(t.subtasks || []).length ? `<div class="text-faint" style="font-size:11px; margin-top:4px;">${t.subtasks.filter(s => s.completed).length}/${t.subtasks.length} subtasks done</div>` : ''}
        <div class="project-card__meta">
          <span><span class="avatar">${Utils.initials(t.assignedTo)}</span> ${Utils.escapeHtml(t.assignedTo)}</span>
          <span class="text-faint">Due ${Utils.fmtDate(t.dueDate)}</span>
        </div>
        ${warn ? `<div style="margin-top:8px; font-size:11px; color:#C8393A;">⚠ ${Utils.escapeHtml(warn)}</div>` : ''}
      </div>`;
    }).join('')}</div>`;

    body.querySelectorAll('.project-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.task-select')) return;
        openDetailModal(card.dataset.id);
      });
    });
    body.querySelectorAll('.task-select').forEach(cb => cb.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSelect(cb.dataset.id, cb.checked);
    }));

    if (opts.focusId) {
      const el = body.querySelector(`[data-id="${opts.focusId}"]`);
      if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); openDetailModal(opts.focusId); }
    }
  }

  function toggleSelect(id, on) {
    if (on) selected.add(id); else selected.delete(id);
    refreshBulkBar();
    bindBulkBar();
  }

  function renderList(body, tasks, opts) {
    body.innerHTML = `<div class="table-scroll"><table class="data-table">
      <thead><tr><th></th><th>Task</th><th>Project</th><th>Assignee</th><th>Status</th><th>Priority</th><th>Due</th><th>Progress</th></tr></thead>
      <tbody>
        ${tasks.map(t => {
          const proj = projectOf(t);
          return `<tr class="is-clickable" data-id="${t.id}">
            <td><input type="checkbox" class="task-select" data-id="${t.id}"></td>
            <td><strong>${Utils.escapeHtml(t.name)}</strong></td>
            <td>${proj ? `<span class="row-color-dot" style="background:${Utils.colorHex(proj.color)}"></span>${Utils.escapeHtml(proj.name)}` : '—'}</td>
            <td>${Utils.escapeHtml(t.assignedTo)}</td>
            <td><span class="badge ${statusClass(t.status)}">${t.status}</span></td>
            <td><span class="badge ${priClass(t.priority)}">${t.priority}</span></td>
            <td>${Utils.fmtDate(t.dueDate)}</td>
            <td style="min-width:100px;">${t.progress}%</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>`;
    body.querySelectorAll('tr[data-id]').forEach(row => row.addEventListener('click', (e) => {
      if (e.target.closest('.task-select')) return;
      openDetailModal(row.dataset.id);
    }));
    body.querySelectorAll('.task-select').forEach(cb => cb.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSelect(cb.dataset.id, cb.checked);
    }));
  }

  function renderKanban(body, tasks) {
    body.innerHTML = `<div class="kanban">
      ${KANBAN_COLUMNS.map(col => {
        const colTasks = tasks.filter(t => t.status === col);
        return `<div class="kanban-col" data-status="${col}">
          <div class="kanban-col__header"><span class="kanban-col__title">${col}</span><span class="kanban-col__count">${colTasks.length}</span></div>
          <div class="kanban-col__body">
            ${colTasks.map(t => {
              const proj = projectOf(t);
              return `<div class="kanban-card" draggable="true" data-id="${t.id}" style="--card-color:${Utils.colorHex(proj?.color)}">
                <div class="kanban-card__title">${Utils.escapeHtml(t.name)}</div>
                <div class="kanban-card__meta">
                  <span class="avatar">${Utils.initials(t.assignedTo)}</span>
                  <span class="badge ${priClass(t.priority)}">${t.priority}</span>
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>`;
      }).join('')}
    </div>`;

    body.querySelectorAll('.kanban-card').forEach(card => {
      card.addEventListener('click', () => openDetailModal(card.dataset.id));
      card.addEventListener('dragstart', (e) => {
        card.classList.add('dragging');
        e.dataTransfer.setData('text/plain', card.dataset.id);
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
    });
    body.querySelectorAll('.kanban-col').forEach(col => {
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
      col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
      col.addEventListener('drop', (e) => {
        e.preventDefault();
        col.classList.remove('drag-over');
        const id = e.dataTransfer.getData('text/plain');
        const newStatus = col.dataset.status;
        const tasksArr = DataStore.getTasks().map(t => t.id === id ? { ...t, status: newStatus, progress: newStatus === 'Completed' ? 100 : t.progress } : t);
        DataStore.setTasks(tasksArr);
      });
    });
  }

  // ---------------- forms ----------------
  function projectById(id) { return DataStore.getProjects().find(p => p.id === id); }
  function dateWindowLabel(project) { return `${Utils.fmtDate(project.startDate)} – ${Utils.fmtDate(project.dueDate)}`; }

  function applyDateBounds(root, project) {
    const startInput = root.querySelector('#f_start');
    const dueInput = root.querySelector('#f_due');
    const hint = root.querySelector('#f_dateHint');
    [startInput, dueInput].forEach(el => el.classList.remove('is-invalid'));
    if (project && project.startDate && project.dueDate) {
      startInput.min = project.startDate; startInput.max = project.dueDate;
      dueInput.min = project.startDate; dueInput.max = project.dueDate;
      if (hint) { hint.textContent = `Must fall within the project window: ${dateWindowLabel(project)}`; hint.classList.remove('form-field__hint--error'); }
    } else {
      startInput.removeAttribute('min'); startInput.removeAttribute('max');
      dueInput.removeAttribute('min'); dueInput.removeAttribute('max');
      if (hint) hint.textContent = '';
    }
  }

  // Returns null if valid, or { message, fields } describing which inputs are out of range
  function validateTaskDates(data, project) {
    if (!project || !project.startDate || !project.dueDate) return null;
    const outStart = data.startDate && (data.startDate < project.startDate || data.startDate > project.dueDate);
    const outDue = data.dueDate && (data.dueDate < project.startDate || data.dueDate > project.dueDate);
    if (!outStart && !outDue) return null;
    return {
      message: `Task dates must fall within "${project.name}"'s project window (${dateWindowLabel(project)}).`,
      fields: [...(outStart ? ['#f_start'] : []), ...(outDue ? ['#f_due'] : [])]
    };
  }

  function showDateError(root, err) {
    Utils.toast(err.message, { tone: 'danger' });
    const hint = root.querySelector('#f_dateHint');
    if (hint) { hint.textContent = err.message; hint.classList.add('form-field__hint--error'); }
    err.fields.forEach(sel => root.querySelector(sel).classList.add('is-invalid'));
  }

  // ---------------- subtasks ----------------
  // Subtask completion drives the task's Progress % automatically, the same
  // way completed tasks drive a Project's Progress % (see storage.js setTasks).
  // progress = (completed subtasks / total subtasks) * 100, rounded.
  function subtaskRowHtml(s) {
    return `<div class="subtask-row" data-id="${s.id}">
      <input type="checkbox" class="subtask-check" ${s.completed ? 'checked' : ''}>
      <input type="text" class="subtask-name" value="${Utils.escapeHtml(s.name || '')}" placeholder="Subtask name">
      <button type="button" class="subtask-remove" title="Remove subtask">✕</button>
    </div>`;
  }

  function subtasksFieldHtml(subtasks) {
    const total = subtasks.length;
    const done = subtasks.filter(s => s.completed).length;
    return `
      <div class="form-field span-2">
        <label>Subtasks <span class="text-faint" id="subtaskCountLabel" style="font-weight:600;">${total ? `(${done}/${total} done)` : ''}</span></label>
        <div id="subtaskList" class="subtask-list">${subtasks.map(subtaskRowHtml).join('')}</div>
        <button type="button" class="btn-secondary btn-sm" id="addSubtaskBtn" style="margin-top:6px; align-self:flex-start;">+ Add Subtask</button>
      </div>
    `;
  }

  // Wires up add/remove/toggle behavior for the subtasks list rendered above,
  // and keeps the Progress (%) field in sync: when subtasks exist, Progress
  // is auto-computed and the manual field is hidden (read-only), mirroring
  // how Project Progress is auto-derived and not manually editable.
  function bindSubtaskControls(root) {
    const list = root.querySelector('#subtaskList');
    const countLabel = root.querySelector('#subtaskCountLabel');
    const progressWrap = root.querySelector('#f_progressWrap');
    const progressAutoWrap = root.querySelector('#f_progressAutoWrap');
    const progressAutoValue = root.querySelector('#f_progressAutoValue');
    const statusSelect = root.querySelector('#f_status');
    const statusHint = root.querySelector('#f_statusHint');

    function updateProgressUI() {
      const rows = list.querySelectorAll('.subtask-row');
      const total = rows.length;
      const done = list.querySelectorAll('.subtask-check:checked').length;
      countLabel.textContent = total ? `(${done}/${total} done)` : '';
      if (total) {
        progressWrap.style.display = 'none';
        progressAutoWrap.style.display = '';
        progressAutoValue.textContent = Math.round((done / total) * 100) + '%';
      } else {
        progressWrap.style.display = '';
        progressAutoWrap.style.display = 'none';
      }

      // Subtask completion also drives Status, the same way it drives
      // Progress above: once every subtask is checked off the task
      // auto-completes; unchecking one afterward auto-reverts it to
      // 'In Progress'. This is what lets the Milestone auto-sync in
      // storage.js (which keys off task.status === 'Completed') actually
      // fire once all of a milestone's tasks are done via their subtasks.
      if (total) {
        statusSelect.disabled = true;
        statusHint.textContent = '(auto from subtasks)';
        const allDone = done === total;
        if (allDone) statusSelect.value = 'Completed';
        else if (statusSelect.value === 'Completed') statusSelect.value = 'In Progress';
      } else {
        statusSelect.disabled = false;
        statusHint.textContent = '';
      }
    }

    function bindRow(row) {
      row.querySelector('.subtask-check').addEventListener('change', updateProgressUI);
      row.querySelector('.subtask-remove').addEventListener('click', () => { row.remove(); updateProgressUI(); });
    }

    function addRow(subtask) {
      const row = document.createElement('div');
      row.className = 'subtask-row';
      row.dataset.id = subtask.id;
      row.innerHTML = `
        <input type="checkbox" class="subtask-check" ${subtask.completed ? 'checked' : ''}>
        <input type="text" class="subtask-name" value="${Utils.escapeHtml(subtask.name || '')}" placeholder="Subtask name">
        <button type="button" class="subtask-remove" title="Remove subtask">✕</button>
      `;
      list.appendChild(row);
      bindRow(row);
      return row;
    }

    list.querySelectorAll('.subtask-row').forEach(bindRow);
    root.querySelector('#addSubtaskBtn').addEventListener('click', () => {
      const row = addRow({ id: Utils.uid('subtask'), name: '', completed: false });
      row.querySelector('.subtask-name').focus();
    });

    updateProgressUI();
  }

  function readSubtasks(root) {
    return [...root.querySelectorAll('#subtaskList .subtask-row')]
      .map(row => ({
        id: row.dataset.id,
        name: row.querySelector('.subtask-name').value.trim(),
        completed: row.querySelector('.subtask-check').checked
      }))
      .filter(s => s.name); // drop rows left blank
  }

  function milestoneOptionsHtml(projectId, current) {
    const list = DataStore.getMilestones().filter(m => m.projectId === projectId);
    const extra = (current && !list.some(m => m.id === current))
      ? `<option value="${current}" selected>(removed milestone)</option>` : '';
    return `<option value="">No milestone</option>${extra}${list.map(m =>
      `<option value="${m.id}" ${current === m.id ? 'selected' : ''}>${Utils.escapeHtml(m.name)}</option>`
    ).join('')}`;
  }

  function formHtml(t, projects) {
    const availableDeps = DataStore.getTasks().filter(x => x.id !== t.id && x.projectId === (t.projectId || projects[0]?.id));
    const subtasks = t.subtasks || [];
    const initialProjectId = t.projectId || projects[0]?.id;
    return `
      <div class="form-grid">
        <div class="form-field span-2"><label>Task Name</label><input type="text" id="f_name" value="${Utils.escapeHtml(t.name || '')}" placeholder="e.g. Migrate staging tables"></div>
        <div class="form-field span-2"><label>Description</label><textarea id="f_desc">${Utils.escapeHtml(t.description || '')}</textarea></div>
        <div class="form-field"><label>Project</label><select id="f_project">${projects.map(p => `<option value="${p.id}" ${t.projectId === p.id ? 'selected' : ''}>${Utils.escapeHtml(p.name)}</option>`).join('')}</select></div>
        <div class="form-field"><label>Milestone (optional)</label><select id="f_milestone">${milestoneOptionsHtml(initialProjectId, t.milestoneId || '')}</select></div>
        <div class="form-field"><label>Assigned To</label><select id="f_assignee">${Utils.memberOptionsHtml(t.assignedTo || '')}</select></div>
        <div class="form-field"><label>Start Date</label><input type="date" id="f_start" value="${t.startDate || Utils.todayISO()}"></div>
        <div class="form-field"><label>Due Date</label><input type="date" id="f_due" value="${t.dueDate || Utils.todayISO()}"></div>
        <div class="form-field span-2"><div class="form-field__hint" id="f_dateHint"></div></div>
        <div class="form-field"><label>Priority</label><select id="f_priority">${PRIORITIES.map(x => `<option ${t.priority === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
        <div class="form-field"><label>Status <span class="text-faint" id="f_statusHint" style="font-weight:400; font-size:11px;"></span></label><select id="f_status">${STATUSES.map(x => `<option ${t.status === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
        <div class="form-field" id="f_progressWrap"><label>Progress (%)</label><input type="number" id="f_progress" min="0" max="100" value="${t.progress ?? 0}"></div>
        <div class="form-field" id="f_progressAutoWrap" style="display:none;"><label>Progress (auto from subtasks)</label><div class="form-field__readonly" id="f_progressAutoValue">0%</div></div>
        <div class="form-field"><label>Estimated Hours</label><input type="number" id="f_est" min="0" value="${t.estimatedHours ?? 0}"></div>
        <div class="form-field"><label>Actual Hours</label><input type="number" id="f_actual" min="0" value="${t.actualHours ?? 0}"></div>
        <div class="form-field"><label>Depends On</label><select id="f_dep"><option value="">None</option>${availableDeps.map(d => `<option value="${d.id}" ${t.dependency?.taskId === d.id ? 'selected' : ''}>${Utils.escapeHtml(d.name)}</option>`).join('')}</select></div>
        <div class="form-field"><label>Dependency Type</label>
          <select id="f_depType">
            ${['FS', 'SS', 'FF', 'SF'].map(x => `<option value="${x}" ${t.dependency?.type === x ? 'selected' : ''}>${x} — ${{FS:'Finish to Start', SS:'Start to Start', FF:'Finish to Finish', SF:'Start to Finish'}[x]}</option>`).join('')}
          </select>
        </div>
        ${subtasksFieldHtml(subtasks)}
      </div>
    `;
  }

  function readForm(root) {
    const depId = root.querySelector('#f_dep').value;
    const subtasks = readSubtasks(root);
    const manualProgress = Utils.clamp(parseInt(root.querySelector('#f_progress').value) || 0, 0, 100);
    // Mirrors Project Progress logic (see storage.js setTasks): when the task
    // has subtasks, Progress % is derived from completed/total subtasks and
    // the manual field is ignored. Otherwise fall back to the manual value.
    const progress = subtasks.length
      ? Math.round((subtasks.filter(s => s.completed).length / subtasks.length) * 100)
      : manualProgress;
    // Mirrors the live sync in bindSubtaskControls/updateProgressUI: when
    // subtasks exist, Status is derived from their completion rather than
    // trusted from the (disabled) dropdown, so it can't be saved stale.
    let status = root.querySelector('#f_status').value;
    if (subtasks.length) {
      status = subtasks.every(s => s.completed) ? 'Completed' : (status === 'Completed' ? 'In Progress' : status);
    }
    return {
      name: root.querySelector('#f_name').value.trim() || 'Untitled Task',
      description: root.querySelector('#f_desc').value.trim(),
      projectId: root.querySelector('#f_project').value,
      milestoneId: root.querySelector('#f_milestone').value || null,
      assignedTo: root.querySelector('#f_assignee').value,
      startDate: root.querySelector('#f_start').value,
      dueDate: root.querySelector('#f_due').value,
      priority: root.querySelector('#f_priority').value,
      status,
      progress,
      subtasks,
      estimatedHours: parseInt(root.querySelector('#f_est').value) || 0,
      actualHours: parseInt(root.querySelector('#f_actual').value) || 0,
      dependency: depId ? { taskId: depId, type: root.querySelector('#f_depType').value } : null
    };
  }

  function openCreateModal() {
    const projects = DataStore.getProjects();
    if (!projects.length) { Utils.toast('Create a project first'); return; }
    const draft = { status: 'Not Started', priority: 'Medium', projectId: filters.project || projects[0].id };
    App.navigate('tasks');
    Utils.openModal({
      title: 'New Task', wide: true,
      bodyHtml: formHtml(draft, projects),
      footerHtml: `<button class="btn-secondary" data-close>Cancel</button><button class="btn-primary" id="saveTaskBtn">Create Task</button>`,
      onMount: (root, close) => {
        applyDateBounds(root, projectById(root.querySelector('#f_project').value));
        bindSubtaskControls(root);
        root.querySelector('#f_project').addEventListener('change', (e) => { applyDateBounds(root, projectById(e.target.value)); root.querySelector('#f_milestone').innerHTML = milestoneOptionsHtml(e.target.value, ''); });
        root.querySelector('[data-close]').addEventListener('click', close);
        root.querySelector('#saveTaskBtn').addEventListener('click', () => {
          const data = readForm(root);
          const err = validateTaskDates(data, projectById(data.projectId));
          if (err) { showDateError(root, err); return; }
          const task = { id: Utils.uid('task'), ...data, comments: [], createdAt: Date.now() };
          DataStore.setTasks([...DataStore.getTasks(), task]);
          Utils.toast(`Created "${task.name}"`);
          close();
        });
      }
    });
  }

  function openEditModal(task) {
    const projects = DataStore.getProjects();
    Utils.openModal({
      title: 'Edit Task', wide: true,
      bodyHtml: formHtml(task, projects),
      footerHtml: `<button class="btn-secondary" data-close>Cancel</button><button class="btn-primary" id="saveTaskBtn">Save Changes</button>`,
      onMount: (root, close) => {
        applyDateBounds(root, projectById(root.querySelector('#f_project').value));
        bindSubtaskControls(root);
        root.querySelector('#f_project').addEventListener('change', (e) => { applyDateBounds(root, projectById(e.target.value)); root.querySelector('#f_milestone').innerHTML = milestoneOptionsHtml(e.target.value, ''); });
        root.querySelector('[data-close]').addEventListener('click', close);
        root.querySelector('#saveTaskBtn').addEventListener('click', () => {
          const data = readForm(root);
          const err = validateTaskDates(data, projectById(data.projectId));
          if (err) { showDateError(root, err); return; }
          const tasks = DataStore.getTasks();
          const idx = tasks.findIndex(t => t.id === task.id);
          tasks[idx] = { ...task, ...data };
          DataStore.setTasks([...tasks]);
          Utils.toast('Task updated');
          close();
        });
      }
    });
  }

  function openDetailModal(id) {
    const task = DataStore.getTasks().find(t => t.id === id);
    if (!task) return;
    const proj = projectOf(task);
    const warn = dependencyWarning(task);
    const milestone = task.milestoneId ? DataStore.getMilestones().find(m => m.id === task.milestoneId) : null;
    Utils.openModal({
      title: task.name, wide: true,
      bodyHtml: `
        <div class="flex gap-8" style="margin-bottom:14px; flex-wrap:wrap;">
          <span class="badge ${statusClass(task.status)}">${task.status}</span>
          <span class="badge ${priClass(task.priority)}">${task.priority}</span>
          ${proj ? `<span class="tag"><span class="row-color-dot" style="background:${Utils.colorHex(proj.color)}"></span>${Utils.escapeHtml(proj.name)}</span>` : ''}
          ${milestone ? `<span class="tag">🚩 ${Utils.escapeHtml(milestone.name)}</span>` : ''}
        </div>
        ${warn ? `<div class="card" style="padding:10px 14px; background:var(--coral-soft); color:#C8393A; margin-bottom:14px; font-size:12.5px;">⚠ ${Utils.escapeHtml(warn)}</div>` : ''}
        <p class="text-soft">${Utils.escapeHtml(task.description || 'No description yet.')}</p>
        <div class="form-grid" style="margin:16px 0;">
          <div><div class="text-faint" style="font-size:11px;">ASSIGNED TO</div><div>${Utils.escapeHtml(task.assignedTo)}</div></div>
          <div><div class="text-faint" style="font-size:11px;">DUE DATE</div><div>${Utils.fmtDate(task.dueDate)}</div></div>
          <div><div class="text-faint" style="font-size:11px;">ESTIMATED / ACTUAL HOURS</div><div>${task.estimatedHours}h / ${task.actualHours}h</div></div>
          <div><div class="text-faint" style="font-size:11px;">PROGRESS</div><div>${task.progress}%</div></div>
        </div>
        <div class="progress-bar" style="--card-color:${Utils.colorHex(proj?.color)}"><div class="progress-bar__fill" style="width:${task.progress}%"></div></div>

        ${(task.subtasks || []).length ? `
        <div class="panel__title" style="margin-top:20px;">Subtasks (${task.subtasks.filter(s => s.completed).length}/${task.subtasks.length} done)</div>
        <div style="margin-bottom:10px;">
          ${task.subtasks.map(s => `<div style="padding:6px 0; border-bottom:1px solid var(--border-soft); font-size:12.5px; display:flex; align-items:center; gap:8px;">
            <span>${s.completed ? '✅' : '⬜'}</span>
            <span style="${s.completed ? 'text-decoration:line-through; color:var(--ink-faint);' : ''}">${Utils.escapeHtml(s.name)}</span>
          </div>`).join('')}
        </div>` : ''}

        <div class="panel__title" style="margin-top:20px;">Comments</div>
        <div id="commentsList" style="margin-bottom:10px;">
          ${(task.comments || []).length ? task.comments.map(c => `<div style="padding:8px 0; border-bottom:1px solid var(--border-soft); font-size:12.5px;"><strong>${Utils.escapeHtml(c.author || 'You')}</strong> <span class="text-faint">${new Date(c.date).toLocaleString()}</span><div>${Utils.escapeHtml(c.text)}</div></div>`).join('') : `<div class="text-faint" style="font-size:12.5px;">No comments yet.</div>`}
        </div>
        <div class="flex gap-8">
          <input type="text" id="newCommentInput" placeholder="Add a comment..." style="flex:1; padding:8px 12px; border-radius:var(--radius-sm); border:1px solid var(--border); background:var(--bg); color:var(--ink);">
          <button class="btn-secondary btn-sm" id="addCommentBtn">Add</button>
        </div>
      `,
      footerHtml: `
        <button class="btn-secondary" id="editTaskBtn">✏ Edit</button>
        <button class="btn-secondary" id="dupTaskBtn">⧉ Duplicate</button>
        <button class="btn-danger" id="delTaskBtn">Delete</button>
      `,
      onMount: (root, close) => {
        root.querySelector('#editTaskBtn').addEventListener('click', () => { close(); openEditModal(task); });
        root.querySelector('#dupTaskBtn').addEventListener('click', () => {
          const copy = { ...task, id: Utils.uid('task'), name: task.name + ' (Copy)', createdAt: Date.now() };
          DataStore.setTasks([...DataStore.getTasks(), copy]);
          Utils.toast('Task duplicated');
          close();
        });
        root.querySelector('#delTaskBtn').addEventListener('click', () => { close(); App.deleteWithUndo({ label: task.name, kind: 'task', id: task.id }); });
        root.querySelector('#addCommentBtn').addEventListener('click', () => {
          const input = root.querySelector('#newCommentInput');
          if (!input.value.trim()) return;
          const tasks = DataStore.getTasks();
          const idx = tasks.findIndex(t => t.id === task.id);
          tasks[idx].comments = [...(tasks[idx].comments || []), { text: input.value.trim(), author: 'You', date: Date.now() }];
          DataStore.setTasks([...tasks]);
          close();
          openDetailModal(task.id);
        });
      }
    });
  }

  return { render, openCreateModal, openEditModal, openDetailModal, filterByProject };
})();
