/* ============================================================
   GANTT.JS - interactive timeline
   ============================================================ */

const Gantt = (() => {
  let granularity = 'weekly'; // 'weekly' | 'monthly'
  let projectFilter = '';

  function statusColor(t, projColor) {
    if (t.status === 'Completed') return 'var(--teal)';
    if (t.status === 'Blocked') return 'var(--coral)';
    return Utils.colorHex(projColor);
  }

  function computeRange(tasks) {
    if (!tasks.length) {
      const s = Utils.addDays(Utils.todayISO(), -7);
      return { start: s, end: Utils.addDays(s, 30) };
    }
    let min = tasks[0].startDate, max = tasks[0].dueDate;
    tasks.forEach(t => { if (t.startDate < min) min = t.startDate; if (t.dueDate > max) max = t.dueDate; });
    return { start: Utils.addDays(min, -4), end: Utils.addDays(max, 4) };
  }

  function buildTicks(range) {
    const ticks = [];
    if (granularity === 'monthly') {
      let cursor = new Date(range.start + 'T00:00:00');
      cursor.setDate(1);
      const end = new Date(range.end + 'T00:00:00');
      while (cursor <= end) {
        const monthStart = cursor.toISOString().slice(0, 10);
        const next = new Date(cursor); next.setMonth(next.getMonth() + 1);
        const span = Utils.daysBetween(monthStart, Utils.daysBetween(range.start, monthStart) < 0 ? range.start : next.toISOString().slice(0, 10));
        ticks.push({ label: cursor.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }), start: monthStart, days: Utils.daysBetween(monthStart, next.toISOString().slice(0, 10)) });
        cursor = next;
      }
    } else {
      let cursor = range.start;
      while (cursor <= range.end) {
        const next = Utils.addDays(cursor, 7);
        ticks.push({ label: Utils.fmtDate(cursor).replace(/, \d{4}/, ''), start: cursor, days: 7 });
        cursor = next;
      }
    }
    return ticks;
  }

  function pxPerDay() { return granularity === 'monthly' ? 11 : 34; }

  function render(main) {
    const allTasks = DataStore.getTasks();
    const projects = DataStore.getProjects().filter(p => !p.archived);
    const tasks = projectFilter ? allTasks.filter(t => t.projectId === projectFilter) : allTasks;
    const range = computeRange(tasks);
    const totalDays = Math.max(1, Utils.daysBetween(range.start, range.end));
    const ticks = buildTicks(range);
    const trackWidth = totalDays * pxPerDay();

    main.innerHTML = `
      <div class="view-header">
        <div>
          <div class="view-header__title">Timeline</div>
          <div class="view-header__subtitle">Drag bars to reschedule, drag edges to resize. Dependencies auto-shift.</div>
        </div>
      </div>
      <div class="toolbar">
        <select id="ganttProjectFilter"><option value="">All projects</option>${projects.map(p => `<option value="${p.id}" ${projectFilter === p.id ? 'selected' : ''}>${Utils.escapeHtml(p.name)}</option>`).join('')}</select>
        <div class="view-toggle" style="margin-left:auto;">
          <button data-g="weekly" class="${granularity === 'weekly' ? 'is-active' : ''}">Weekly</button>
          <button data-g="monthly" class="${granularity === 'monthly' ? 'is-active' : ''}">Monthly</button>
        </div>
      </div>
      <div id="ganttHost"></div>
    `;

    document.getElementById('ganttProjectFilter').addEventListener('change', (e) => { projectFilter = e.target.value; render(main); });
    main.querySelectorAll('.view-toggle button').forEach(b => b.addEventListener('click', () => { granularity = b.dataset.g; render(main); }));

    const host = document.getElementById('ganttHost');
    if (!tasks.length) {
      host.innerHTML = `<div class="card empty-state"><div class="empty-state__icon">📅</div>No tasks to show on the timeline yet.</div>`;
      return;
    }

    let rowsHtml = '';
    const rowIndexById = {};
    let rowIdx = 0;

    projects.forEach(proj => {
      const projTasks = tasks.filter(t => t.projectId === proj.id);
      if (!projTasks.length) return;
      const projMilestones = (typeof Milestones !== 'undefined' ? Milestones.forProject(proj.id) : [])
        .filter(m => m.plannedDate >= range.start && m.plannedDate <= range.end);
      const milestoneMarkers = projMilestones.map(m => {
        const left = Utils.daysBetween(range.start, m.plannedDate) * pxPerDay();
        return `<div class="gantt-milestone" data-milestone="${m.id}" style="left:${left}px; background:${Milestones.diamondColor(m.status)};" title="${Utils.escapeHtml(m.name)} — ${m.status}"></div>`;
      }).join('');
      rowsHtml += `<div class="gantt-row" style="background:var(--border-soft);">
        <div class="gantt-label-col" style="font-weight:800;"><span class="row-color-dot" style="background:${Utils.colorHex(proj.color)}"></span>${Utils.escapeHtml(proj.name)}</div>
        <div class="gantt-track">${milestoneMarkers}</div>
      </div>`;
      projTasks.forEach(t => {
        rowIndexById[t.id] = rowIdx++;
        const offsetDays = Utils.daysBetween(range.start, t.startDate);
        const durDays = Math.max(1, Utils.daysBetween(t.startDate, t.dueDate));
        const left = offsetDays * pxPerDay();
        const width = durDays * pxPerDay();
        const isMilestone = t.startDate === t.dueDate;
        rowsHtml += `<div class="gantt-row">
          <div class="gantt-label-col"><span class="badge ${t.status === 'Completed' ? 'badge--status-completed' : 'badge--status-inprogress'}" style="font-size:9.5px; padding:1px 6px;">${t.progress}%</span> ${Utils.escapeHtml(t.name)}</div>
          <div class="gantt-track">
            ${isMilestone
              ? `<div class="gantt-milestone" data-id="${t.id}" style="left:${left}px;" title="${Utils.escapeHtml(t.name)}"></div>`
              : `<div class="gantt-bar" data-id="${t.id}" style="left:${left}px; width:${width}px; background:${statusColor(t, proj.color)};">
                  <div class="gantt-bar__progress" style="width:${t.progress}%"></div>
                  <span style="position:relative;">${Utils.escapeHtml(t.name)}</span>
                  <div class="gantt-bar__handle gantt-bar__handle--l" data-handle="l"></div>
                  <div class="gantt-bar__handle gantt-bar__handle--r" data-handle="r"></div>
                </div>`}
          </div>
        </div>`;
      });
    });

    host.innerHTML = `<div class="gantt-wrap"><div class="gantt-grid" style="min-width:${220 + trackWidth}px;">
      <div class="gantt-header">
        <div class="gantt-label-col">Task</div>
        ${ticks.map(tk => `<div class="gantt-tick" style="width:${tk.days * pxPerDay()}px;">${tk.label}</div>`).join('')}
      </div>
      <div style="position:relative;">
        ${rowsHtml}
        <svg class="gantt-deps" width="${trackWidth}" height="${rowIdx * 40}" style="left:220px;">
          ${buildDependencyLines(tasks, range, rowIndexById)}
        </svg>
      </div>
    </div></div>`;

    bindDragAndResize(host, range);
    host.querySelectorAll('.gantt-bar, .gantt-milestone').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-handle]')) return;
        if (el.dataset.dragged) { delete el.dataset.dragged; return; }
        if (el.dataset.milestone) {
          const m = DataStore.getMilestones().find(x => x.id === el.dataset.milestone);
          if (m) Milestones.openEditModal(m);
          return;
        }
        Tasks.openDetailModal(el.dataset.id);
      });
    });
  }

  function buildDependencyLines(tasks, range, rowIndexById) {
    let svg = '';
    tasks.forEach(t => {
      if (!t.dependency) return;
      const pred = tasks.find(x => x.id === t.dependency.taskId);
      if (!pred || rowIndexById[pred.id] === undefined || rowIndexById[t.id] === undefined) return;
      const predEndX = Utils.daysBetween(range.start, pred.dueDate) * pxPerDay();
      const predY = rowIndexById[pred.id] * 40 + 20;
      const startX = Utils.daysBetween(range.start, t.startDate) * pxPerDay();
      const startY = rowIndexById[t.id] * 40 + 20;
      const midX = (predEndX + startX) / 2;
      const blocked = pred.status !== 'Completed';
      svg += `<path d="M ${predEndX} ${predY} C ${midX} ${predY}, ${midX} ${startY}, ${startX} ${startY}" fill="none" stroke="${blocked ? 'var(--coral)' : 'var(--ink-faint)'}" stroke-width="1.5" stroke-dasharray="${blocked ? '4 3' : 'none'}" marker-end="url(#arrow)"/>`;
    });
    return `<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="var(--ink-faint)"/></marker></defs>${svg}`;
  }

  function projectOf(t) { return DataStore.getProjects().find(p => p.id === t.projectId); }

  // Keeps a start/due pair within a project's start/due window, preserving duration where possible.
  function clampToProject(newStart, newDue, project) {
    if (!project || !project.startDate || !project.dueDate) return { start: newStart, due: newDue, clamped: false };
    const dur = Math.max(1, Utils.daysBetween(newStart, newDue));
    let start = newStart, due = newDue, clamped = false;
    if (start < project.startDate) { start = project.startDate; due = Utils.addDays(start, dur); clamped = true; }
    if (due > project.dueDate) {
      due = project.dueDate;
      start = Utils.addDays(due, -dur);
      if (start < project.startDate) start = project.startDate;
      clamped = true;
    }
    return { start, due, clamped };
  }

  function shiftDependents(taskId, deltaDays, tasksMap, visited) {
    if (visited.has(taskId)) return;
    visited.add(taskId);
    Object.values(tasksMap).forEach(t => {
      if (t.dependency && t.dependency.taskId === taskId) {
        if (t.dependency.type === 'FS') {
          const pred = tasksMap[taskId];
          if (pred.dueDate > t.startDate) {
            const dur = Utils.daysBetween(t.startDate, t.dueDate);
            const proposedStart = pred.dueDate;
            const proposedDue = Utils.addDays(proposedStart, dur);
            const { start, due } = clampToProject(proposedStart, proposedDue, projectOf(t));
            t.startDate = start;
            t.dueDate = due;
            shiftDependents(t.id, 0, tasksMap, visited);
          }
        }
      }
    });
  }

  function bindDragAndResize(host, range) {
    const day = pxPerDay();
    host.querySelectorAll('.gantt-bar').forEach(bar => {
      let mode = null, startX = 0, origLeft = 0, origWidth = 0;
      const onDown = (e, m) => {
        mode = m; startX = e.clientX;
        origLeft = parseFloat(bar.style.left);
        origWidth = parseFloat(bar.style.width);
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        e.stopPropagation();
      };
      bar.addEventListener('mousedown', (e) => { if (!e.target.closest('[data-handle]')) onDown(e, 'move'); });
      bar.querySelector('[data-handle="l"]').addEventListener('mousedown', (e) => onDown(e, 'left'));
      bar.querySelector('[data-handle="r"]').addEventListener('mousedown', (e) => onDown(e, 'right'));

      function onMove(e) {
        const dx = e.clientX - startX;
        bar.dataset.dragged = '1';
        if (mode === 'move') bar.style.left = (origLeft + dx) + 'px';
        else if (mode === 'right') bar.style.width = Math.max(day, origWidth + dx) + 'px';
        else if (mode === 'left') {
          const newLeft = Utils.clamp(origLeft + dx, 0, origLeft + origWidth - day);
          bar.style.left = newLeft + 'px';
          bar.style.width = (origWidth + (origLeft - newLeft)) + 'px';
        }
      }
      function onUp(e) {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (!bar.dataset.dragged) { mode = null; return; }
        const newLeft = parseFloat(bar.style.left);
        const newWidth = parseFloat(bar.style.width);
        const newStartOffset = Math.round(newLeft / day);
        const newDur = Math.max(1, Math.round(newWidth / day));
        let newStart = Utils.addDays(range.start, newStartOffset);
        let newDue = Utils.addDays(newStart, newDur);

        const tasksArr = DataStore.getTasks();
        const tasksMap = {};
        tasksArr.forEach(t => tasksMap[t.id] = { ...t });
        const t = tasksMap[bar.dataset.id];
        const { start, due, clamped } = clampToProject(newStart, newDue, projectOf(t));
        t.startDate = start; t.dueDate = due;
        if (clamped) Utils.toast(`Kept "${t.name}" within its project's start/due dates`, { tone: 'danger' });
        shiftDependents(t.id, 0, tasksMap, new Set());
        DataStore.setTasks(Object.values(tasksMap));
        mode = null;
      }
    });
  }

  return { render };
})();
