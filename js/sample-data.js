/* ============================================================
   SAMPLE-DATA.JS - seeds demo projects + tasks on first run
   ============================================================ */

const SampleData = (() => {

  const OWNERS = ['Maria Chen', 'Jordan Blake', 'Priya Nair', 'Sam Okafor', 'Elena Vidal'];
  const DEPARTMENTS = ['Engineering', 'Operations', 'Data', 'Finance'];

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function generate() {
    const today = Utils.todayISO();

    const projectDefs = [
      { name: 'Fabric Migration', color: 'indigo', desc: 'Migrate legacy data warehouse workloads onto Microsoft Fabric.', dept: 'Engineering', start: -30, due: 45, status: 'In Progress', progress: 55, priority: 'High', budget: 220000, actualCost: 128000, portfolio: 'Data & Platform Modernization' },
      { name: 'Warehouse Automation', color: 'teal', desc: 'Automate pick-pack-ship flows across the west coast distribution center.', dept: 'Operations', start: -15, due: 60, status: 'In Progress', progress: 30, priority: 'Critical', budget: 480000, actualCost: 210000, portfolio: 'Operations Excellence' },
      { name: 'Supply Chain AI', color: 'violet', desc: 'Forecasting model to reduce stockouts and overstock across regional hubs.', dept: 'Data', start: -60, due: -5, status: 'On Hold', progress: 70, priority: 'Medium', budget: 150000, actualCost: 165000, portfolio: 'Data & Platform Modernization' },
      { name: 'Cost Reporting Enhancement', color: 'amber', desc: 'Rebuild the monthly cost reporting pipeline with drill-down dashboards.', dept: 'Finance', start: -10, due: 20, status: 'Not Started', progress: 5, priority: 'Low', budget: null, actualCost: null, portfolio: 'Operations Excellence' }
    ];

    const portfolioDefs = [
      { name: 'Data & Platform Modernization', color: 'indigo', desc: 'Initiatives that modernize our data infrastructure and analytics platforms.', owner: 'Maria Chen' },
      { name: 'Operations Excellence', color: 'teal', desc: 'Programs that improve operational throughput, cost, and reporting.', owner: 'Jordan Blake' }
    ];
    const portfolios = portfolioDefs.map((p, i) => ({
      id: Utils.uid('port'),
      name: p.name,
      description: p.desc,
      owner: p.owner,
      color: p.color,
      archived: false,
      createdAt: Date.now() - (portfolioDefs.length - i) * 86400000
    }));
    const portfolioIdByName = Object.fromEntries(portfolios.map(p => [p.name, p.id]));

    const projects = projectDefs.map((p, i) => ({
      id: Utils.uid('proj'),
      name: p.name,
      description: p.desc,
      owner: pick(OWNERS),
      startDate: Utils.addDays(today, p.start),
      dueDate: Utils.addDays(today, p.due),
      priority: p.priority,
      status: p.status,
      progress: p.progress,
      department: p.dept,
      tags: [p.dept, p.priority],
      color: p.color,
      portfolioId: portfolioIdByName[p.portfolio] || null,
      budget: p.budget,
      actualCost: p.actualCost,
      archived: false,
      createdAt: Date.now() - (projectDefs.length - i) * 86400000
    }));

    const taskNamesByProject = {
      'Fabric Migration': [
        'Audit existing warehouse schemas', 'Provision Fabric capacity', 'Map ETL pipelines', 'Migrate staging tables',
        'Migrate production tables', 'Rebuild Power BI datasets', 'Validate row-level security', 'Load performance testing',
        'Cutover runbook', 'Decommission legacy cluster', 'Update data dictionary', 'Train analytics team'
      ],
      'Warehouse Automation': [
        'Vendor selection for conveyor system', 'Install pick-to-light hardware', 'Integrate WMS with robotics API',
        'Pilot automated packing line', 'Safety compliance review', 'Operator training program', 'Throughput baseline testing',
        'Rollout to zone B', 'Rollout to zone C', 'Exception handling workflow', 'Maintenance schedule setup', 'Go-live readiness review', 'Post launch tuning'
      ],
      'Supply Chain AI': [
        'Collect historical demand data', 'Feature engineering pipeline', 'Train baseline forecasting model',
        'Backtest against Q1 actuals', 'Build anomaly detection layer', 'Integrate with replenishment system',
        'Stakeholder review of forecasts', 'Model monitoring dashboard', 'Bias and drift checks', 'Document model assumptions'
      ],
      'Cost Reporting Enhancement': [
        'Gather requirements from finance leads', 'Design new cost allocation model', 'Build ETL for GL data',
        'Create drill-down report layer', 'Build variance analysis view', 'UAT with finance team',
        'Migrate historical reports', 'Set up scheduled exports', 'Documentation and rollout', 'Retire legacy spreadsheets',
        'Add department-level filters', 'Performance tuning of queries', 'Final sign-off', 'Archive old cost center codes', 'Set up alerting thresholds'
      ]
    };

    const statuses = ['Not Started', 'In Progress', 'Blocked', 'Testing', 'Completed'];
    const priorities = ['Low', 'Medium', 'High', 'Critical'];

    let tasks = [];
    let counter = 0;
    projects.forEach(proj => {
      const names = taskNamesByProject[proj.name];
      let prevTaskId = null;
      names.forEach((name, idx) => {
        counter++;
        const start = Utils.addDays(today, -20 + idx * 4 + Math.floor(Math.random() * 3));
        const due = Utils.addDays(start, 3 + Math.floor(Math.random() * 6));
        // weight status distribution: earlier tasks more likely completed, later more likely not started
        let status;
        const r = Math.random();
        if (idx < names.length * 0.4) status = r < 0.7 ? 'Completed' : (r < 0.85 ? 'Testing' : 'In Progress');
        else if (idx < names.length * 0.7) status = r < 0.4 ? 'In Progress' : (r < 0.55 ? 'Blocked' : (r < 0.8 ? 'Not Started' : 'Testing'));
        else status = r < 0.6 ? 'Not Started' : 'In Progress';

        const progress = status === 'Completed' ? 100 : status === 'Not Started' ? 0 : Utils.clamp(Math.floor(Math.random() * 90), 5, 90);
        const estHours = 4 + Math.floor(Math.random() * 30);

        const task = {
          id: Utils.uid('task'),
          projectId: proj.id,
          name,
          description: `${name} for the ${proj.name} initiative.`,
          assignedTo: pick(OWNERS),
          startDate: start,
          dueDate: due,
          priority: pick(priorities),
          status,
          progress,
          dependency: (idx > 0 && Math.random() < 0.55) ? { taskId: prevTaskId, type: 'FS' } : null,
          estimatedHours: estHours,
          actualHours: status === 'Not Started' ? 0 : Math.floor(estHours * (0.4 + Math.random() * 0.9)),
          comments: [],
          createdAt: Date.now() - (names.length - idx) * 3600000
        };
        tasks.push(task);
        prevTaskId = task.id;
      });
    });

    // trim/pad to exactly 50 tasks
    tasks = tasks.slice(0, 50);

    // ---- milestones: 2-3 per project, spaced across its timeline ----
    const milestoneNamesByProject = {
      'Fabric Migration': ['Staging environment ready', 'Production cutover', 'Legacy decommission complete'],
      'Warehouse Automation': ['Pilot line operational', 'Zone B rollout complete', 'Full site go-live'],
      'Supply Chain AI': ['Baseline model validated', 'Stakeholder sign-off'],
      'Cost Reporting Enhancement': ['Requirements approved', 'UAT complete', 'Legacy reports retired']
    };
    const milestoneStatusPool = ['Not Started', 'In Progress', 'At Risk', 'Completed'];
    let milestones = [];
    projects.forEach(proj => {
      const names = milestoneNamesByProject[proj.name] || [];
      const span = Utils.daysBetween(proj.startDate, proj.dueDate) || 30;
      let prevId = null;
      names.forEach((name, idx) => {
        const fraction = (idx + 1) / (names.length + 1);
        const planned = Utils.addDays(proj.startDate, Math.round(span * fraction));
        const today2 = Utils.todayISO();
        let status = planned < today2 ? pick(['Completed', 'Completed', 'At Risk']) : pick(['Not Started', 'In Progress']);
        const completion = status === 'Completed' ? 100 : status === 'In Progress' ? 40 + Math.floor(Math.random() * 40) : 0;
        const m = {
          id: Utils.uid('mile'),
          projectId: proj.id,
          name,
          description: `${name} for ${proj.name}.`,
          owner: pick(OWNERS),
          plannedDate: planned,
          actualDate: status === 'Completed' ? planned : null,
          status,
          completion,
          dependsOn: prevId,
          createdAt: Date.now() - (names.length - idx) * 3600000
        };
        milestones.push(m);
        prevId = m.id;
      });
    });

    return { projects, tasks, portfolios, milestones };
  }

  return { generate };
})();
