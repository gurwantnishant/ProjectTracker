/* ============================================================
   WORKFORCE.JS
   Workforce Planning module: People, Roles & Skills, Allocations,
   Leave & Holidays, and an Overview/Utilization dashboard.

   Reuses existing entities rather than duplicating them:
     - "People" IS DataStore.getMembers() (extended with profile,
       skill and capacity fields — see storage.js normalizeMembers).
       Owner/Assignee dropdowns elsewhere in the app read this same
       list (see Utils.peopleOptionsHtml).
     - Planned/Actual effort reuses task.estimatedHours/actualHours —
       no separate time-tracking system is created.
     - Capacity/utilization math lives in workforce-capacity.js.
   ============================================================ */

const Workforce = (() => {

  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'people', label: 'People' },
    { key: 'roles-skills', label: 'Roles & Skills' },
    { key: 'allocations', label: 'Allocations' },
    { key: 'leave', label: 'Leave & Holidays' }
  ];

  const PROFICIENCY_LABEL = { 1: 'Beginner', 2: 'Intermediate', 3: 'Advanced', 4: 'Expert' };
  const STATUS_OPTIONS = ['Active', 'Inactive', 'On Leave'];
  const LEAVE_TYPES = ['Vacation', 'Sick', 'Personal', 'Other'];
  const LEAVE_STATUSES = ['Approved', 'Pending', 'Rejected'];

  let tab = 'overview';
  let leaveSubTab = 'leave'; // 'leave' | 'holidays'
  let peopleFilters = { query: '', department: '', roleId: '', skillId: '', proficiency: '', status: '' };
  let allocFilters = { memberId: '', projectId: '', onlyOver: false };
  let lastMain = null;

  // ---------------- shared lookups ----------------
  function activeMembers() { return DataStore.getMembers().filter(m => m.status !== 'Inactive'); }
  function memberById(id) { return DataStore.getMembers().find(m => m.id === id); }
  function roleById(id) { return DataStore.getRoles().find(r => r.id === id); }
  function skillById(id) { return DataStore.getSkills().find(s => s.id === id); }
  function projectById(id) { return DataStore.getProjects().find(p => p.id === id); }
  function roleName(id) { const r = roleById(id); return r ? r.name : ''; }
  function skillName(id) { const s = skillById(id); return s ? s.name : ''; }

  function departmentOptions() {
    return [...new Set(DataStore.getMembers().map(m => (m.department || '').trim()).filter(Boolean))].sort();
  }

  // ---------------- entry point ----------------
  function render(main, opts = {}) {
    lastMain = main;
    if (opts.tab) tab = opts.tab;
    if (opts.projectId) { allocFilters.projectId = opts.projectId; tab = 'allocations'; }
    main.innerHTML = `
      <div class="view-header">
        <div>
          <div class="view-header__title">Workforce Planning</div>
          <div class="view-header__subtitle">People, skills, allocation and capacity across every project</div>
        </div>
      </div>
      <div class="tab-bar" id="wfTabBar">
        ${TABS.map(t => `<button class="tab-btn ${tab === t.key ? 'is-active' : ''}" data-tab="${t.key}">${t.label}</button>`).join('')}
      </div>
      <div id="wfTabBody"></div>
    `;
    main.querySelectorAll('#wfTabBar .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => { tab = btn.dataset.tab; render(main); });
    });
    const body = main.querySelector('#wfTabBody');
    if (tab === 'overview') renderOverview(body);
    else if (tab === 'people') renderPeople(body);
    else if (tab === 'roles-skills') renderRolesSkills(body);
    else if (tab === 'allocations') renderAllocations(body);
    else if (tab === 'leave') renderLeaveHolidays(body);
  }

  function refresh() { if (lastMain) render(lastMain); }

  function metricCard(icon, label, value, colorKey, sub) {
    return `<div class="card metric-card metric-card--modern">
      <div class="metric-card__chip chip--${colorKey}">${icon}</div>
      <div class="metric-card__label">${label}</div>
      <div class="metric-card__value">${value}</div>
      ${sub ? `<div class="metric-card__sub text-faint">${sub}</div>` : ''}
    </div>`;
  }

  /* =====================================================================
     OVERVIEW — KPIs + per-person utilization / overallocation table
     ===================================================================== */
  function renderOverview(body) {
    const members = activeMembers();
    const { start, end } = WorkforceCapacity.monthRange();
    const rows = members.map(m => ({ m, cap: WorkforceCapacity.capacityFor(m, start, end) }));

    const overallocated = rows.filter(r => r.cap.overallocatedByHours || r.cap.overallocatedByPercent).length;
    const underutilized = rows.filter(r => WorkforceCapacity.utilizationBand(r.cap.utilizationPct).key === 'under').length;
    const avgUtil = rows.length ? Math.round(rows.reduce((s, r) => s + r.cap.utilizationPct, 0) / rows.length) : 0;
    const availableCapacity = rows.reduce((s, r) => s + Math.max(0, r.cap.availableCapacity), 0);
    const plannedHours = rows.reduce((s, r) => s + r.cap.plannedHours, 0);
    const actualHours = rows.reduce((s, r) => s + r.cap.actualHours, 0);
    const fullyAllocated = rows.filter(r => r.cap.allocationPct >= 95 && r.cap.allocationPct <= 100).length;

    body.innerHTML = `
      <div class="text-faint" style="font-size:12px; margin-bottom:10px;">Showing capacity & utilization for ${Utils.fmtDate(start)} – ${Utils.fmtDate(end)} (current month)</div>
      <div class="wf-kpi-grid">
        ${metricCard('👥', 'Total People', members.length, 'primary')}
        ${metricCard('✅', 'Fully Allocated', fullyAllocated, 'teal')}
        ${metricCard('🔥', 'Overallocated', overallocated, 'coral')}
        ${metricCard('📉', 'Underutilized', underutilized, 'amber')}
        ${metricCard('📊', 'Avg Utilization', avgUtil + '%', 'violet')}
        ${metricCard('🕓', 'Available Capacity', Math.round(availableCapacity) + 'h', 'sky', 'this month')}
        ${metricCard('📝', 'Planned Hours', Math.round(plannedHours) + 'h', 'primary', 'this month')}
        ${metricCard('⏱', 'Actual Hours', Math.round(actualHours) + 'h', 'teal', 'this month')}
      </div>

      <div class="panel__title" style="margin-top:6px;">Utilization & Overallocation</div>
      ${members.length ? `<div class="table-scroll"><table class="data-table">
        <thead><tr><th>Person</th><th>Role</th><th>Department</th><th>Capacity</th><th>Allocation %</th><th>Planned</th><th>Actual</th><th>Utilization</th><th>Status</th></tr></thead>
        <tbody>
          ${rows.map(({ m, cap }) => {
            const band = WorkforceCapacity.utilizationBand(cap.utilizationPct);
            const overBadge = (cap.overallocatedByHours || cap.overallocatedByPercent) ? `<span class="badge badge--status-cancelled" title="Overallocated">⚠ Over</span>` : '';
            return `<tr>
              <td><span class="avatar">${Utils.initials(m.name)}</span> ${Utils.escapeHtml(m.name)}</td>
              <td>${Utils.escapeHtml(roleName(m.roleId) || '—')}</td>
              <td>${Utils.escapeHtml(m.department || '—')}</td>
              <td>${cap.netCapacity}h</td>
              <td>${cap.allocationPct}% ${overBadge}</td>
              <td>${cap.plannedHours}h</td>
              <td>${cap.actualHours}h</td>
              <td>${cap.utilizationPct}%</td>
              <td><span class="badge ${band.cls}">${band.label}</span></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>` : emptyState('👥', 'No active people yet', 'Add people in the People tab to see capacity and utilization here.')}
    `;
  }

  function emptyState(icon, title, sub) {
    return `<div class="card empty-state"><div class="empty-state__icon">${icon}</div><div style="font-weight:600;">${title}</div>${sub ? `<div class="text-faint" style="font-size:12px; margin-top:4px;">${sub}</div>` : ''}</div>`;
  }

  /* =====================================================================
     PEOPLE
     ===================================================================== */
  function filteredPeople() {
    const q = peopleFilters.query.toLowerCase();
    return DataStore.getMembers().filter(m => {
      if (q && !m.name.toLowerCase().includes(q) && !(m.jobTitle || '').toLowerCase().includes(q)) return false;
      if (peopleFilters.department && m.department !== peopleFilters.department) return false;
      if (peopleFilters.roleId && m.roleId !== peopleFilters.roleId) return false;
      if (peopleFilters.status && m.status !== peopleFilters.status) return false;
      if (peopleFilters.skillId) {
        const s = (m.skills || []).find(x => x.skillId === peopleFilters.skillId);
        if (!s) return false;
        if (peopleFilters.proficiency && s.proficiency < Number(peopleFilters.proficiency)) return false;
      }
      return true;
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  function renderPeople(body) {
    const list = filteredPeople();
    const roles = DataStore.getRoles();
    const skills = DataStore.getSkills();
    body.innerHTML = `
      <div class="toolbar">
        <input type="text" id="wfPeopleSearch" placeholder="Search people..." value="${Utils.escapeHtml(peopleFilters.query)}" style="min-width:180px;">
        <select id="wfPeopleDept"><option value="">All departments</option>${departmentOptions().map(d => `<option value="${Utils.escapeHtml(d)}" ${peopleFilters.department === d ? 'selected' : ''}>${Utils.escapeHtml(d)}</option>`).join('')}</select>
        <select id="wfPeopleRole"><option value="">All roles</option>${roles.map(r => `<option value="${r.id}" ${peopleFilters.roleId === r.id ? 'selected' : ''}>${Utils.escapeHtml(r.name)}</option>`).join('')}</select>
        <select id="wfPeopleSkill"><option value="">All skills</option>${skills.map(s => `<option value="${s.id}" ${peopleFilters.skillId === s.id ? 'selected' : ''}>${Utils.escapeHtml(s.name)}</option>`).join('')}</select>
        ${peopleFilters.skillId ? `<select id="wfPeopleProf"><option value="">Any proficiency</option>${[1, 2, 3, 4].map(p => `<option value="${p}" ${peopleFilters.proficiency == p ? 'selected' : ''}>${PROFICIENCY_LABEL[p]}+</option>`).join('')}</select>` : ''}
        <select id="wfPeopleStatus"><option value="">All statuses</option>${STATUS_OPTIONS.map(s => `<option value="${s}" ${peopleFilters.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <div style="flex:1;"></div>
        <button class="btn-primary btn-sm" id="wfAddPersonBtn">+ Add Person</button>
      </div>
      ${list.length ? `<div class="table-scroll"><table class="data-table">
        <thead><tr><th>Name</th><th>Job Title</th><th>Department</th><th>Role</th><th>Manager</th><th>Skills</th><th>Status</th><th>Allocation</th><th></th></tr></thead>
        <tbody>
          ${list.map(personRowHtml).join('')}
        </tbody>
      </table></div>` : emptyState('👥', 'No people match', 'Try clearing filters, or add your first person.')}
    `;

    document.getElementById('wfPeopleSearch').addEventListener('input', Utils.debounce(e => { peopleFilters.query = e.target.value; renderPeople(body); }, 150));
    document.getElementById('wfPeopleDept').addEventListener('change', e => { peopleFilters.department = e.target.value; renderPeople(body); });
    document.getElementById('wfPeopleRole').addEventListener('change', e => { peopleFilters.roleId = e.target.value; renderPeople(body); });
    document.getElementById('wfPeopleSkill').addEventListener('change', e => { peopleFilters.skillId = e.target.value; peopleFilters.proficiency = ''; renderPeople(body); });
    const profSel = document.getElementById('wfPeopleProf');
    if (profSel) profSel.addEventListener('change', e => { peopleFilters.proficiency = e.target.value; renderPeople(body); });
    document.getElementById('wfPeopleStatus').addEventListener('change', e => { peopleFilters.status = e.target.value; renderPeople(body); });
    document.getElementById('wfAddPersonBtn').addEventListener('click', () => openPersonModal(null));

    body.querySelectorAll('[data-edit-person]').forEach(btn => btn.addEventListener('click', () => openPersonModal(memberById(btn.dataset.editPerson))));
    body.querySelectorAll('[data-del-person]').forEach(btn => btn.addEventListener('click', () => deletePerson(btn.dataset.delPerson)));
  }

  function personRowHtml(m) {
    const pct = WorkforceCapacity.currentAllocationPercent(m.id);
    const over = pct > 100;
    const skillChips = (m.skills || []).slice(0, 3).map(s => `<span class="tag" title="${PROFICIENCY_LABEL[s.proficiency]}">${Utils.escapeHtml(skillName(s.skillId))}</span>`).join('');
    const more = (m.skills || []).length > 3 ? `<span class="text-faint" style="font-size:11px;">+${m.skills.length - 3}</span>` : '';
    const statusCls = m.status === 'Active' ? 'badge--status-completed' : m.status === 'On Leave' ? 'badge--status-onhold' : 'badge--status-notstarted';
    return `<tr>
      <td><span class="avatar">${Utils.initials(m.name)}</span> ${Utils.escapeHtml(m.name)}</td>
      <td>${Utils.escapeHtml(m.jobTitle || '—')}</td>
      <td>${Utils.escapeHtml(m.department || '—')}</td>
      <td>${Utils.escapeHtml(roleName(m.roleId) || '—')}</td>
      <td>${Utils.escapeHtml(m.managerId ? (memberById(m.managerId)?.name || '—') : '—')}</td>
      <td>${skillChips}${more}</td>
      <td><span class="badge ${statusCls}">${m.status || 'Active'}</span></td>
      <td>${pct}% ${over ? '<span title="Overallocated">⚠</span>' : ''}</td>
      <td style="white-space:nowrap;"><button class="btn-ghost" data-edit-person="${m.id}" title="Edit">✏</button><button class="btn-ghost" data-del-person="${m.id}" title="Remove" style="color:#C8393A;">🗑</button></td>
    </tr>`;
  }

  function openPersonModal(person) {
    const isNew = !person;
    const draft = person || { hoursPerDay: 8, hoursPerWeek: 40, status: 'Active', skills: [] };
    let skillsDraft = (draft.skills || []).map(s => ({ ...s }));

    Utils.openModal({
      title: isNew ? 'Add Person' : 'Edit Person',
      wide: true,
      bodyHtml: personFormHtml(draft),
      footerHtml: `<button class="btn-secondary" data-close>Cancel</button><button class="btn-primary" id="wfSavePerson">${isNew ? 'Add Person' : 'Save Changes'}</button>`,
      onMount: (root, close) => {
        renderSkillRows(root);
        root.querySelector('#wfAddSkillRow').addEventListener('click', () => {
          const skills = DataStore.getSkills();
          if (!skills.length) { Utils.toast('Add a skill in Roles & Skills first'); return; }
          skillsDraft.push({ skillId: skills[0].id, proficiency: 1 });
          renderSkillRows(root);
        });
        root.querySelector('[data-close]').addEventListener('click', close);
        root.querySelector('#wfSavePerson').addEventListener('click', () => {
          const name = root.querySelector('#pf_name').value.trim();
          if (!name) { Utils.toast('Name is required'); return; }
          const hoursPerDay = Number(root.querySelector('#pf_hoursPerDay').value) || 0;
          const hoursPerWeek = Number(root.querySelector('#pf_hoursPerWeek').value) || 0;
          if (hoursPerDay < 0 || hoursPerWeek < 0) { Utils.toast('Working hours cannot be negative'); return; }
          const startDate = root.querySelector('#pf_startDate').value || null;
          const endDate = root.querySelector('#pf_endDate').value || null;
          if (startDate && endDate && endDate < startDate) { Utils.toast('End date must be after start date'); return; }
          // de-dupe skills by skillId, keep last-set proficiency
          const seen = new Map();
          skillsDraft.forEach(s => { if (s.skillId) seen.set(s.skillId, { skillId: s.skillId, proficiency: Number(s.proficiency) || 1 }); });

          const data = {
            name, email: root.querySelector('#pf_email').value.trim(),
            jobTitle: root.querySelector('#pf_jobTitle').value.trim(),
            roleId: root.querySelector('#pf_roleId').value || null,
            department: root.querySelector('#pf_department').value.trim(),
            managerId: root.querySelector('#pf_managerId').value || null,
            location: root.querySelector('#pf_location').value.trim(),
            status: root.querySelector('#pf_status').value,
            startDate, endDate, hoursPerDay, hoursPerWeek,
            skills: [...seen.values()]
          };
          const members = DataStore.getMembers();
          if (isNew) {
            DataStore.setMembers([...members, { id: Utils.uid('mem'), ...data, createdAt: Date.now() }]);
            Utils.toast(`Added ${name}`);
          } else {
            DataStore.setMembers(members.map(m => m.id === person.id ? { ...m, ...data } : m));
            Utils.toast('Person updated');
          }
          close();
        });
      }
    });

    function renderSkillRows(root) {
      const host = root.querySelector('#wfSkillRows');
      const skills = DataStore.getSkills();
      if (!skillsDraft.length) {
        host.innerHTML = `<div class="text-faint" style="font-size:12px;">No skills added yet.</div>`;
      } else {
        host.innerHTML = skillsDraft.map((s, i) => `
          <div class="flex gap-8" style="align-items:center; margin-bottom:6px;" data-skill-idx="${i}">
            <select data-skill-id style="flex:1;">${skills.map(sk => `<option value="${sk.id}" ${s.skillId === sk.id ? 'selected' : ''}>${Utils.escapeHtml(sk.name)}</option>`).join('')}</select>
            <select data-skill-prof style="width:140px;">${[1, 2, 3, 4].map(p => `<option value="${p}" ${Number(s.proficiency) === p ? 'selected' : ''}>${PROFICIENCY_LABEL[p]}</option>`).join('')}</select>
            <button type="button" class="btn-ghost" data-remove-skill="${i}" style="color:#C8393A;">🗑</button>
          </div>`).join('');
      }
      host.querySelectorAll('[data-skill-id]').forEach((sel, i) => sel.addEventListener('change', e => { skillsDraft[i].skillId = e.target.value; }));
      host.querySelectorAll('[data-skill-prof]').forEach((sel, i) => sel.addEventListener('change', e => { skillsDraft[i].proficiency = Number(e.target.value); }));
      host.querySelectorAll('[data-remove-skill]').forEach(btn => btn.addEventListener('click', () => { skillsDraft.splice(Number(btn.dataset.removeSkill), 1); renderSkillRows(root); }));
    }
  }

  function personFormHtml(m) {
    const others = DataStore.getMembers().filter(x => x.id !== m.id);
    return `
      <div class="form-grid">
        <div class="form-field"><label>Full Name *</label><input type="text" id="pf_name" value="${Utils.escapeHtml(m.name || '')}"></div>
        <div class="form-field"><label>Email</label><input type="email" id="pf_email" value="${Utils.escapeHtml(m.email || '')}"></div>
        <div class="form-field"><label>Job Title</label><input type="text" id="pf_jobTitle" value="${Utils.escapeHtml(m.jobTitle || '')}"></div>
        <div class="form-field"><label>Role</label><select id="pf_roleId">${Utils.workforceRoleOptionsHtml(m.roleId)}</select></div>
        <div class="form-field"><label>Department</label><input type="text" id="pf_department" value="${Utils.escapeHtml(m.department || '')}"></div>
        <div class="form-field"><label>Manager</label><select id="pf_managerId"><option value="">No manager</option>${others.map(o => `<option value="${o.id}" ${m.managerId === o.id ? 'selected' : ''}>${Utils.escapeHtml(o.name)}</option>`).join('')}</select></div>
        <div class="form-field"><label>Location</label><input type="text" id="pf_location" value="${Utils.escapeHtml(m.location || '')}"></div>
        <div class="form-field"><label>Status</label><select id="pf_status">${STATUS_OPTIONS.map(s => `<option value="${s}" ${m.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="form-field"><label>Start Date</label><input type="date" id="pf_startDate" value="${m.startDate || ''}"></div>
        <div class="form-field"><label>End Date</label><input type="date" id="pf_endDate" value="${m.endDate || ''}"></div>
        <div class="form-field"><label>Working Hours / Day</label><input type="number" id="pf_hoursPerDay" min="0" max="24" step="0.5" value="${m.hoursPerDay ?? 8}"></div>
        <div class="form-field"><label>Working Hours / Week</label><input type="number" id="pf_hoursPerWeek" min="0" max="168" step="0.5" value="${m.hoursPerWeek ?? 40}"></div>
      </div>
      <div class="panel__title" style="margin-top:16px;">Skills</div>
      <div id="wfSkillRows"></div>
      <button type="button" class="btn-secondary btn-sm" id="wfAddSkillRow" style="margin-top:6px;">+ Add Skill</button>
    `;
  }

  function deletePerson(id) {
    const m = memberById(id);
    if (!m) return;
    if (!confirm(`Remove ${m.name} from People? Projects/tasks already assigned to them won't change, and their existing allocations will be removed.`)) return;
    DataStore.setMembers(DataStore.getMembers().filter(x => x.id !== id));
    DataStore.setAllocations(DataStore.getAllocations().filter(a => a.memberId !== id));
    DataStore.setLeaveRecords(DataStore.getLeaveRecords().filter(l => l.memberId !== id));
    Utils.toast(`Removed ${m.name}`);
  }

  /* =====================================================================
     ROLES & SKILLS
     ===================================================================== */
  function renderRolesSkills(body) {
    const roles = DataStore.getRoles().slice().sort((a, b) => a.name.localeCompare(b.name));
    const skills = DataStore.getSkills().slice().sort((a, b) => a.name.localeCompare(b.name));
    body.innerHTML = `
      <div class="admin-grid">
        <div class="card panel">
          <div class="panel__title">Roles</div>
          <div class="text-soft" style="font-size:12px; margin-bottom:14px;">Job & project roles (e.g. Project Manager, Developer, Tester). Used on People profiles and project Allocations.</div>
          <form id="wfAddRoleForm" style="display:flex; gap:8px; margin-bottom:14px;">
            <div class="form-field" style="flex:1; margin:0;"><input type="text" id="wfRoleInput" placeholder="Role name" autocomplete="off"></div>
            <button type="submit" class="btn-primary btn-sm">+ Add Role</button>
          </form>
          <div>${roles.length ? roles.map(r => listRowHtml(r, 'role')).join('') : `<div class="empty-state" style="padding:30px 20px;"><div class="empty-state__icon">🧭</div><div>No roles yet</div></div>`}</div>
        </div>
        <div class="card panel">
          <div class="panel__title">Skills</div>
          <div class="text-soft" style="font-size:12px; margin-bottom:14px;">Configurable skill list (e.g. SQL, Python, Power BI). Assign to people with a proficiency level.</div>
          <form id="wfAddSkillForm" style="display:flex; gap:8px; margin-bottom:14px;">
            <div class="form-field" style="flex:1; margin:0;"><input type="text" id="wfSkillInput" placeholder="Skill name" autocomplete="off"></div>
            <button type="submit" class="btn-primary btn-sm">+ Add Skill</button>
          </form>
          <div>${skills.length ? skills.map(s => listRowHtml(s, 'skill')).join('') : `<div class="empty-state" style="padding:30px 20px;"><div class="empty-state__icon">🧩</div><div>No skills yet</div></div>`}</div>
        </div>
      </div>
    `;

    body.querySelector('#wfAddRoleForm').addEventListener('submit', e => {
      e.preventDefault();
      const input = body.querySelector('#wfRoleInput');
      const name = input.value.trim();
      if (!name) return;
      const roles2 = DataStore.getRoles();
      if (roles2.some(r => r.name.toLowerCase() === name.toLowerCase())) { Utils.toast(`"${name}" already exists`); return; }
      DataStore.setRoles([...roles2, { id: Utils.uid('role'), name, createdAt: Date.now() }]);
      Utils.toast(`Added role "${name}"`);
      input.value = '';
    });
    body.querySelector('#wfAddSkillForm').addEventListener('submit', e => {
      e.preventDefault();
      const input = body.querySelector('#wfSkillInput');
      const name = input.value.trim();
      if (!name) return;
      const skills2 = DataStore.getSkills();
      if (skills2.some(s => s.name.toLowerCase() === name.toLowerCase())) { Utils.toast(`"${name}" already exists`); return; }
      DataStore.setSkills([...skills2, { id: Utils.uid('skill'), name, createdAt: Date.now() }]);
      Utils.toast(`Added skill "${name}"`);
      input.value = '';
    });

    body.querySelectorAll('[data-remove-role]').forEach(btn => btn.addEventListener('click', () => removeRole(btn.dataset.removeRole)));
    body.querySelectorAll('[data-remove-skill-def]').forEach(btn => btn.addEventListener('click', () => removeSkillDef(btn.dataset.removeSkillDef)));
  }

  function listRowHtml(item, kind) {
    return `<div class="milestone-item" data-id="${item.id}">
      <div style="display:flex; align-items:center; gap:10px; min-width:0;">
        <span class="avatar">${Utils.initials(item.name)}</span>
        <span style="font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${Utils.escapeHtml(item.name)}</span>
      </div>
      <button class="btn-ghost" data-${kind === 'role' ? 'remove-role' : 'remove-skill-def'}="${item.id}" title="Remove" style="color:#C8393A;">🗑</button>
    </div>`;
  }

  function removeRole(id) {
    const r = roleById(id);
    if (!r) return;
    const inUse = DataStore.getMembers().filter(m => m.roleId === id).length;
    if (!confirm(`Remove role "${r.name}"?${inUse ? ` ${inUse} people currently have this role — they'll be left without one.` : ''}`)) return;
    DataStore.setRoles(DataStore.getRoles().filter(x => x.id !== id));
    DataStore.setMembers(DataStore.getMembers().map(m => m.roleId === id ? { ...m, roleId: null } : m));
    DataStore.setAllocations(DataStore.getAllocations().map(a => a.roleId === id ? { ...a, roleId: null } : a));
    Utils.toast(`Removed role "${r.name}"`);
  }

  function removeSkillDef(id) {
    const s = skillById(id);
    if (!s) return;
    const inUse = DataStore.getMembers().filter(m => (m.skills || []).some(x => x.skillId === id)).length;
    if (!confirm(`Remove skill "${s.name}"?${inUse ? ` ${inUse} people have this skill on their profile — it will be removed from them too.` : ''}`)) return;
    DataStore.setSkills(DataStore.getSkills().filter(x => x.id !== id));
    DataStore.setMembers(DataStore.getMembers().map(m => ({ ...m, skills: (m.skills || []).filter(x => x.skillId !== id) })));
    Utils.toast(`Removed skill "${s.name}"`);
  }

  /* =====================================================================
     ALLOCATIONS
     ===================================================================== */
  function filteredAllocations() {
    return DataStore.getAllocations().filter(a => {
      if (allocFilters.memberId && a.memberId !== allocFilters.memberId) return false;
      if (allocFilters.projectId && a.projectId !== allocFilters.projectId) return false;
      if (allocFilters.onlyOver && WorkforceCapacity.currentAllocationPercent(a.memberId) <= 100) return false;
      return true;
    }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  function renderAllocations(body) {
    const list = filteredAllocations();
    const members = activeMembers();
    const projects = DataStore.getProjects().filter(p => !p.archived);

    // Summary: current allocation % by person (today), across all their allocations.
    const summaryPeople = members
      .map(m => ({ m, pct: WorkforceCapacity.currentAllocationPercent(m.id) }))
      .filter(x => x.pct > 0)
      .sort((a, b) => b.pct - a.pct);

    body.innerHTML = `
      ${summaryPeople.length ? `
      <div class="panel__title">Current Allocation by Person</div>
      <div class="card panel" style="margin-bottom:20px;">
        ${summaryPeople.map(({ m, pct }) => {
          const over = pct > 100;
          const parts = DataStore.getAllocations().filter(a => a.memberId === m.id && a.startDate <= Utils.todayISO() && (a.endDate || a.startDate) >= Utils.todayISO());
          return `<div style="padding:8px 0; border-bottom:1px solid var(--border-soft);">
            <div class="flex gap-8" style="justify-content:space-between; align-items:center;">
              <div><span class="avatar">${Utils.initials(m.name)}</span> <strong>${Utils.escapeHtml(m.name)}</strong></div>
              <span class="badge ${over ? 'badge--status-cancelled' : 'badge--status-completed'}">${pct}%${over ? ' — Overallocated' : ''}</span>
            </div>
            <div class="text-faint" style="font-size:12px; margin-top:4px;">${parts.map(p => `${Utils.escapeHtml(projectById(p.projectId)?.name || 'Unknown project')} ${p.allocationPercent || 0}%`).join(' · ')}</div>
          </div>`;
        }).join('')}
      </div>` : ''}

      <div class="toolbar">
        <select id="wfAllocMember"><option value="">All people</option>${members.map(m => `<option value="${m.id}" ${allocFilters.memberId === m.id ? 'selected' : ''}>${Utils.escapeHtml(m.name)}</option>`).join('')}</select>
        <select id="wfAllocProject"><option value="">All projects</option>${projects.map(p => `<option value="${p.id}" ${allocFilters.projectId === p.id ? 'selected' : ''}>${Utils.escapeHtml(p.name)}</option>`).join('')}</select>
        <label class="flex gap-8" style="align-items:center; font-size:13px;"><input type="checkbox" id="wfAllocOver" ${allocFilters.onlyOver ? 'checked' : ''}> Only overallocated</label>
        <div style="flex:1;"></div>
        <button class="btn-primary btn-sm" id="wfAddAllocBtn">+ Add Allocation</button>
      </div>
      ${list.length ? `<div class="table-scroll"><table class="data-table">
        <thead><tr><th>Person</th><th>Project</th><th>Project Role</th><th>Dates</th><th>Allocation</th><th>Planned Hrs</th><th>Notes</th><th></th></tr></thead>
        <tbody>
          ${list.map(a => {
            const m = memberById(a.memberId), p = projectById(a.projectId);
            return `<tr>
              <td>${m ? `<span class="avatar">${Utils.initials(m.name)}</span> ${Utils.escapeHtml(m.name)}` : '<span class="text-faint">Removed person</span>'}</td>
              <td>${p ? Utils.escapeHtml(p.name) : '<span class="text-faint">Removed project</span>'}</td>
              <td>${Utils.escapeHtml(roleName(a.roleId) || '—')}</td>
              <td>${Utils.fmtDate(a.startDate)} – ${Utils.fmtDate(a.endDate || a.startDate)}</td>
              <td>${a.allocationPercent ? a.allocationPercent + '%' : '—'}</td>
              <td>${a.plannedHours ? a.plannedHours + 'h' : '—'}</td>
              <td class="text-faint" style="max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${Utils.escapeHtml(a.notes || '')}</td>
              <td style="white-space:nowrap;"><button class="btn-ghost" data-edit-alloc="${a.id}" title="Edit">✏</button><button class="btn-ghost" data-del-alloc="${a.id}" title="Delete" style="color:#C8393A;">🗑</button></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>` : emptyState('📌', 'No allocations match', 'Add an allocation to assign someone to a project.')}
    `;

    document.getElementById('wfAllocMember').addEventListener('change', e => { allocFilters.memberId = e.target.value; renderAllocations(body); });
    document.getElementById('wfAllocProject').addEventListener('change', e => { allocFilters.projectId = e.target.value; renderAllocations(body); });
    document.getElementById('wfAllocOver').addEventListener('change', e => { allocFilters.onlyOver = e.target.checked; renderAllocations(body); });
    document.getElementById('wfAddAllocBtn').addEventListener('click', () => openAllocationModal(null));
    body.querySelectorAll('[data-edit-alloc]').forEach(btn => btn.addEventListener('click', () => openAllocationModal(DataStore.getAllocations().find(a => a.id === btn.dataset.editAlloc))));
    body.querySelectorAll('[data-del-alloc]').forEach(btn => btn.addEventListener('click', () => deleteAllocation(btn.dataset.delAlloc)));
  }

  function openAllocationModal(alloc) {
    const isNew = !alloc;
    const members = activeMembers();
    const projects = DataStore.getProjects().filter(p => !p.archived);
    if (!members.length || !projects.length) { Utils.toast('Add at least one person and one project first'); return; }
    const draft = alloc || { memberId: allocFilters.memberId || members[0].id, projectId: allocFilters.projectId || projects[0].id, startDate: Utils.todayISO(), endDate: Utils.todayISO() };

    Utils.openModal({
      title: isNew ? 'Add Allocation' : 'Edit Allocation',
      bodyHtml: `
        <div class="form-grid">
          <div class="form-field"><label>Person</label><select id="af_member">${members.map(m => `<option value="${m.id}" ${draft.memberId === m.id ? 'selected' : ''}>${Utils.escapeHtml(m.name)}</option>`).join('')}</select></div>
          <div class="form-field"><label>Project</label><select id="af_project">${projects.map(p => `<option value="${p.id}" ${draft.projectId === p.id ? 'selected' : ''}>${Utils.escapeHtml(p.name)}</option>`).join('')}</select></div>
          <div class="form-field"><label>Project Role</label><select id="af_role">${Utils.workforceRoleOptionsHtml(draft.roleId, 'No specific role')}</select></div>
          <div class="form-field"><label>Start Date</label><input type="date" id="af_start" value="${draft.startDate || ''}"></div>
          <div class="form-field"><label>End Date</label><input type="date" id="af_end" value="${draft.endDate || draft.startDate || ''}"></div>
          <div class="form-field"><label>Allocation %</label><input type="number" id="af_pct" min="0" max="500" step="5" value="${draft.allocationPercent ?? ''}" placeholder="e.g. 60"></div>
          <div class="form-field"><label>Planned Hours (total)</label><input type="number" id="af_hours" min="0" step="1" value="${draft.plannedHours ?? ''}" placeholder="optional"></div>
          <div class="form-field span-2"><label>Notes</label><textarea id="af_notes">${Utils.escapeHtml(draft.notes || '')}</textarea></div>
        </div>
      `,
      footerHtml: `<button class="btn-secondary" data-close>Cancel</button><button class="btn-primary" id="wfSaveAlloc">${isNew ? 'Add Allocation' : 'Save Changes'}</button>`,
      onMount: (root, close) => {
        root.querySelector('[data-close]').addEventListener('click', close);
        root.querySelector('#wfSaveAlloc').addEventListener('click', () => {
          const startDate = root.querySelector('#af_start').value;
          const endDate = root.querySelector('#af_end').value || startDate;
          if (!startDate) { Utils.toast('Start date is required'); return; }
          if (endDate < startDate) { Utils.toast('End date must be on or after the start date'); return; }
          const pctRaw = root.querySelector('#af_pct').value;
          const hoursRaw = root.querySelector('#af_hours').value;
          const allocationPercent = pctRaw === '' ? null : Number(pctRaw);
          const plannedHours = hoursRaw === '' ? null : Number(hoursRaw);
          if ((allocationPercent !== null && allocationPercent < 0) || (plannedHours !== null && plannedHours < 0)) { Utils.toast('Allocation cannot be negative'); return; }
          if (allocationPercent === null && plannedHours === null) { Utils.toast('Enter an allocation % or planned hours'); return; }
          const memberId = root.querySelector('#af_member').value;
          const data = {
            memberId, projectId: root.querySelector('#af_project').value,
            roleId: root.querySelector('#af_role').value || null,
            startDate, endDate, allocationPercent, plannedHours,
            notes: root.querySelector('#af_notes').value.trim()
          };
          const allocations = DataStore.getAllocations();
          if (isNew) {
            DataStore.setAllocations([...allocations, { id: Utils.uid('alloc'), ...data, createdAt: Date.now() }]);
            Utils.toast('Allocation added');
          } else {
            DataStore.setAllocations(allocations.map(a => a.id === alloc.id ? { ...a, ...data } : a));
            Utils.toast('Allocation updated');
          }
          warnIfOverallocated(memberId);
          close();
        });
      }
    });
  }

  function deleteAllocation(id) {
    const a = DataStore.getAllocations().find(x => x.id === id);
    if (!a) return;
    if (!confirm('Delete this allocation?')) return;
    DataStore.setAllocations(DataStore.getAllocations().filter(x => x.id !== id));
    Utils.toast('Allocation deleted');
  }

  // Non-blocking overallocation warning — used by Allocations save above
  // and by Tasks.js when an assignee is set/changed on a task.
  function warnIfOverallocated(memberId) {
    const m = memberById(memberId);
    if (!m) return;
    const pct = WorkforceCapacity.currentAllocationPercent(m.id);
    if (pct > 100) Utils.toast(`${m.name} is now at ${pct}% allocation across active projects`, { tone: 'danger' });
  }
  function warnIfOverallocatedByName(name) {
    const m = DataStore.getMembers().find(x => x.name === name);
    if (m) warnIfOverallocated(m.id);
  }

  /* =====================================================================
     LEAVE & HOLIDAYS
     ===================================================================== */
  function renderLeaveHolidays(body) {
    body.innerHTML = `
      <div class="view-toggle" style="margin-bottom:16px; width:fit-content;">
        <button data-sub="leave" class="${leaveSubTab === 'leave' ? 'is-active' : ''}">Leave</button>
        <button data-sub="holidays" class="${leaveSubTab === 'holidays' ? 'is-active' : ''}">Holidays</button>
      </div>
      <div id="wfLeaveSubBody"></div>
    `;
    body.querySelectorAll('.view-toggle button').forEach(btn => btn.addEventListener('click', () => { leaveSubTab = btn.dataset.sub; renderLeaveHolidays(body); }));
    const sub = body.querySelector('#wfLeaveSubBody');
    if (leaveSubTab === 'leave') renderLeaveList(sub); else renderHolidayList(sub);
  }

  function renderLeaveList(body) {
    const records = DataStore.getLeaveRecords().slice().sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
    body.innerHTML = `
      <div class="toolbar"><div style="flex:1;"></div><button class="btn-primary btn-sm" id="wfAddLeaveBtn">+ Add Leave</button></div>
      ${records.length ? `<div class="table-scroll"><table class="data-table">
        <thead><tr><th>Person</th><th>Type</th><th>Dates</th><th>Hours</th><th>Status</th><th>Notes</th><th></th></tr></thead>
        <tbody>
          ${records.map(l => {
            const m = memberById(l.memberId);
            const statusCls = l.status === 'Approved' ? 'badge--status-completed' : l.status === 'Rejected' ? 'badge--status-cancelled' : 'badge--status-onhold';
            return `<tr>
              <td>${m ? Utils.escapeHtml(m.name) : '<span class="text-faint">Removed person</span>'}</td>
              <td>${Utils.escapeHtml(l.type)}</td>
              <td>${Utils.fmtDate(l.startDate)} – ${Utils.fmtDate(l.endDate || l.startDate)}</td>
              <td>${l.hours ? l.hours + 'h' : '—'}</td>
              <td><span class="badge ${statusCls}">${l.status}</span></td>
              <td class="text-faint" style="max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${Utils.escapeHtml(l.notes || '')}</td>
              <td style="white-space:nowrap;"><button class="btn-ghost" data-edit-leave="${l.id}" title="Edit">✏</button><button class="btn-ghost" data-del-leave="${l.id}" title="Delete" style="color:#C8393A;">🗑</button></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>` : emptyState('🌴', 'No leave records yet')}
    `;
    document.getElementById('wfAddLeaveBtn').addEventListener('click', () => openLeaveModal(null));
    body.querySelectorAll('[data-edit-leave]').forEach(btn => btn.addEventListener('click', () => openLeaveModal(DataStore.getLeaveRecords().find(l => l.id === btn.dataset.editLeave))));
    body.querySelectorAll('[data-del-leave]').forEach(btn => btn.addEventListener('click', () => {
      if (!confirm('Delete this leave record?')) return;
      DataStore.setLeaveRecords(DataStore.getLeaveRecords().filter(l => l.id !== btn.dataset.delLeave));
      Utils.toast('Leave record deleted');
    }));
  }

  function openLeaveModal(leave) {
    const isNew = !leave;
    const members = activeMembers();
    if (!members.length) { Utils.toast('Add a person first'); return; }
    const draft = leave || { memberId: members[0].id, type: 'Vacation', status: 'Approved', startDate: Utils.todayISO(), endDate: Utils.todayISO() };
    Utils.openModal({
      title: isNew ? 'Add Leave' : 'Edit Leave',
      bodyHtml: `
        <div class="form-grid">
          <div class="form-field"><label>Person</label><select id="lf_member">${members.map(m => `<option value="${m.id}" ${draft.memberId === m.id ? 'selected' : ''}>${Utils.escapeHtml(m.name)}</option>`).join('')}</select></div>
          <div class="form-field"><label>Type</label><select id="lf_type">${LEAVE_TYPES.map(t => `<option value="${t}" ${draft.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          <div class="form-field"><label>Start Date</label><input type="date" id="lf_start" value="${draft.startDate || ''}"></div>
          <div class="form-field"><label>End Date</label><input type="date" id="lf_end" value="${draft.endDate || draft.startDate || ''}"></div>
          <div class="form-field"><label>Hours (optional)</label><input type="number" id="lf_hours" min="0" step="0.5" value="${draft.hours ?? ''}" placeholder="Leave blank to use working days × hours/day"></div>
          <div class="form-field"><label>Status</label><select id="lf_status">${LEAVE_STATUSES.map(s => `<option value="${s}" ${draft.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
          <div class="form-field span-2"><label>Notes</label><textarea id="lf_notes">${Utils.escapeHtml(draft.notes || '')}</textarea></div>
        </div>
      `,
      footerHtml: `<button class="btn-secondary" data-close>Cancel</button><button class="btn-primary" id="wfSaveLeave">${isNew ? 'Add Leave' : 'Save Changes'}</button>`,
      onMount: (root, close) => {
        root.querySelector('[data-close]').addEventListener('click', close);
        root.querySelector('#wfSaveLeave').addEventListener('click', () => {
          const startDate = root.querySelector('#lf_start').value;
          const endDate = root.querySelector('#lf_end').value || startDate;
          if (!startDate) { Utils.toast('Start date is required'); return; }
          if (endDate < startDate) { Utils.toast('End date must be on or after the start date'); return; }
          const hoursRaw = root.querySelector('#lf_hours').value;
          if (hoursRaw !== '' && Number(hoursRaw) < 0) { Utils.toast('Hours cannot be negative'); return; }
          const data = {
            memberId: root.querySelector('#lf_member').value, type: root.querySelector('#lf_type').value,
            startDate, endDate, hours: hoursRaw === '' ? null : Number(hoursRaw),
            status: root.querySelector('#lf_status').value, notes: root.querySelector('#lf_notes').value.trim()
          };
          const records = DataStore.getLeaveRecords();
          if (isNew) { DataStore.setLeaveRecords([...records, { id: Utils.uid('leave'), ...data, createdAt: Date.now() }]); Utils.toast('Leave added'); }
          else { DataStore.setLeaveRecords(records.map(l => l.id === leave.id ? { ...l, ...data } : l)); Utils.toast('Leave updated'); }
          close();
        });
      }
    });
  }

  function renderHolidayList(body) {
    const holidays = DataStore.getHolidays().slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    body.innerHTML = `
      <div class="toolbar"><div style="flex:1;"></div><button class="btn-primary btn-sm" id="wfAddHolidayBtn">+ Add Holiday</button></div>
      ${holidays.length ? `<div class="table-scroll"><table class="data-table">
        <thead><tr><th>Name</th><th>Date</th><th>Location</th><th></th></tr></thead>
        <tbody>${holidays.map(h => `<tr>
          <td>${Utils.escapeHtml(h.name)}</td><td>${Utils.fmtDate(h.date)}</td><td>${Utils.escapeHtml(h.location || 'All locations')}</td>
          <td style="white-space:nowrap;"><button class="btn-ghost" data-del-holiday="${h.id}" title="Delete" style="color:#C8393A;">🗑</button></td>
        </tr>`).join('')}</tbody>
      </table></div>` : emptyState('🏖', 'No holidays configured yet')}
    `;
    document.getElementById('wfAddHolidayBtn').addEventListener('click', () => openHolidayModal());
    body.querySelectorAll('[data-del-holiday]').forEach(btn => btn.addEventListener('click', () => {
      if (!confirm('Delete this holiday?')) return;
      DataStore.setHolidays(DataStore.getHolidays().filter(h => h.id !== btn.dataset.delHoliday));
      Utils.toast('Holiday deleted');
    }));
  }

  function openHolidayModal() {
    Utils.openModal({
      title: 'Add Holiday',
      bodyHtml: `
        <div class="form-grid">
          <div class="form-field"><label>Name</label><input type="text" id="hf_name" placeholder="e.g. Diwali"></div>
          <div class="form-field"><label>Date</label><input type="date" id="hf_date" value="${Utils.todayISO()}"></div>
          <div class="form-field span-2"><label>Location (optional)</label><input type="text" id="hf_location" placeholder="Leave blank to apply to all locations"></div>
        </div>
      `,
      footerHtml: `<button class="btn-secondary" data-close>Cancel</button><button class="btn-primary" id="wfSaveHoliday">Add Holiday</button>`,
      onMount: (root, close) => {
        root.querySelector('[data-close]').addEventListener('click', close);
        root.querySelector('#wfSaveHoliday').addEventListener('click', () => {
          const name = root.querySelector('#hf_name').value.trim();
          const date = root.querySelector('#hf_date').value;
          if (!name || !date) { Utils.toast('Name and date are required'); return; }
          DataStore.setHolidays([...DataStore.getHolidays(), {
            id: Utils.uid('hol'), name, date, location: root.querySelector('#hf_location').value.trim(), createdAt: Date.now()
          }]);
          Utils.toast(`Added holiday "${name}"`);
          close();
        });
      }
    });
  }

  /* =====================================================================
     PROJECT INTEGRATION — "Project Resources" panel embedded in the
     Projects module's detail modal (see projects.js).
     ===================================================================== */
  function renderProjectResources(host, projectId) {
    if (!host) return;
    const allocs = DataStore.getAllocations().filter(a => a.projectId === projectId);
    host.innerHTML = `
      <div class="panel__title" style="margin-top:20px; display:flex; align-items:center; justify-content:space-between;">
        <span>Project Resources (${allocs.length})</span>
        <button class="btn-secondary btn-sm" id="wfGoToAllocBtn">Manage in Workforce Planning</button>
      </div>
      ${allocs.length ? `<div class="table-scroll"><table class="data-table">
        <thead><tr><th>Person</th><th>Project Role</th><th>Dates</th><th>Allocation</th><th>Planned Hrs</th></tr></thead>
        <tbody>${allocs.map(a => {
          const m = memberById(a.memberId);
          const pct = m ? WorkforceCapacity.currentAllocationPercent(m.id) : 0;
          return `<tr>
            <td>${m ? `<span class="avatar">${Utils.initials(m.name)}</span> ${Utils.escapeHtml(m.name)}` : '<span class="text-faint">Removed person</span>'} ${pct > 100 ? '<span title="Overallocated">⚠</span>' : ''}</td>
            <td>${Utils.escapeHtml(roleName(a.roleId) || '—')}</td>
            <td>${Utils.fmtDate(a.startDate)} – ${Utils.fmtDate(a.endDate || a.startDate)}</td>
            <td>${a.allocationPercent ? a.allocationPercent + '%' : '—'}</td>
            <td>${a.plannedHours ? a.plannedHours + 'h' : '—'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>` : `<div class="text-faint">No one is allocated to this project yet.</div>`}
    `;
    const btn = host.querySelector('#wfGoToAllocBtn');
    if (btn) btn.addEventListener('click', () => {
      const modalRoot = document.getElementById('modalRoot');
      if (modalRoot) { modalRoot.classList.remove('is-open'); modalRoot.innerHTML = ''; }
      App.navigate('workforce', { projectId });
    });
  }

  return {
    render, refresh, renderProjectResources,
    warnIfOverallocated, warnIfOverallocatedByName
  };
})();
