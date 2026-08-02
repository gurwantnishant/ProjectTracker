/* ============================================================
   MILESTONES.JS
   Milestone objects belong to a project. They're surfaced in
   three places: the project detail modal, the Dashboard
   ("Upcoming Milestones"), and as diamond markers on the Gantt.
   ============================================================ */

const Milestones = (() => {
  const STATUSES = ['Not Started', 'In Progress', 'At Risk', 'Completed'];

  function statusClass(s) { return 'badge--status-' + s.toLowerCase().replace(/\s+/g, ''); }

  function diamondColor(status) {
    if (status === 'Completed') return 'var(--teal)';
    if (status === 'At Risk') return 'var(--coral)';
    if (status === 'In Progress') return 'var(--primary)';
    return 'var(--ink-faint)';
  }

  function forProject(projectId) {
    return DataStore.getMilestones()
      .filter(m => m.projectId === projectId)
      .sort((a, b) => (a.plannedDate < b.plannedDate ? -1 : 1));
  }

  function getUpcoming(days = 14) {
    const today = Utils.todayISO();
    const end = Utils.addDays(today, days);
    return DataStore.getMilestones()
      .filter(m => m.status !== 'Completed' && m.plannedDate >= today && m.plannedDate <= end)
      .sort((a, b) => (a.plannedDate < b.plannedDate ? -1 : 1));
  }

  function getOverdue() {
    const today = Utils.todayISO();
    return DataStore.getMilestones().filter(m => m.status !== 'Completed' && m.plannedDate < today);
  }

  // ---------------- project-detail list ----------------
  function renderForProject(container, projectId) {
    if (!container) return;
    const list = forProject(projectId);
    container.innerHTML = `
      <div class="flex" style="justify-content: space-between; margin-top: 22px; margin-bottom: 10px;">
        <div class="panel__title mb-0">Milestones (${list.length})</div>
        <button class="btn-secondary btn-sm" id="addMilestoneBtn">+ Add Milestone</button>
      </div>
      ${list.length ? list.map(m => milestoneRowHtml(m)).join('') : `<div class="text-faint" style="margin-bottom: 10px;">No milestones yet for this project.</div>`}
    `;
    container.querySelector('#addMilestoneBtn').addEventListener('click', () => openCreateModal(projectId));
    container.querySelectorAll('[data-milestone-edit]').forEach(el => el.addEventListener('click', () => {
      const m = DataStore.getMilestones().find(x => x.id === el.dataset.milestoneEdit);
      if (m) openEditModal(m);
    }));
  }

  function milestoneRowHtml(m) {
    const dep = m.dependsOn ? DataStore.getMilestones().find(x => x.id === m.dependsOn) : null;
    const blocked = dep && dep.status !== 'Completed';
    return `<div class="milestone-item" data-milestone-edit="${m.id}" style="cursor:pointer;">
      <div class="flex gap-8">
        <span class="milestone-item__diamond" style="background:${diamondColor(m.status)}"></span>
        <div>
          <div style="font-weight:600; font-size:13px;">${Utils.escapeHtml(m.name)} ${blocked ? '<span title="Waiting on a dependency">🔗</span>' : ''}</div>
          <div class="text-faint" style="font-size:11.5px;">${Utils.escapeHtml(m.owner || 'Unassigned')} · Planned ${Utils.fmtDate(m.plannedDate)}${m.actualDate ? ' · Actual ' + Utils.fmtDate(m.actualDate) : ''}</div>
        </div>
      </div>
      <div class="flex gap-8">
        <span class="badge ${statusClass(m.status)}">${m.status}</span>
        <span class="text-faint" style="font-size:11.5px; width:34px; text-align:right;">${m.completion}%</span>
      </div>
    </div>`;
  }

  // ---------------- form ----------------
  function formHtml(m, projectId) {
    const siblings = DataStore.getMilestones().filter(x => x.projectId === projectId && x.id !== m.id);
    return `
      <div class="form-grid">
        <div class="form-field span-2"><label>Milestone Name</label><input type="text" id="mf_name" value="${Utils.escapeHtml(m.name || '')}" placeholder="e.g. UAT Sign-off"></div>
        <div class="form-field span-2"><label>Description</label><textarea id="mf_desc" placeholder="What does this milestone represent?">${Utils.escapeHtml(m.description || '')}</textarea></div>
        <div class="form-field"><label>Owner</label><select id="mf_owner">${Utils.managerOptionsHtml(m.owner || '')}</select></div>
        <div class="form-field"><label>Status (auto from tasks)</label><div class="form-field__readonly"><span class="badge ${statusClass(m.status || 'Not Started')}">${m.status || 'Not Started'}</span></div></div>
        <div class="form-field"><label>Planned Date</label><input type="date" id="mf_planned" value="${m.plannedDate || Utils.todayISO()}"></div>
        <div class="form-field"><label>Actual Date</label><input type="date" id="mf_actual" value="${m.actualDate || ''}"></div>
        <div class="form-field"><label>Completion (auto from tasks)</label><div class="form-field__readonly">${m.completion ?? 0}%</div></div>
        <div class="form-field"><label>Depends On</label><select id="mf_dependsOn"><option value="">None</option>${siblings.map(s => `<option value="${s.id}" ${m.dependsOn === s.id ? 'selected' : ''}>${Utils.escapeHtml(s.name)}</option>`).join('')}</select></div>
      </div>
    `;
  }

  function readForm(root) {
    return {
      name: root.querySelector('#mf_name').value.trim() || 'Untitled Milestone',
      description: root.querySelector('#mf_desc').value.trim(),
      owner: root.querySelector('#mf_owner').value,
      plannedDate: root.querySelector('#mf_planned').value || Utils.todayISO(),
      actualDate: root.querySelector('#mf_actual').value || null,
      dependsOn: root.querySelector('#mf_dependsOn').value || null
    };
  }

  function refreshHost(projectId) {
    const host = document.getElementById('milestonesSection');
    if (host) renderForProject(host, projectId);
  }

  function openCreateModal(projectId) {
    const draft = { status: 'Not Started', completion: 0 };
    Utils.openModal({
      title: 'New Milestone',
      bodyHtml: formHtml(draft, projectId),
      footerHtml: `<button class="btn-secondary" data-close>Cancel</button><button class="btn-primary" id="saveMilestoneBtn">Create Milestone</button>`,
      onMount: (root, close) => {
        root.querySelector('[data-close]').addEventListener('click', close);
        root.querySelector('#saveMilestoneBtn').addEventListener('click', () => {
          const data = readForm(root);
          const milestone = { id: Utils.uid('mile'), projectId, completion: 0, status: 'Not Started', ...data, createdAt: Date.now() };
          DataStore.setMilestones([...DataStore.getMilestones(), milestone]);
          Utils.toast(`Milestone "${milestone.name}" created`);
          close();
          refreshHost(projectId);
        });
      }
    });
  }

  function openEditModal(m) {
    Utils.openModal({
      title: 'Edit Milestone',
      bodyHtml: formHtml(m, m.projectId),
      footerHtml: `<button class="btn-secondary" data-close>Cancel</button><button class="btn-danger" id="delMilestoneBtn">Delete</button><button class="btn-primary" id="saveMilestoneBtn">Save Changes</button>`,
      onMount: (root, close) => {
        root.querySelector('[data-close]').addEventListener('click', close);
        root.querySelector('#delMilestoneBtn').addEventListener('click', () => {
          close();
          App.deleteWithUndo({ label: m.name, kind: 'milestone', id: m.id });
          refreshHost(m.projectId);
        });
        root.querySelector('#saveMilestoneBtn').addEventListener('click', () => {
          const data = readForm(root);
          const all = DataStore.getMilestones();
          const idx = all.findIndex(x => x.id === m.id);
          all[idx] = { ...m, ...data };
          DataStore.setMilestones([...all]);
          Utils.toast('Milestone updated');
          close();
          refreshHost(m.projectId);
        });
      }
    });
  }

  return { STATUSES, statusClass, diamondColor, forProject, getUpcoming, getOverdue, renderForProject, openCreateModal, openEditModal };
})();
