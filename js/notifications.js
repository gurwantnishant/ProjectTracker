/* ============================================================
   NOTIFICATIONS.JS
   ============================================================ */

const Notifications = (() => {
  let list = [];
  let panelOpen = false;

  function compute() {
    const today = Utils.todayISO();
    const soon = Utils.addDays(today, 3);
    const projects = DataStore.getProjects().filter(p => !p.archived);
    const tasks = DataStore.getTasks();
    const notifs = [];

    tasks.forEach(t => {
      if (t.status !== 'Completed' && t.dueDate < today) {
        notifs.push({ id: `task-overdue-${t.id}`, icon: '⏰', tone: 'coral', title: `Task overdue: ${t.name}`, time: t.dueDate, target: { type: 'task', id: t.id } });
      } else if (t.status !== 'Completed' && t.dueDate >= today && t.dueDate <= soon) {
        notifs.push({ id: `task-soon-${t.id}`, icon: '📌', tone: 'amber', title: `Due in ${Utils.daysBetween(today, t.dueDate)}d: ${t.name}`, time: t.dueDate, target: { type: 'task', id: t.id } });
      }
      if (t.dependency && t.status !== 'Completed') {
        const dep = tasks.find(x => x.id === t.dependency.taskId);
        if (dep && dep.status !== 'Completed' && t.dependency.type === 'FS' && t.status !== 'Not Started') {
          notifs.push({ id: `dep-blocked-${t.id}`, icon: '🔗', tone: 'coral', title: `Dependency blocked: ${t.name} needs "${dep.name}" done`, time: today, target: { type: 'task', id: t.id } });
        }
      }
    });

    projects.forEach(p => {
      if (p.status !== 'Completed' && p.status !== 'Cancelled' && p.dueDate < today) {
        notifs.push({ id: `proj-overdue-${p.id}`, icon: '🔴', tone: 'coral', title: `Project overdue: ${p.name}`, time: p.dueDate, target: { type: 'project', id: p.id } });
      }
      if (p.status === 'Completed') {
        notifs.push({ id: `proj-done-${p.id}`, icon: '🎉', tone: 'teal', title: `Project completed: ${p.name}`, time: today, target: { type: 'project', id: p.id } });
      }
    });

    if (typeof DataStore.getMilestones === 'function') {
      const milestones = DataStore.getMilestones();
      milestones.forEach(m => {
        const proj = projects.find(p => p.id === m.projectId);
        if (m.status === 'Completed') return;
        if (m.plannedDate < today) {
          notifs.push({ id: `mile-overdue-${m.id}`, icon: '🎯', tone: 'coral', title: `Milestone overdue: ${m.name}${proj ? ' (' + proj.name + ')' : ''}`, time: m.plannedDate, target: { type: 'milestone', id: m.projectId } });
        } else if (m.plannedDate <= soon) {
          notifs.push({ id: `mile-soon-${m.id}`, icon: '🎯', tone: 'amber', title: `Milestone due in ${Utils.daysBetween(today, m.plannedDate)}d: ${m.name}`, time: m.plannedDate, target: { type: 'milestone', id: m.projectId } });
        }
      });
    }

    notifs.sort((a, b) => (a.time < b.time ? 1 : -1));
    list = notifs.slice(0, 40);
    updateBellCount();
    if (panelOpen) renderPanel();
  }

  function updateBellCount() {
    const state = DataStore.getNotificationsState();
    const unread = list.filter(n => !state.read.includes(n.id)).length;
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    if (unread > 0) { badge.style.display = 'flex'; badge.textContent = unread > 9 ? '9+' : unread; }
    else badge.style.display = 'none';
  }

  function markRead(id) {
    const state = DataStore.getNotificationsState();
    if (!state.read.includes(id)) state.read.push(id);
    DataStore.setNotificationsState(state);
    updateBellCount();
  }

  function renderPanel() {
    let panel = document.getElementById('notifPanel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'notifPanel';
      panel.className = 'notif-panel';
      document.body.appendChild(panel);
    }
    const state = DataStore.getNotificationsState();
    panel.innerHTML = `
      <div class="notif-panel__header"><span>Notifications</span>${list.length ? `<button class="btn-ghost btn-sm" id="markAllReadBtn">Mark all read</button>` : ''}</div>
      ${list.length ? list.map(n => `
        <div class="notif-item ${state.read.includes(n.id) ? '' : 'is-unread'}" data-id="${n.id}" data-type="${n.target.type}" data-target="${n.target.id}">
          <span class="notif-item__icon">${n.icon}</span>
          <div>
            <div class="notif-item__title">${Utils.escapeHtml(n.title)}</div>
            <div class="notif-item__time">${Utils.fmtDate(n.time)}</div>
          </div>
        </div>
      `).join('') : `<div class="empty-state"><div class="empty-state__icon">🔔</div>You're all caught up.</div>`}
    `;
    panel.querySelectorAll('.notif-item').forEach(el => el.addEventListener('click', () => {
      markRead(el.dataset.id);
      closePanel();
      if (el.dataset.type === 'project' || el.dataset.type === 'milestone') App.navigate('projects', { focusId: el.dataset.target });
      else App.navigate('tasks', { focusId: el.dataset.target });
    }));
    const markAll = document.getElementById('markAllReadBtn');
    if (markAll) markAll.addEventListener('click', () => {
      const s = DataStore.getNotificationsState();
      list.forEach(n => { if (!s.read.includes(n.id)) s.read.push(n.id); });
      DataStore.setNotificationsState(s);
      updateBellCount();
      renderPanel();
    });
  }

  function closePanel() {
    panelOpen = false;
    const panel = document.getElementById('notifPanel');
    if (panel) panel.remove();
  }

  function togglePanel() {
    if (panelOpen) { closePanel(); return; }
    panelOpen = true;
    renderPanel();
    setTimeout(() => document.addEventListener('click', function handler(e) {
      if (!e.target.closest('#notifPanel') && !e.target.closest('#notifBellBtn')) { closePanel(); document.removeEventListener('click', handler); }
    }), 0);
  }

  function init() { compute(); }

  return { init, recompute: compute, togglePanel };
})();
