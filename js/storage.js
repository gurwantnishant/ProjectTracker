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
    auditLog: 'projectly_audit_log'
  };

  const MAX_AUDIT_ENTRIES = 1000;

  let mode = 'local'; // 'local' | 'firestore'
  let db = null;
  let cache = { projects: [], tasks: [], portfolios: [], milestones: [], members: [], auditLog: [] };
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

  async function loadAll() {
    if (mode === 'firestore') {
      const [pSnap, tSnap, pfSnap, mSnap, memSnap, auditSnap] = await Promise.all([
        db.collection('projectly').doc('projects').get(),
        db.collection('projectly').doc('tasks').get(),
        db.collection('projectly').doc('portfolios').get(),
        db.collection('projectly').doc('milestones').get(),
        db.collection('projectly').doc('members').get(),
        db.collection('projectly').doc('auditLog').get()
      ]);
      cache.projects = (pSnap.exists && pSnap.data().items) || [];
      cache.tasks = (tSnap.exists && tSnap.data().items) || [];
      cache.portfolios = (pfSnap.exists && pfSnap.data().items) || [];
      cache.milestones = (mSnap.exists && mSnap.data().items) || [];
      cache.members = (memSnap.exists && memSnap.data().items) || [];
      cache.auditLog = (auditSnap.exists && auditSnap.data().items) || [];
    } else {
      cache.projects = localGet(LOCAL_KEYS.projects, []);
      cache.tasks = localGet(LOCAL_KEYS.tasks, []);
      cache.portfolios = localGet(LOCAL_KEYS.portfolios, []);
      cache.milestones = localGet(LOCAL_KEYS.milestones, []);
      cache.members = localGet(LOCAL_KEYS.members, []);
      cache.auditLog = localGet(LOCAL_KEYS.auditLog, []);
    }
  }

  async function persist(kind) {
    const items = cache[kind];
    if (mode === 'firestore') {
      await db.collection('projectly').doc(kind).set({ items, updatedAt: Date.now() });
    } else {
      localSet(LOCAL_KEYS[kind], items);
    }
  }

  let readyResolve;
  const ready = new Promise(res => { readyResolve = res; });

  async function init() {
    await tryInitFirestore();
    await loadAll();
    readyResolve(mode);
    notify('init');
  }

  init();

  return {
    ready,
    get mode() { return mode; },

    getProjects() { return cache.projects; },
    getTasks() { return cache.tasks; },
    getPortfolios() { return cache.portfolios; },
    getMilestones() { return cache.milestones; },
    getMembers() { return cache.members; },
    getAuditLog() { return cache.auditLog; },

    async setProjects(items) {
      cache.projects = items;
      await persist('projects');
      notify('projects');
    },
    async setTasks(items) {
      // Run the dependency scheduling engine on every task-list write, so
      // FS/SS/FF/SF successors (and their successors, and theirs...) always
      // reflect their predecessors with no manual "refresh" step anywhere in
      // the app — Gantt drag, the Task dialog, bulk import, and undo all
      // funnel through this one place. See scheduling.js for the algorithm.
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

      // Auto-recalculate each affected project's completion % from its tasks:
      // progress = (completed tasks / total tasks) * 100, rounded. Projects
      // with no tasks show 0%. This keeps Project Progress always in sync
      // with task status, with no manual entry needed.
      let projectsChanged = false;
      const updatedProjects = cache.projects.map(p => {
        if (!touchedProjectIds.has(p.id)) return p;
        const projectTasks = cache.tasks.filter(t => t.projectId === p.id);
        const newProgress = projectTasks.length
          ? Math.round((projectTasks.filter(t => t.status === 'Completed').length / projectTasks.length) * 100)
          : 0;
        if (newProgress !== p.progress) projectsChanged = true;
        return { ...p, progress: newProgress };
      });
      if (projectsChanged) {
        cache.projects = updatedProjects;
        await persist('projects');
        notify('projects');
      }

      // Auto-sync each affected milestone with the tasks linked to it
      // (task.milestoneId). Only milestones that actually have at least one
      // linked task are touched — milestones with no linked tasks stay
      // fully manual. completion% always tracks linked-task completion
      // ratio; status flips to 'Completed' once all linked tasks are done,
      // and un-completes back to 'In Progress' if a completed task under it
      // gets reopened later.
      let milestonesChanged = false;
      const today = Utils.todayISO();
      const updatedMilestones = cache.milestones.map(m => {
        if (!touchedMilestoneIds.has(m.id)) return m;
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
          // A previously-completed milestone had one of its tasks reopened.
          newStatus = 'In Progress';
          newActualDate = null;
        }

        if (newCompletion !== m.completion || newStatus !== m.status || newActualDate !== m.actualDate) {
          milestonesChanged = true;
        }
        return { ...m, completion: newCompletion, status: newStatus, actualDate: newActualDate };
      });
      if (milestonesChanged) {
        cache.milestones = updatedMilestones;
        await persist('milestones');
        notify('milestones');
      }

      if (clampedNames.length && typeof Utils !== 'undefined') {
        const names = [...new Set(clampedNames)];
        const label = names.length > 2 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : names.join(', ');
        Utils.toast(`Dependency scheduling kept "${label}" within its project's start/due dates`, { tone: 'danger' });
      }
    },
    async setPortfolios(items) {
      cache.portfolios = items;
      await persist('portfolios');
      notify('portfolios');
    },
    async setMilestones(items) {
      cache.milestones = items;
      await persist('milestones');
      notify('milestones');
    },
    async setMembers(items) {
      cache.members = items;
      await persist('members');
      notify('members');
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
