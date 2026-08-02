/* ============================================================
   ADMIN.JS - manage Managers (Owner dropdown) and Team Members
   (Assignee dropdown)
   ============================================================ */

const Admin = (() => {

  function render(main) {
    const members = DataStore.getMembers();
    const managers = members.filter(m => m.role === 'manager').sort((a, b) => a.name.localeCompare(b.name));
    const staff = members.filter(m => m.role === 'member').sort((a, b) => a.name.localeCompare(b.name));

    main.innerHTML = `
      <div class="view-header">
        <div>
          <div class="view-header__title">Admin</div>
          <div class="view-header__subtitle">Manage who can own projects and who tasks can be assigned to</div>
        </div>
      </div>
      <div class="admin-grid">
        ${roleCardHtml('manager', 'Managers', 'Managers appear in the Owner dropdown on Projects and Portfolios.', managers)}
        ${roleCardHtml('member', 'Team Members', 'Team members appear in the Assigned To dropdown on Tasks.', staff)}
      </div>
    `;

    bindRoleCard(main, 'manager');
    bindRoleCard(main, 'member');
  }

  function roleCardHtml(role, title, subtitle, list) {
    return `
      <div class="card panel">
        <div class="panel__title">${title}</div>
        <div class="text-soft" style="font-size:12px; margin-bottom:14px;">${subtitle}</div>
        <form class="admin-add-form" data-role="${role}" style="display:flex; gap:8px; margin-bottom:14px;">
          <div class="form-field" style="flex:1; margin:0;">
            <input type="text" data-input="${role}" placeholder="Full name" autocomplete="off">
          </div>
          <button type="submit" class="btn-primary btn-sm" style="white-space:nowrap;">+ Add ${role === 'manager' ? 'Manager' : 'Member'}</button>
        </form>
        <div data-list="${role}">
          ${list.length ? list.map(m => memberRowHtml(m)).join('') : emptyStateHtml(role)}
        </div>
      </div>
    `;
  }

  function memberRowHtml(m) {
    return `
      <div class="milestone-item" data-id="${m.id}">
        <div style="display:flex; align-items:center; gap:10px; min-width:0;">
          <span class="avatar">${Utils.initials(m.name)}</span>
          <span style="font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${Utils.escapeHtml(m.name)}</span>
        </div>
        <button class="btn-ghost" data-remove="${m.id}" title="Remove" style="color:#C8393A;">🗑</button>
      </div>
    `;
  }

  function emptyStateHtml(role) {
    return `
      <div class="empty-state" style="padding: 30px 20px;">
        <div class="empty-state__icon">${role === 'manager' ? '🧭' : '👥'}</div>
        <div>No ${role === 'manager' ? 'managers' : 'team members'} yet</div>
      </div>
    `;
  }

  function bindRoleCard(main, role) {
    const form = main.querySelector(`.admin-add-form[data-role="${role}"]`);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = form.querySelector(`[data-input="${role}"]`);
      const name = input.value.trim();
      if (!name) return;
      const members = DataStore.getMembers();
      const dupe = members.some(m => m.role === role && m.name.toLowerCase() === name.toLowerCase());
      if (dupe) {
        Utils.toast(`${name} is already ${role === 'manager' ? 'a manager' : 'a team member'}`);
        return;
      }
      const entry = { id: Utils.uid('mem'), name, role, createdAt: Date.now() };
      DataStore.setMembers([...members, entry]);
      Utils.toast(`Added ${name} as ${role === 'manager' ? 'a manager' : 'a team member'}`);
      input.value = '';
    });

    main.querySelectorAll(`[data-list="${role}"] [data-remove]`).forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.remove;
        const members = DataStore.getMembers();
        const target = members.find(m => m.id === id);
        if (!target) return;
        if (!confirm(`Remove ${target.name} from ${role === 'manager' ? 'Managers' : 'Team Members'}? Projects or tasks already assigned to them won't change.`)) return;
        DataStore.setMembers(members.filter(m => m.id !== id));
        Utils.toast(`Removed ${target.name}`);
      });
    });
  }

  return { render };
})();
