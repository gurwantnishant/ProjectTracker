/* ============================================================
   STORAGE.JS
   Unified persistence layer. Everything else in the app calls
   DataStore.getProjects()/setProjects()/getTasks()/setTasks() and
   never needs to know whether data lives in Firestore or
   LocalStorage.
   ============================================================ */

const DataStore = (() => {
  const LOCAL_KEYS = {
    projects: 'flowspace_projects',
    tasks: 'flowspace_tasks',
    portfolios: 'flowspace_portfolios',
    milestones: 'flowspace_milestones',
    members: 'flowspace_members',
    settings: 'flowspace_settings',
    notifications: 'flowspace_notifications',
    auditLog: 'flowspace_audit_log'
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
    const cfg = window.FLOWSPACE_FIREBASE_CONFIG;
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
      firebase.initializeApp(window.FLOWSPACE_FIREBASE_CONFIG);
      db = firebase.firestore();
      // sanity check connection
      await db.collection('flowspace').doc('projects').get();
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
        db.collection('flowspace').doc('projects').get(),
        db.collection('flowspace').doc('tasks').get(),
        db.collection('flowspace').doc('portfolios').get(),
        db.collection('flowspace').doc('milestones').get(),
        db.collection('flowspace').doc('members').get(),
        db.collection('flowspace').doc('auditLog').get()
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
      await db.collection('flowspace').doc(kind).set({ items, updatedAt: Date.now() });
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
      // Capture which projects were touched by the OLD task list too, so a
      // deleted task's project still gets its progress recalculated (the
      // deleted task's projectId won't appear in the new `items` list).
      const touchedProjectIds = new Set([
        ...cache.tasks.map(t => t.projectId),
        ...items.map(t => t.projectId)
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
