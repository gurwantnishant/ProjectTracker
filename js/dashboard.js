/* ============================================================
   DASHBOARD.JS
   ============================================================ */

const Dashboard = (() => {

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

  function metricCard(icon, label, value, color) {
    return `<div class="card metric-card">
      <div class="metric-card__icon">${icon}</div>
      <div class="metric-card__label">${label}</div>
      <div class="metric-card__value" style="color:${color}">${value}</div>
    </div>`;
  }

  // ---- donut chart (SVG) ----
  function donutChart(segments, size = 160) {
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
      <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="10.5" fill="var(--ink-faint)">projects</text>
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
    return { svg: donutChart(segments), segments };
  }

  function completionTrend(tasks) {
    const weeks = 8;
    const points = [];
    for (let i = weeks - 1; i >= 0; i--) {
      const weekEnd = Utils.addDays(Utils.todayISO(), -7 * i);
      const weekStart = Utils.addDays(weekEnd, -6);
      const inWeek = tasks.filter(t => t.dueDate >= weekStart && t.dueDate <= weekEnd);
      const completed = inWeek.filter(t => t.status === 'Completed').length;
      const label = new Date(weekEnd + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      points.push({ label, value: completed });
    }
    return points;
  }

  function render(main) {
    const projects = DataStore.getProjects().filter(p => !p.archived);
    const tasks = DataStore.getTasks();
    const m = computeMetrics(projects, tasks);
    const { svg: donutSvg, segments } = statusDonut(projects);
    const trendPoints = completionTrend(tasks);

    main.innerHTML = `
      <div class="view-header">
        <div>
          <div class="view-header__title">Welcome back 👋</div>
          <div class="view-header__subtitle">Here's how your projects are tracking today, ${Utils.fmtDate(Utils.todayISO())}.</div>
        </div>
        <div class="view-header__actions">
          <button class="btn-primary" id="dashNewProjectBtn">+ New Project</button>
        </div>
      </div>

      <div class="metric-grid">
        ${metricCard('📁', 'Total Projects', m.total, 'var(--ink)')}
        ${metricCard('🚀', 'Active Projects', m.active, 'var(--primary)')}
        ${metricCard('✅', 'Completed Projects', m.completed, 'var(--teal)')}
        ${metricCard('⏰', 'Overdue Tasks', m.overdueTasks, 'var(--coral)')}
        ${metricCard('🎯', 'Upcoming Milestones', m.upcomingMilestones, 'var(--violet)')}
        ${metricCard('📌', 'Tasks Due This Week', m.dueThisWeek, 'var(--amber)')}
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
        <div class="panel__title">Project Progress Overview</div>
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
        <div style="margin-bottom: 14px;">
          <div class="flex" style="justify-content: space-between; margin-bottom: 6px; font-size: 12.5px;">
            <span class="flex gap-8"><span class="row-color-dot" style="background:${Utils.colorHex(p.color)}"></span><strong>${Utils.escapeHtml(p.name)}</strong></span>
            <span class="text-soft">${p.progress}%</span>
          </div>
          <div class="progress-bar" style="--card-color:${Utils.colorHex(p.color)}"><div class="progress-bar__fill" style="width:${p.progress}%"></div></div>
        </div>
      `).join('');
    }

    document.getElementById('dashNewProjectBtn').addEventListener('click', () => Projects.openCreateModal());

    const milestoneListEl = document.getElementById('upcomingMilestonesList');
    if (milestoneListEl) {
      const upcoming = typeof Milestones !== 'undefined' ? Milestones.getUpcoming(14) : [];
      if (!upcoming.length) {
        milestoneListEl.innerHTML = `<div class="text-faint">No milestones due in the next two weeks.</div>`;
      } else {
        milestoneListEl.innerHTML = upcoming.slice(0, 6).map(m => {
          const proj = DataStore.getProjects().find(p => p.id === m.projectId);
          return `<div class="milestone-item" data-project="${m.projectId}" style="cursor:pointer;">
            <div class="flex gap-8">
              <span class="milestone-item__diamond" style="background:${Milestones.diamondColor(m.status)}"></span>
              <div>
                <div style="font-weight:600; font-size:13px;">${Utils.escapeHtml(m.name)}</div>
                <div class="text-faint" style="font-size:11.5px;">${Utils.escapeHtml(proj ? proj.name : 'Unknown project')} · ${Utils.escapeHtml(m.owner || 'Unassigned')}</div>
              </div>
            </div>
            <span class="text-faint" style="font-size:12px;">${Utils.fmtDate(m.plannedDate)}</span>
          </div>`;
        }).join('');
        milestoneListEl.querySelectorAll('[data-project]').forEach(el => el.addEventListener('click', () => App.navigate('projects', { focusId: el.dataset.project })));
      }
    }
  }

  return { render };
})();
