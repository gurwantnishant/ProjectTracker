/* ============================================================
   DASHBOARD.JS
   ============================================================ */

const Dashboard = (() => {

  let selectedProjectId = 'all';

  function statusClass(s) { return 'badge--status-' + s.toLowerCase().replace(/\s+/g, ''); }

  function flagFor(p) {
    if (p.status === 'Completed' || p.status === 'Cancelled') return null;
    const today = Utils.todayISO();
    const daysLeft = Utils.daysBetween(today, p.dueDate);
    if (daysLeft < 0) return { cls: 'flag--risk', label: '🔴 At Risk' };
    if (daysLeft <= 7) return { cls: 'flag--warning', label: '🟡 Warning' };
    return { cls: 'flag--ontrack', label: '🟢 On Track' };
  }

  function computeMetrics(projects, tasks) {
    const today = Utils.todayISO();
    const active = projects.filter(p => !p.archived && ['In Progress', 'Not Started', 'On Hold'].includes(p.status));
    const completed = projects.filter(p => p.status === 'Completed');
    const overdueTasks = tasks.filter(t => t.status !== 'Completed' && t.dueDate < today);
    const weekAhead = Utils.addDays(today, 7);
    const dueThisWeek = tasks.filter(t => t.status !== 'Completed' && t.dueDate >= today && t.dueDate <= weekAhead);
    const upcomingMilestones = (typeof Milestones !== 'undefined') ? Milestones.getUpcoming(14).length : 0;
    return {
      total: projects.filter(p => !p.archived).length,
      active: active.length,
      completed: completed.length,
      overdueTasks: overdueTasks.length,
      upcomingMilestones,
      dueThisWeek: dueThisWeek.length
    };
  }

  function metricCard(icon, label, value, colorKey, sub) {
    return `<div class="card metric-card metric-card--modern">
      <div class="metric-card__chip chip--${colorKey}">${icon}</div>
      <div class="metric-card__label">${label}</div>
      <div class="metric-card__value">${value}</div>
      ${sub ? `<div class="metric-card__sub text-faint">${sub}</div>` : ''}
    </div>`;
  }

  // ---- donut chart (SVG) ----
  function donutChart(segments, size = 160, centerLabel = 'projects') {
    const total = segments.reduce((s, x) => s + x.value, 0) || 1;
    const r = size / 2 - 14;
    const cx = size / 2, cy = size / 2;
    let angle = -90;
    const circumference = 2 * Math.PI * r;
    let paths = '';
    segments.forEach(seg => {
      const frac = seg.value / total;
      const dash = frac * circumference;
      paths += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${seg.color}" stroke-width="20"
        stroke-dasharray="${dash} ${circumference - dash}" stroke-dashoffset="${-angle / 360 * circumference}"
        transform="rotate(0 ${cx} ${cy})" stroke-linecap="butt"/>`;
      angle += frac * 360;
    });
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform: rotate(0deg);">
      ${paths}
      <text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="22" font-weight="800" fill="var(--ink)" font-family="var(--font-display)">${total}</text>
      <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="10.5" fill="var(--ink-faint)">${centerLabel}</text>
    </svg>`;
  }

  // ---- bar/line trend chart ----
  function trendChart(points, width = 480, height = 160) {
    const max = Math.max(1, ...points.map(p => p.value));
    const stepX = width / (points.length - 1 || 1);
    const coords = points.map((p, i) => {
      const x = i * stepX;
      const y = height - (p.value / max) * (height - 24) - 4;
      return [x, y];
    });
    const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c[0].toFixed(1)} ${c[1].toFixed(1)}`).join(' ');
    const areaPath = `${linePath} L ${coords[coords.length - 1][0]} ${height} L 0 ${height} Z`;
    const dots = coords.map((c, i) => `<circle cx="${c[0]}" cy="${c[1]}" r="3.5" fill="var(--primary)"><title>${points[i].label}: ${points[i].value}</title></circle>`).join('');
    const labels = points.map((p, i) => `<text x="${coords[i][0]}" y="${height + 16}" text-anchor="middle" font-size="9.5" fill="var(--ink-faint)">${p.label}</text>`).join('');
    return `<svg width="100%" height="${height + 28}" viewBox="0 0 ${width} ${height + 28}" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--primary)" stop-opacity="0.28"/>
          <stop offset="100%" stop-color="var(--primary)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${areaPath}" fill="url(#trendFill)"/>
      <path d="${linePath}" fill="none" stroke="var(--primary)" stroke-width="2.5"/>
      ${dots}
      ${labels}
    </svg>`;
  }

  function statusDonut(projects) {
    const today = Utils.todayISO();
    const buckets = { 'Not Started': 0, 'In Progress': 0, 'Completed': 0, 'At Risk': 0 };
    projects.filter(p => !p.archived).forEach(p => {
      if (p.status === 'Completed') buckets['Completed']++;
      else if (p.status === 'Not Started') buckets['Not Started']++;
      else if (p.dueDate < today || p.status === 'On Hold') buckets['At Risk']++;
      else buckets['In Progress']++;
    });
    const colors = { 'Not Started': '#9BA1B0', 'In Progress': '#5B5FEF', 'Completed': '#00C2A8', 'At Risk': '#FF6B6B' };
    const segments = Object.entries(buckets).map(([label, value]) => ({ label, value, color: colors[label] }));
    return { svg: donutChart(segments, 160, 'projects'), segments };
  }

  function taskStatusDonut(tasks) {
    const buckets = { 'Not Started': 0, 'In Progress': 0, 'Blocked': 0, 'Testing': 0, 'Completed': 0 };
    tasks.forEach(t => { if (t.status in buckets) buckets[t.status]++; });
    const colors = { 'Not Started': '#9BA1B0', 'In Progress': '#5B5FEF', 'Blocked': '#FF6B6B', 'Testing': '#B15CFF', 'Completed': '#00C2A8' };
    const segments = Object.entries(buckets).filter(([, v]) => v > 0).map(([label, value]) => ({ label, value, color: colors[label] }));
    if (!segments.length) segments.push({ label: 'No tasks', value: 1, color: '#E7E9F3' });
    return { svg: donutChart(segments, 160, 'tasks'), segments: Object.entries(buckets).map(([label, value]) => ({ label, value, color: colors[label] })) };
  }

  function completionTrend(tasks) {
    const weeks = 8;
    const points = [];
    for (let i = weeks - 1; i >= 0; i--) {
      const weekEnd = Utils.addDays(Utils.todayISO(), -7 * i);
      const weekStart = Utils.addDays(weekEnd, -6);
      const inWeek = tasks.filter(t => t.dueDate >= weekStart && t.dueDate <= weekEnd);
      const completed = inWeek.filter(t => t.status === 'Completed').length;
      const label = Utils.fmtDate(weekEnd);
      points.push({ label, value: completed });
    }
    return points;
  }

  // ============================================================
  //  Shared header: title + project selector
  // ============================================================
  function projectSelectorHtml(projects) {
    const sorted = [...projects].sort((a, b) => a.name.localeCompare(b.name));
    return `
      <div class="project-select-wrap">
        <select class="project-select" id="dashProjectSelect">
          <option value="all" ${selectedProjectId === 'all' ? 'selected' : ''}>📊 All Projects — Overview</option>
          ${sorted.map(p => `<option value="${p.id}" ${selectedProjectId === p.id ? 'selected' : ''}>${Utils.escapeHtml(p.name)}</option>`).join('')}
        </select>
      </div>`;
  }

  function render(main) {
    const allProjects = DataStore.getProjects().filter(p => !p.archived);
    if (selectedProjectId !== 'all' && !allProjects.find(p => p.id === selectedProjectId)) selectedProjectId = 'all';
    const viewingProject = selectedProjectId !== 'all' ? allProjects.find(p => p.id === selectedProjectId) : null;

    main.innerHTML = `
      <div class="view-header">
        <div>
          <div class="view-header__title">${viewingProject ? Utils.escapeHtml(viewingProject.name) : 'Welcome back 👋'}</div>
          <div class="view-header__subtitle">${viewingProject ? 'Everything critical about this project, at a glance.' : `Here's how your projects are tracking today, ${Utils.fmtDate(Utils.todayISO())}.`}</div>
        </div>
        <div class="view-header__actions">
          ${projectSelectorHtml(allProjects)}
          <button class="btn-secondary" id="dashEmailBtn">📧 Email Dashboard</button>
          <button class="btn-primary" id="dashNewProjectBtn">+ New Project</button>
        </div>
      </div>
      <div id="dashBodyHost"></div>
    `;

    document.getElementById('dashNewProjectBtn').addEventListener('click', () => Projects.openCreateModal());
    document.getElementById('dashEmailBtn').addEventListener('click', () => {
      const label = viewingProject ? viewingProject.name : 'All Projects';
      EmailExport.openModal(() => document.getElementById('dashBodyHost'), label);
    });
    const select = document.getElementById('dashProjectSelect');
    select.addEventListener('change', (e) => { selectedProjectId = e.target.value; App.navigate('dashboard'); });

    const body = document.getElementById('dashBodyHost');
    if (viewingProject) renderProjectView(body, viewingProject, allProjects);
    else renderOrgOverview(body, allProjects);
  }

  // ============================================================
  //  ALL PROJECTS — org-wide overview
  // ============================================================
  function renderOrgOverview(body, projects) {
    const tasks = DataStore.getTasks();
    const m = computeMetrics(projects, tasks);
    const { svg: donutSvg, segments } = statusDonut(projects);
    const trendPoints = completionTrend(tasks);

    body.innerHTML = `
      <div class="metric-grid">
        ${metricCard('📁', 'Total Projects', m.total, 'primary')}
        ${metricCard('🚀', 'Active Projects', m.active, 'sky')}
        ${metricCard('✅', 'Completed Projects', m.completed, 'teal')}
        ${metricCard('⏰', 'Overdue Tasks', m.overdueTasks, 'coral')}
        ${metricCard('🎯', 'Upcoming Milestones', m.upcomingMilestones, 'violet')}
        ${metricCard('📌', 'Tasks Due This Week', m.dueThisWeek, 'amber')}
      </div>

      <div class="dash-grid">
        <div class="card panel">
          <div class="panel__title">Task Completion Trend <span class="text-faint" style="font-weight:500; font-size:11.5px;">— tasks completed by due week</span></div>
          ${trendChart(trendPoints)}
        </div>
        <div class="card panel" style="display:flex; flex-direction:column; align-items:center;">
          <div class="panel__title mb-0" style="align-self:flex-start;">Project Status</div>
          ${donutSvg}
          <div class="legend">
            ${segments.map(s => `<div class="legend__item"><span class="legend__swatch" style="background:${s.color}"></span>${s.label} (${s.value})</div>`).join('')}
          </div>
        </div>
      </div>

      <div class="card panel">
        <div class="panel__title">Project Progress Overview <span class="text-faint" style="font-weight:500; font-size:11.5px;">— click a project to open its dashboard</span></div>
        <div id="progressOverview"></div>
      </div>

      <div class="card panel" style="margin-top: 16px;">
        <div class="panel__title">Upcoming Milestones <span class="text-faint" style="font-weight:500; font-size:11.5px;">— next 14 days</span></div>
        <div id="upcomingMilestonesList"></div>
      </div>
    `;

    const overview = document.getElementById('progressOverview');
    if (!projects.length) {
      overview.innerHTML = `<div class="empty-state"><div class="empty-state__icon">📁</div>No projects yet. Create your first one to see progress here.</div>`;
    } else {
      overview.innerHTML = projects.map(p => `
        <div class="progress-overview-row" data-project="${p.id}" style="margin-bottom: 14px; cursor:pointer;">
          <div class="flex" style="justify-content: space-between; margin-bottom: 6px; font-size: 12.5px;">
            <span class="flex gap-8"><span class="row-color-dot" style="background:${Utils.colorHex(p.color)}"></span><strong>${Utils.escapeHtml(p.name)}</strong></span>
            <span class="text-soft">${p.progress}%</span>
          </div>
          <div class="progress-bar" style="--card-color:${Utils.colorHex(p.color)}"><div class="progress-bar__fill" style="width:${p.progress}%"></div></div>
        </div>
      `).join('');
      overview.querySelectorAll('[data-project]').forEach(el => el.addEventListener('click', () => {
        selectedProjectId = el.dataset.project;
        App.navigate('dashboard');
      }));
    }

    const milestoneListEl = document.getElementById('upcomingMilestonesList');
    if (milestoneListEl) {
      const upcoming = typeof Milestones !== 'undefined' ? Milestones.getUpcoming(14) : [];
      if (!upcoming.length) {
        milestoneListEl.innerHTML = `<div class="text-faint">No milestones due in the next two weeks.</div>`;
      } else {
        milestoneListEl.innerHTML = upcoming.slice(0, 6).map(mi => {
          const proj = DataStore.getProjects().find(p => p.id === mi.projectId);
          return `<div class="milestone-item" data-project="${mi.projectId}" style="cursor:pointer;">
            <div class="flex gap-8">
              <span class="milestone-item__diamond" style="background:${Milestones.diamondColor(mi.status)}"></span>
              <div>
                <div style="font-weight:600; font-size:13px;">${Utils.escapeHtml(mi.name)}</div>
                <div class="text-faint" style="font-size:11.5px;">${Utils.escapeHtml(proj ? proj.name : 'Unknown project')} · ${Utils.escapeHtml(mi.owner || 'Unassigned')}</div>
              </div>
            </div>
            <span class="text-faint" style="font-size:12px;">${Utils.fmtDate(mi.plannedDate)}</span>
          </div>`;
        }).join('');
        milestoneListEl.querySelectorAll('[data-project]').forEach(el => el.addEventListener('click', () => {
          selectedProjectId = el.dataset.project;
          App.navigate('dashboard');
        }));
      }
    }
  }

  // ============================================================
  //  SINGLE PROJECT — modern deep-dive dashboard
  // ============================================================
  function heroSection(project, stats) {
    const flag = flagFor(project);
    const heroColor = Utils.colorHex(project.color);
    const daysLeft = stats.daysLeft;
    const daysLabel = daysLeft === null ? '—' : (daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : daysLeft === 0 ? 'Due today' : `${daysLeft}d left`);

    return `
      <div class="proj-hero" style="--hero-color:${heroColor}">
        <div class="proj-hero__top">
          <div style="flex:1; min-width:240px;">
            <div class="proj-hero__badges">
              <span class="badge">${project.status}</span>
              <span class="badge">${project.priority} priority</span>
              ${flag ? `<span class="badge">${flag.label}</span>` : ''}
              ${(project.tags || []).slice(0, 4).map(t => `<span class="badge">#${Utils.escapeHtml(t)}</span>`).join('')}
            </div>
            <div class="proj-hero__name">${Utils.escapeHtml(project.name)}</div>
            <div class="proj-hero__desc">${Utils.escapeHtml(project.description || 'No description yet.')}</div>
          </div>
          <div class="proj-hero__actions">
            <button class="btn-secondary btn-sm" id="heroDetailsBtn">📄 Full Details</button>
            <button class="btn-secondary btn-sm" id="heroTasksBtn">📋 View Tasks</button>
            <button class="btn-ghost btn-sm" id="heroEditBtn">✏ Edit</button>
          </div>
        </div>
        <div class="proj-hero__meta">
          <div class="proj-hero__meta-item">Owner<strong><span class="avatar" style="width:20px;height:20px;font-size:9px;vertical-align:middle;margin-right:4px;">${Utils.initials(project.owner)}</span>${Utils.escapeHtml(project.owner || 'Unassigned')}</strong></div>
          <div class="proj-hero__meta-item">Department<strong>${Utils.escapeHtml(project.department || '—')}</strong></div>
          <div class="proj-hero__meta-item">Timeline<strong>${Utils.fmtDate(project.startDate)} → ${Utils.fmtDate(project.dueDate)}</strong></div>
          <div class="proj-hero__meta-item">${daysLeft !== null && daysLeft < 0 ? 'Overdue' : 'Time Remaining'}<strong>${daysLabel}</strong></div>
          <div class="proj-hero__meta-item">Progress<strong>${project.progress}%</strong></div>
        </div>
      </div>
    `;
  }

  function budgetCardValue(project) {
    if (!project.budget) return { value: '—', sub: 'No budget set' };
    const actual = project.actualCost || 0;
    const pct = Math.round((actual / project.budget) * 100);
    return { value: `${pct}%`, sub: `$${actual.toLocaleString()} of $${project.budget.toLocaleString()}` };
  }

  function budgetBarHtml(project) {
    if (!project.budget) {
      return `<div class="empty-state" style="padding:20px;"><div class="empty-state__icon">💰</div>No budget set for this project.</div>`;
    }
    const actual = project.actualCost || 0;
    const pct = Math.round((actual / project.budget) * 100);
    const over = actual > project.budget;
    return `
      <div class="flex" style="justify-content:space-between; font-size:12.5px; margin-bottom:8px;">
        <span class="text-soft">$${actual.toLocaleString()} spent</span>
        <span class="${over ? '' : 'text-faint'}" style="${over ? 'color:var(--coral); font-weight:700;' : ''}">${pct}% of $${project.budget.toLocaleString()}</span>
      </div>
      <div class="budget-bar">
        <div class="budget-bar__fill ${over ? 'is-over' : 'is-ok'}" style="width:${Utils.clamp(pct, 0, 100)}%"></div>
      </div>
      ${over ? `<div class="text-faint" style="font-size:11.5px; margin-top:6px; color:var(--coral);">⚠ Over budget by $${(actual - project.budget).toLocaleString()}</div>` : ''}
    `;
  }

  function miniTimelineHtml(project, milestones) {
    if (!project.startDate || !project.dueDate) {
      return `<div class="empty-state" style="padding:20px;"><div class="empty-state__icon">📅</div>No start/due date set for this project.</div>`;
    }
    const start = project.startDate, due = project.dueDate;
    const totalDays = Math.max(1, Utils.daysBetween(start, due));
    const elapsedDays = Utils.clamp(Utils.daysBetween(start, Utils.todayISO()), 0, totalDays);
    const todayPct = (elapsedDays / totalDays) * 100;
    const progressPct = Utils.clamp(project.progress, 0, 100);
    const color = Utils.colorHex(project.color);
    const markers = milestones.filter(mi => mi.plannedDate).map(mi => {
      const d = Utils.clamp(Utils.daysBetween(start, mi.plannedDate), 0, totalDays);
      const pct = (d / totalDays) * 100;
      return `<div class="mini-timeline__ms" style="left:${pct}%; background:${Milestones.diamondColor(mi.status)};" title="${Utils.escapeHtml(mi.name)} — ${Utils.fmtDate(mi.plannedDate)}"></div>`;
    }).join('');
    return `
      <div class="mini-timeline">
        <div class="mini-timeline__track" style="--card-color:${color}">
          <div class="mini-timeline__fill" style="width:${progressPct}%"></div>
          <div class="mini-timeline__today" style="left:${todayPct}%" title="Today — ${Utils.fmtDate(Utils.todayISO())}"></div>
          ${markers}
        </div>
        <div class="mini-timeline__labels">
          <span>${Utils.fmtDate(start)}</span>
          <span class="text-faint">${progressPct}% complete</span>
          <span>${Utils.fmtDate(due)}</span>
        </div>
      </div>
    `;
  }

  function taskListHtml(pTasks) {
    if (!pTasks.length) return `<div class="empty-state" style="padding:20px;"><div class="empty-state__icon">📋</div>No tasks yet for this project.</div>`;
    const today = Utils.todayISO();
    const sorted = [...pTasks].sort((a, b) => (a.dueDate || '9999-99-99') < (b.dueDate || '9999-99-99') ? -1 : 1);
    const incomplete = sorted.filter(t => t.status !== 'Completed');
    const list = (incomplete.length ? incomplete : sorted).slice(0, 7);
    return `<div class="table-scroll"><table class="data-table">
      <thead><tr><th>Task</th><th>Assignee</th><th>Status</th><th>Due</th></tr></thead>
      <tbody>${list.map(t => {
        const overdue = t.status !== 'Completed' && t.dueDate && t.dueDate < today;
        return `<tr class="is-clickable" data-task="${t.id}">
          <td>${Utils.escapeHtml(t.name)}</td>
          <td>${Utils.escapeHtml(t.assignedTo || 'Unassigned')}</td>
          <td><span class="badge ${statusClass(t.status)}">${t.status}</span></td>
          <td style="${overdue ? 'color:var(--coral); font-weight:700;' : ''}">${Utils.fmtDate(t.dueDate)}${overdue ? ' ⚠' : ''}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  }

  function milestonesListHtml(pMilestones) {
    if (!pMilestones.length) return `<div class="empty-state" style="padding:20px;"><div class="empty-state__icon">🎯</div>No milestones yet for this project.</div>`;
    const sorted = [...pMilestones].sort((a, b) => (a.plannedDate < b.plannedDate ? -1 : 1));
    return sorted.slice(0, 6).map(mi => `
      <div class="milestone-item">
        <div class="flex gap-8">
          <span class="milestone-item__diamond" style="background:${Milestones.diamondColor(mi.status)}"></span>
          <div>
            <div style="font-weight:600; font-size:13px;">${Utils.escapeHtml(mi.name)}</div>
            <div class="text-faint" style="font-size:11.5px;">${Utils.escapeHtml(mi.owner || 'Unassigned')} · Planned ${Utils.fmtDate(mi.plannedDate)}</div>
          </div>
        </div>
        <span class="badge ${statusClass(mi.status)}">${mi.status}</span>
      </div>
    `).join('');
  }

  function parseNames(text) {
    return (text || '').split('\n').map(l => l.replace(/^[-•]\s*/, '').trim()).filter(Boolean);
  }

  function getCharterSummary(project) {
    const c = project.charter;
    if (!c) return null;
    if (typeof c === 'string') return c.trim() ? { businessCase: c, goalStatement: '', resourcePlan: {}, teamMembers: {} } : null;
    const hasAny = c.businessCase || c.goalStatement || c.problemStatement ||
      (c.resourcePlan && (c.resourcePlan.projectManager || c.resourcePlan.projectChampion)) ||
      (c.teamMembers && (c.teamMembers.dataTeam || c.teamMembers.businessSide));
    return hasAny ? c : null;
  }

  function cleanSnippet(text, max = 220) {
    const cleaned = (text || '').split('\n')
      .map(l => l.replace(/^#+\s*/, '').replace(/^[-•]\s*/, '').replace(/\*\*/g, ''))
      .join(' ').replace(/\s+/g, ' ').trim();
    if (cleaned.length <= max) return cleaned;
    return cleaned.slice(0, max).trim() + '…';
  }

  function teamAndCharterHtml(project) {
    const cd = getCharterSummary(project);
    const pmName = cd && cd.resourcePlan && cd.resourcePlan.projectManager;
    const champion = cd && cd.resourcePlan && cd.resourcePlan.projectChampion;
    const teamNames = cd && cd.teamMembers ? [...parseNames(cd.teamMembers.dataTeam), ...parseNames(cd.teamMembers.businessSide)] : [];

    const chips = [
      { label: project.owner, tag: 'Owner' },
      ...(pmName ? [{ label: pmName, tag: 'PM' }] : []),
      ...(champion ? [{ label: champion, tag: 'Champion' }] : []),
      ...teamNames.map(n => ({ label: n, tag: null }))
    ].filter(c => c.label);

    const seen = new Set();
    const uniqueChips = chips.filter(c => {
      const key = c.label.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const businessCase = cd ? cleanSnippet(cd.businessCase, 200) : '';
    const goalStatement = cd ? cleanSnippet(cd.goalStatement, 200) : '';

    return `
      <div class="panel__title mb-0">Team & Charter</div>
      <div style="margin: 10px 0 16px;">
        ${uniqueChips.length ? uniqueChips.map(c => `<span class="team-chip"><span class="avatar" style="width:18px;height:18px;font-size:8.5px;">${Utils.initials(c.label)}</span>${Utils.escapeHtml(c.label)}${c.tag ? ` <span class="text-faint">· ${c.tag}</span>` : ''}</span>`).join('') : '<div class="text-faint" style="font-size:12.5px;">No team members listed yet.</div>'}
      </div>
      ${businessCase ? `<div class="text-faint" style="font-size:11px; margin-bottom:2px;">BUSINESS CASE</div><div class="text-soft" style="font-size:12.5px; margin-bottom:12px;">${Utils.escapeHtml(businessCase)}</div>` : ''}
      ${goalStatement ? `<div class="text-faint" style="font-size:11px; margin-bottom:2px;">GOAL</div><div class="text-soft" style="font-size:12.5px; margin-bottom:12px;">${Utils.escapeHtml(goalStatement)}</div>` : ''}
      ${!businessCase && !goalStatement ? `<div class="text-faint" style="font-size:12.5px;">No project charter written yet.</div>` : ''}
      <button class="btn-secondary btn-sm" id="teamCharterBtn" style="margin-top:4px;">📜 ${cd ? 'View Full Charter' : 'Add Charter'}</button>
    `;
  }

  function workloadByAssignee(pTasks) {
    const today = Utils.todayISO();
    const map = {};
    pTasks.forEach(t => {
      const name = t.assignedTo || 'Unassigned';
      if (!map[name]) map[name] = { name, total: 0, completed: 0, overdue: 0 };
      map[name].total++;
      if (t.status === 'Completed') map[name].completed++;
      else if (t.dueDate && t.dueDate < today) map[name].overdue++;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }

  function workloadHtml(pTasks) {
    const rows = workloadByAssignee(pTasks);
    if (!rows.length) return `<div class="empty-state" style="padding:20px;"><div class="empty-state__icon">👥</div>No tasks assigned yet.</div>`;
    return rows.map(r => {
      const pct = r.total ? Math.round((r.completed / r.total) * 100) : 0;
      return `<div class="workload-row">
        <div class="workload-row__who">
          <span class="avatar" style="width:26px;height:26px;font-size:11px;">${Utils.initials(r.name)}</span>
          <div>
            <div style="font-weight:600; font-size:13px;">${Utils.escapeHtml(r.name)}</div>
            <div class="text-faint" style="font-size:11px;">${r.total} task${r.total === 1 ? '' : 's'} · ${r.completed} done${r.overdue ? ` · <span style="color:var(--coral); font-weight:700;">${r.overdue} overdue</span>` : ''}</div>
          </div>
        </div>
        <div class="workload-row__bar">
          <div class="progress-bar" style="--card-color:var(--primary);"><div class="progress-bar__fill" style="width:${pct}%"></div></div>
        </div>
        <div class="workload-row__pct">${pct}%</div>
      </div>`;
    }).join('');
  }

  function renderProjectView(body, project, allProjects) {
    const allTasks = DataStore.getTasks();
    const pTasks = allTasks.filter(t => t.projectId === project.id);
    const pMilestones = (DataStore.getMilestones() || []).filter(mi => mi.projectId === project.id);
    const today = Utils.todayISO();
    const completedTasks = pTasks.filter(t => t.status === 'Completed').length;
    const overdueTasks = pTasks.filter(t => t.status !== 'Completed' && t.dueDate && t.dueDate < today).length;
    const upcomingMilestones = pMilestones.filter(mi => mi.status !== 'Completed' && mi.plannedDate >= today && mi.plannedDate <= Utils.addDays(today, 14)).length;
    const daysLeft = project.dueDate ? Utils.daysBetween(today, project.dueDate) : null;
    const budget = budgetCardValue(project);
    const { svg: taskDonutSvg, segments: taskSegments } = taskStatusDonut(pTasks);

    body.innerHTML = `
      ${heroSection(project, { daysLeft })}

      <div class="metric-grid">
        ${metricCard('📈', 'Progress', project.progress + '%', 'primary')}
        ${metricCard('✅', 'Tasks Done', `${completedTasks}/${pTasks.length}`, 'teal', `${pTasks.length - completedTasks} remaining`)}
        ${metricCard('⏰', 'Overdue Tasks', overdueTasks, 'coral')}
        ${metricCard('🎯', 'Milestones (14d)', upcomingMilestones, 'violet', `${pMilestones.length} total`)}
        ${metricCard('⏳', daysLeft !== null && daysLeft < 0 ? 'Days Overdue' : 'Days Remaining', daysLeft === null ? '—' : Math.abs(daysLeft), 'sky')}
        ${metricCard('💰', 'Budget Used', budget.value, 'amber', budget.sub)}
      </div>

      <div class="dash-grid">
        <div class="card panel">
          <div class="panel__title">Project Timeline</div>
          ${miniTimelineHtml(project, pMilestones)}
          <div class="panel__title" style="margin-top:18px;">Recent & Upcoming Tasks</div>
          ${taskListHtml(pTasks)}
        </div>
        <div class="card panel" style="display:flex; flex-direction:column;">
          <div class="panel__title mb-0" style="align-self:flex-start;">Task Breakdown</div>
          <div style="align-self:center;">${taskDonutSvg}</div>
          <div class="legend" style="align-self:center;">
            ${taskSegments.filter(s => s.value > 0).map(s => `<div class="legend__item"><span class="legend__swatch" style="background:${s.color}"></span>${s.label} (${s.value})</div>`).join('')}
          </div>
          <div class="panel__title" style="margin-top:18px;">Budget</div>
          ${budgetBarHtml(project)}
        </div>
      </div>

      <div class="dash-grid">
        <div class="card panel">
          <div class="panel__title">Milestones <span class="text-faint" style="font-weight:500; font-size:11.5px;">(${pMilestones.length})</span></div>
          <div id="msListHost">${milestonesListHtml(pMilestones)}</div>
        </div>
        <div class="card panel" id="teamCharterHost">
          ${teamAndCharterHtml(project)}
        </div>
      </div>

      <div class="card panel" style="margin-top: 16px;">
        <div class="panel__title">Team Workload <span class="text-faint" style="font-weight:500; font-size:11.5px;">— tasks by assignee</span></div>
        ${workloadHtml(pTasks)}
      </div>
    `;

    document.getElementById('heroDetailsBtn').addEventListener('click', () => Projects.openDetailModal(project.id));
    document.getElementById('heroTasksBtn').addEventListener('click', () => Tasks.filterByProject(project.id));
    document.getElementById('heroEditBtn').addEventListener('click', () => Projects.openEditModal(project));
    body.querySelectorAll('[data-task]').forEach(row => row.addEventListener('click', () => Tasks.openDetailModal(row.dataset.task)));
    const charterBtn = document.getElementById('teamCharterBtn');
    if (charterBtn) charterBtn.addEventListener('click', () => {
      Projects.openDetailModal(project.id);
      setTimeout(() => document.querySelector('.tab-btn[data-tab="charter"]')?.click(), 0);
    });
  }

  function getSelectedProjectId() { return selectedProjectId; }
  function setSelectedProjectId(id) { selectedProjectId = id || 'all'; }

  return { render, getSelectedProjectId, setSelectedProjectId };
})();
