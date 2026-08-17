/* ============================================================
   STORAGE.JS
   Unified persistence layer. Everything else in the app calls
   DataStore.getProjects()/setProjects()/getTasks()/setTasks() and
   never needs to know whether data lives in Firestore or
   LocalStorage.

   setTasks() also drives two auto-sync side effects, both scoped
   to whatever projects/milestones the changed tasks touch:
     - project.progress   = % of that project's tasks marked Completed
     - milestone.completion/status = % / Completed state of whichever
       tasks reference that milestone via task.milestoneId. A milestone
       with zero linked tasks is left fully manual.
   ============================================================ */

const DataStore = (() => {
  const LOCAL_KEYS = {
    projects: 'projectly_projects',
    tasks: 'projectly_tasks',
    portfolios: 'projectly_portfolios',
    milestones: 'projectly_milestones',
    members: 'projectly_members',
    settings: 'projectly_settings',
    notifications: 'projectly_notifications',
    auditLog: 'projectly_audit_log',
    roles: 'projectly_roles',
    skills: 'projectly_skills',
    allocations: 'projectly_allocations',
    leaveRecords: 'projectly_leave_records',
    holidays: 'projectly_holidays',
    ridac: 'projectly_ridac'
  };

  const MAX_AUDIT_ENTRIES = 1000;

  let mode = 'local'; // 'local' | 'firestore'
  let db = null;
  let cache = {
    projects: [], tasks: [], portfolios: [], milestones: [], members: [], auditLog: [],
    roles: [], skills: [], allocations: [], leaveRecords: [], holidays: [], ridac: []
  };
  const listeners = new Set();

  function notify(kind) {
    listeners.forEach(cb => {
      try { cb(kind); } catch (e) { console.error(e); }
    });
  }

  function isFirebaseConfigured() {
    const cfg = window.PROJECTLY_FIREBASE_CONFIG;
    return cfg && cfg.apiKey && cfg.apiKey !== 'YOUR_API_KEY' && cfg.projectId && cfg.projectId !== 'YOUR_PROJECT_ID';
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function tryInitFirestore() {
    if (!isFirebaseConfigured()) return false;
    try {
      await loadScript('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
      await loadScript('https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js');
      firebase.initializeApp(window.PROJECTLY_FIREBASE_CONFIG);
      db = firebase.firestore();
      // sanity check connection
      await db.collection('projectly').doc('projects').get();
      mode = 'firestore';
      return true;
    } catch (err) {
      console.warn('Firestore unavailable, falling back to LocalStorage.', err);
      mode = 'local';
      return false;
    }
  }

  function localGet(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function localSet(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  // Backward-compat migration for data saved before task.type existed.
  // Old data has no `type` field at all, so bar-vs-diamond rendering used
  // to be (incorrectly) inferred from startDate === dueDate. None of that
  // old data ever recorded real milestone intent anywhere, so the only
  // safe, non-destructive default is 'task' for everything — a true
  // milestone can be re-marked as such from the Task dialog. This never
  // mutates the stored objects in place; it returns new objects.
  function normalizeTasks(items) {
    return (items || []).map(t => (t.type === 'task' || t.type === 'milestone') ? t : { ...t, type: 'task' });
  }

  // Backward-compat migration for members saved before the Workforce Planning
  // module existed. Old records only have {id, name, role: 'manager'|'member',
  // createdAt} — role is no longer used to gate the Owner/Assignee dropdowns
  // (see Utils.managerOptionsHtml/memberOptionsHtml), but every People profile
  // field the Workforce module expects gets a safe default here so nothing
  // downstream has to null-check. Never mutates stored data in place.
  const MEMBER_DEFAULTS = {
    email: '', jobTitle: '', roleId: null, department: '', managerId: null,
    location: '', status: 'Active', startDate: null, endDate: null,
    hoursPerDay: 8, hoursPerWeek: 40, skills: []
  };
  function normalizeMembers(items) {
    return (items || []).map(m => ({ ...MEMBER_DEFAULTS, ...m, skills: Array.isArray(m.skills) ? m.skills : [] }));
  }

  async function loadAll() {
    if (mode === 'firestore') {
      const [pSnap, tSnap, pfSnap, mSnap, memSnap, auditSnap, roleSnap, skillSnap, allocSnap, leaveSnap, holSnap, ridacSnap] = await Promise.all([
        db.collection('projectly').doc('projects').get(),
        db.collection('projectly').doc('tasks').get(),
        db.collection('projectly').doc('portfolios').get(),
        db.collection('projectly').doc('milestones').get(),
        db.collection('projectly').doc('members').get(),
        db.collection('projectly').doc('auditLog').get(),
        db.collection('projectly').doc('roles').get(),
        db.collection('projectly').doc('skills').get(),
        db.collection('projectly').doc('allocations').get(),
        db.collection('projectly').doc('leaveRecords').get(),
        db.collection('projectly').doc('holidays').get(),
        db.collection('projectly').doc('ridac').get()
      ]);
      cache.projects = (pSnap.exists && pSnap.data().items) || [];
      cache.tasks = (tSnap.exists && tSnap.data().items) || [];
      cache.portfolios = (pfSnap.exists && pfSnap.data().items) || [];
      cache.milestones = (mSnap.exists && mSnap.data().items) || [];
      cache.members = (memSnap.exists && memSnap.data().items) || [];
      cache.auditLog = (auditSnap.exists && auditSnap.data().items) || [];
      cache.roles = (roleSnap.exists && roleSnap.data().items) || [];
      cache.skills = (skillSnap.exists && skillSnap.data().items) || [];
      cache.allocations = (allocSnap.exists && allocSnap.data().items) || [];
      cache.leaveRecords = (leaveSnap.exists && leaveSnap.data().items) || [];
      cache.holidays = (holSnap.exists && holSnap.data().items) || [];
      cache.ridac = (ridacSnap.exists && ridacSnap.data().items) || [];
    } else {
      cache.projects = localGet(LOCAL_KEYS.projects, []);
      cache.tasks = localGet(LOCAL_KEYS.tasks, []);
      cache.portfolios = localGet(LOCAL_KEYS.portfolios, []);
      cache.milestones = localGet(LOCAL_KEYS.milestones, []);
      cache.members = localGet(LOCAL_KEYS.members, []);
      cache.auditLog = localGet(LOCAL_KEYS.auditLog, []);
      cache.roles = localGet(LOCAL_KEYS.roles, []);
      cache.skills = localGet(LOCAL_KEYS.skills, []);
      cache.allocations = localGet(LOCAL_KEYS.allocations, []);
      cache.leaveRecords = localGet(LOCAL_KEYS.leaveRecords, []);
      cache.holidays = localGet(LOCAL_KEYS.holidays, []);
      cache.ridac = localGet(LOCAL_KEYS.ridac, []);
    }
    cache.tasks = normalizeTasks(cache.tasks);
    cache.members = normalizeMembers(cache.members);
  }

  async function persist(kind) {
    const items = cache[kind];
    if (mode === 'firestore') {
      await db.collection('projectly').doc(kind).set({ items, updatedAt: Date.now() });
    } else {
      localSet(LOCAL_KEYS[kind], items);
    }
  }

  function milestonesDiffer(a, b) {
    if (a.length !== b.length) return true;
    const key = m => `${m.id}|${m.startDate || ''}|${m.plannedDate || ''}`;
    const mapB = new Map(b.map(m => [m.id, key(m)]));
    return a.some(m => mapB.get(m.id) !== key(m));
  }

  function tasksDiffer(a, b) {
    if (a.length !== b.length) return true;
    const key = t => `${t.id}|${t.startDate || ''}|${t.dueDate || ''}`;
    const mapB = new Map(b.map(t => [t.id, key(t)]));
    return a.some(t => mapB.get(t.id) !== key(t));
  }

  let readyResolve;
  const ready = new Promise(res => { readyResolve = res; });

  async function init() {
    await tryInitFirestore();
    await loadAll();
    await fullResync();
    readyResolve(mode);
    notify('init');
  }

  init();


  // Re-run top-down date distribution (see topdown.js) after anything that
  // could change a project's or milestone's date range: fills in dates for
  // every auto milestone/task and reflows them to match the new range.
  // Manually-dated items (datesAuto:false) are never touched.
  async function resyncTopDown() {
    const newMilestones = TopDown.distributeMilestones(cache.milestones, cache.projects);
    if (milestonesDiffer(newMilestones, cache.milestones)) {
      cache.milestones = newMilestones;
      await persist('milestones');
      notify('milestones');
    }
    const newTasks = TopDown.distributeTasks(cache.tasks, cache.milestones, cache.projects);
    if (tasksDiffer(newTasks, cache.tasks)) {
      await setTasksImpl(newTasks);
    }
  }

  async function setTasksImpl(items) {
    // Top-down distribution first (fills in dates for any auto task, using
    // the current milestone/project ranges), then the dependency scheduling
    // engine, so FS/SS/FF/SF successors always reflect their predecessors
    // with no manual "refresh" step anywhere in the app — Gantt drag, the
    // Task dialog, bulk import, top-down reflow, and undo all funnel through
    // this one place. See topdown.js and scheduling.js for the algorithms.
    items = normalizeTasks(items);
    items = TopDown.distributeTasks(items, cache.milestones, cache.projects);

    let clampedNames = [];
    if (typeof Scheduling !== 'undefined') {
      const result = Scheduling.recalcAll(items);
      items = result.tasks;
      clampedNames = result.clampedNames;
    }

    // Capture which projects/milestones were touched by the OLD task list
    // too, so a deleted or reassigned task's old project/milestone still
    // gets recalculated (its id won't appear in the new `items` list).
    const touchedProjectIds = new Set([
      ...cache.tasks.map(t => t.projectId),
      ...items.map(t => t.projectId)
    ]);
    const touchedMilestoneIds = new Set([
      ...cache.tasks.map(t => t.milestoneId).filter(Boolean),
      ...items.map(t => t.milestoneId).filter(Boolean)
    ]);

    cache.tasks = items;
    await persist('tasks');
    notify('tasks');

    await syncProjectProgress(touchedProjectIds);
    await syncMilestonesFromTasks(touchedMilestoneIds);

    if (clampedNames.length && typeof Utils !== 'undefined') {
      const names = [...new Set(clampedNames)];
      const label = names.length > 2 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : names.join(', ');
      Utils.toast(`Dependency scheduling kept "${label}" within its project's start/due dates`, { tone: 'danger' });
    }
  }

  // Auto-recalculate each given project's completion % from its tasks:
  // progress = (completed tasks / total tasks) * 100, rounded. Projects
  // with no tasks show 0%. This keeps Project Progress always in sync
  // with task status, with no manual entry needed.
  async function syncProjectProgress(projectIds) {
    let changed = false;
    const updated = cache.projects.map(p => {
      if (!projectIds.has(p.id)) return p;
      const projectTasks = cache.tasks.filter(t => t.projectId === p.id);
      const newProgress = projectTasks.length
        ? Math.round((projectTasks.filter(t => t.status === 'Completed').length / projectTasks.length) * 100)
        : 0;
      if (newProgress !== p.progress) changed = true;
      return { ...p, progress: newProgress };
    });
    if (changed) {
      cache.projects = updated;
      await persist('projects');
      notify('projects');
    }
  }

  // Auto-sync each given milestone with the tasks linked to it
  // (task.milestoneId). Only milestones that actually have at least one
  // linked task are touched — milestones with no linked tasks stay fully
  // manual. completion% always tracks linked-task completion ratio; status
  // moves to 'In Progress' once at least one linked task is done (but not
  // all), flips to 'Completed' once all linked tasks are done, and
  // un-completes back to 'In Progress' if a completed task under it gets
  // reopened later. Never overrides a status set to something else
  // manually (e.g. 'At Risk').
  async function syncMilestonesFromTasks(milestoneIds) {
    let changed = false;
    const today = Utils.todayISO();
    const updated = cache.milestones.map(m => {
      if (!milestoneIds.has(m.id)) return m;
      const linkedTasks = cache.tasks.filter(t => t.milestoneId === m.id);
      if (!linkedTasks.length) return m;

      const doneCount = linkedTasks.filter(t => t.status === 'Completed').length;
      const newCompletion = Math.round((doneCount / linkedTasks.length) * 100);
      const allDone = doneCount === linkedTasks.length;

      let newStatus = m.status;
      let newActualDate = m.actualDate;
      if (allDone && m.status !== 'Completed') {
        newStatus = 'Completed';
        newActualDate = m.actualDate || today;
      } else if (!allDone && m.status === 'Completed') {
        newStatus = 'In Progress';
        newActualDate = null;
      } else if (!allDone && doneCount > 0 && m.status === 'Not Started') {
        newStatus = 'In Progress';
      }

      if (newCompletion !== m.completion || newStatus !== m.status || newActualDate !== m.actualDate) {
        changed = true;
      }
      return { ...m, completion: newCompletion, status: newStatus, actualDate: newActualDate };
    });
    if (changed) {
      cache.milestones = updated;
      await persist('milestones');
      notify('milestones');
    }
  }

  // Runs once right after data loads (see init() below), so any milestone
  // status/completion, project progress, or top-down date that went stale
  // in storage — e.g. inherited from before this sync logic existed, or
  // from a previous session — self-heals on refresh instead of silently
  // waiting for the next edit to that specific record.
  async function fullResync() {
    await resyncTopDown();
    await syncProjectProgress(new Set(cache.projects.map(p => p.id)));
    await syncMilestonesFromTasks(new Set(cache.milestones.map(m => m.id)));
  }

  async function setMilestonesImpl(items) {
    cache.milestones = items;
    await persist('milestones');
    notify('milestones');

    // Milestone list changed (added/removed/reordered/edited) — re-run
    // top-down for milestones (their siblings' auto slices may have shifted)
    // and then for tasks (milestone ranges may have shifted underneath them).
    const redistributed = TopDown.distributeMilestones(cache.milestones, cache.projects);
    if (milestonesDiffer(redistributed, cache.milestones)) {
      cache.milestones = redistributed;
      await persist('milestones');
      notify('milestones');
    }
    const newTasks = TopDown.distributeTasks(cache.tasks, cache.milestones, cache.projects);
    if (tasksDiffer(newTasks, cache.tasks)) {
      await setTasksImpl(newTasks);
    }
  }

  return {
    ready,
    get mode() { return mode; },

    getProjects() { return cache.projects; },
    getTasks() { return cache.tasks; },
    getPortfolios() { return cache.portfolios; },
    getMilestones() { return cache.milestones; },
    getMembers() { return cache.members; },
    getAuditLog() { return cache.auditLog; },
    getRoles() { return cache.roles; },
    getSkills() { return cache.skills; },
    getAllocations() { return cache.allocations; },
    getLeaveRecords() { return cache.leaveRecords; },
    getHolidays() { return cache.holidays; },
    getRidacs() { return cache.ridac; },

    async setProjects(items) {
      cache.projects = items;
      await persist('projects');
      notify('projects');
      await resyncTopDown();
    },
    async setTasks(items) {
      await setTasksImpl(items);
    },
    async setPortfolios(items) {
      cache.portfolios = items;
      await persist('portfolios');
      notify('portfolios');
    },
    async setMilestones(items) {
      await setMilestonesImpl(items);
    },
    async setMembers(items) {
      cache.members = normalizeMembers(items);
      await persist('members');
      notify('members');
    },
    async setRoles(items) {
      cache.roles = items;
      await persist('roles');
      notify('roles');
    },
    async setSkills(items) {
      cache.skills = items;
      await persist('skills');
      notify('skills');
    },
    async setAllocations(items) {
      cache.allocations = items;
      await persist('allocations');
      notify('allocations');
    },
    async setLeaveRecords(items) {
      cache.leaveRecords = items;
      await persist('leaveRecords');
      notify('leaveRecords');
    },
    async setHolidays(items) {
      cache.holidays = items;
      await persist('holidays');
      notify('holidays');
    },
    async setRidacs(items) {
      cache.ridac = items;
      await persist('ridac');
      notify('ridac');
    },

    async appendAuditLog(entries) {
      if (!entries || !entries.length) return;
      cache.auditLog = [...entries, ...cache.auditLog].slice(0, MAX_AUDIT_ENTRIES);
      await persist('auditLog');
      notify('auditLog');
    },

    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },

    getSetting(key, fallback) {
      const all = localGet(LOCAL_KEYS.settings, {});
      return key in all ? all[key] : fallback;
    },
    setSetting(key, value) {
      const all = localGet(LOCAL_KEYS.settings, {});
      all[key] = value;
      localSet(LOCAL_KEYS.settings, all);
    },

    getNotificationsState() { return localGet(LOCAL_KEYS.notifications, { read: [] }); },
    setNotificationsState(state) { localSet(LOCAL_KEYS.notifications, state); }
  };
})();
