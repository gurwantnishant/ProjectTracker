/* ============================================================
   SCHEDULING.JS
   Dependency scheduling engine — Finish-to-Start, Start-to-Start,
   Finish-to-Finish and Start-to-Finish links, with lead/lag,
   multiple predecessors/successors, unlimited chain depth and
   circular-dependency detection.

   Data model
   ----------
   Each task carries `dependencies: [{ taskId, type, lag }]`.
     - type is one of 'FS' | 'SS' | 'FF' | 'SF'
     - lag is a signed integer number of days (0 = none, +2 = two
       days after the constraint point, -1 = one day before it)
   The legacy single-dependency shape (`task.dependency = { taskId,
   type }`) produced by older data is still read transparently via
   depsOf() below, so nothing already saved (LocalStorage, Firestore,
   sample data) needs a manual migration.

   How scheduling works
   --------------------
   Every dependency edge places a MINIMUM bound on the successor:
     FS  successor.start >= predecessor.due   + lag
     SS  successor.start >= predecessor.start + lag
     FF  successor.due   >= predecessor.due   + lag
     SF  successor.due   >= predecessor.start + lag
   When a task has several predecessors, the tightest (latest) bound
   wins for each side (start / due) — "the LAST predecessor" in the
   spec's language. The engine only ever pushes a task LATER to
   correct a violation; it never pulls a task earlier just because a
   predecessor freed up slack by moving earlier. That's what keeps a
   manual drag of a successor "sticky" instead of fighting the user,
   while still guaranteeing nothing is ever left scheduled before a
   dependency allows.

   recalcAll() walks the whole graph exactly once, in topological
   order (Kahn's algorithm), so it is O(tasks + edges) rather than
   the O(n²) you'd get from repeatedly rescanning every task — this
   keeps it fast at 1000+ tasks. Any task that sits inside a cycle
   never reaches indegree 0 and is simply left untouched (cycles are
   supposed to be blocked at save time by wouldCreateCycle(), this is
   just a defensive backstop against bad/imported data).
   ============================================================ */

const Scheduling = (() => {
  const TYPES = ['FS', 'SS', 'FF', 'SF'];
  const CYCLE_MESSAGE = 'Circular dependency detected.';

  // ---- normalization -----------------------------------------------
  // Always returns an array of { taskId, type, lag }, regardless of
  // whether the task uses the new `dependencies` array or the legacy
  // single `dependency` object.
  function depsOf(task) {
    if (!task) return [];
    if (Array.isArray(task.dependencies)) {
      return task.dependencies
        .filter(d => d && d.taskId)
        .map(d => ({
          taskId: d.taskId,
          type: TYPES.includes(d.type) ? d.type : 'FS',
          lag: Number.isFinite(d.lag) ? d.lag : 0
        }));
    }
    if (task.dependency && task.dependency.taskId) {
      return [{
        taskId: task.dependency.taskId,
        type: TYPES.includes(task.dependency.type) ? task.dependency.type : 'FS',
        lag: 0
      }];
    }
    return [];
  }

  // A task is a milestone if and only if it is explicitly typed as one.
  // This must NEVER be inferred from startDate/dueDate/duration: a 1-day
  // task legitimately has startDate === dueDate and must stay a normal
  // (zero-length-bar) task, not be reclassified as a milestone.
  function isMilestone(t) { return t.type === 'milestone'; }

  // ---- circular dependency detection --------------------------------
  // Classic 3-color DFS (white/gray/black) over the "depends on" graph.
  // `overrideTaskId` + `overrideDeps` let the Task dialog validate a
  // NOT-YET-SAVED set of dependencies (including for a brand new task
  // that isn't in `tasks` yet) before committing it.
  function wouldCreateCycle(tasks, overrideTaskId, overrideDeps) {
    const byId = {};
    tasks.forEach(t => byId[t.id] = t);
    const ids = new Set(tasks.map(t => t.id));
    if (overrideTaskId) ids.add(overrideTaskId);

    function predecessorsOf(id) {
      const deps = (id === overrideTaskId) ? overrideDeps : depsOf(byId[id]);
      return deps.map(d => d.taskId).filter(pid => ids.has(pid) && pid !== id);
    }

    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = {};
    ids.forEach(id => color[id] = WHITE);
    let cyclic = false;

    function visit(id) {
      if (cyclic || color[id] === BLACK) return;
      color[id] = GRAY;
      const preds = predecessorsOf(id);
      for (let i = 0; i < preds.length && !cyclic; i++) {
        const predId = preds[i];
        if (color[predId] === GRAY) { cyclic = true; return; }
        if (color[predId] === WHITE) visit(predId);
      }
      color[id] = BLACK;
    }

    ids.forEach(id => { if (!cyclic && color[id] === WHITE) visit(id); });
    return cyclic;
  }

  // ---- project bounds (extracted from Gantt so drag-resize and the
  // automatic engine both clamp the same way) ------------------------
  function clampToProject(newStart, newDue, project) {
    if (!project || !project.startDate || !project.dueDate) return { start: newStart, due: newDue, clamped: false };
    const dur = Math.max(0, Utils.daysBetween(newStart, newDue));
    let start = newStart, due = newDue, clamped = false;
    if (start < project.startDate) { start = project.startDate; due = Utils.addDays(start, dur); clamped = true; }
    if (due > project.dueDate) {
      due = project.dueDate;
      start = Utils.addDays(due, -dur);
      if (start < project.startDate) start = project.startDate;
      clamped = true;
    }
    // Defensive floor: never return due < start (e.g. a misconfigured
    // project whose own dueDate is before its startDate). Task/date
    // ordering is otherwise guaranteed by the Task dialog and Import
    // validation, but every date math path funnels through here too.
    if (due < start) { due = start; clamped = true; }
    return { start, due, clamped };
  }

  // ---- per-edge constraint math --------------------------------------
  // Returns the single bound this predecessor+type+lag places on the
  // successor: either a minimum start date or a minimum due date, never
  // both (a task's start and due are linked purely by its own duration).
  function boundsFor(predTask, edge) {
    const lag = Number.isFinite(edge.lag) ? edge.lag : 0;
    switch (edge.type) {
      case 'SS': return { startBound: Utils.addDays(predTask.startDate, lag) };
      case 'FF': return { dueBound: Utils.addDays(predTask.dueDate, lag) };
      case 'SF': return { dueBound: Utils.addDays(predTask.startDate, lag) };
      case 'FS':
      default: return { startBound: Utils.addDays(predTask.dueDate, lag) };
    }
  }

  // Recomputes ONE task against its already-resolved predecessors,
  // preserving its duration (or its zero-length milestone shape).
  // Multiple predecessors of the same bound category (start or due)
  // are resolved by taking the LATEST/most-restrictive bound, per spec:
  // FS -> last predecessor to finish, SS -> latest predecessor start,
  // FF -> latest predecessor finish, SF -> latest predecessor start.
  function applyConstraints(task, predecessorsResolved) {
    const duration = Math.max(0, Utils.daysBetween(task.startDate, task.dueDate));
    let startBound = null, dueBound = null;
    predecessorsResolved.forEach(({ predTask, edge }) => {
      const b = boundsFor(predTask, edge);
      if (b.startBound !== undefined && (startBound === null || b.startBound > startBound)) startBound = b.startBound;
      if (b.dueBound !== undefined && (dueBound === null || b.dueBound > dueBound)) dueBound = b.dueBound;
    });
    if (startBound === null && dueBound === null) return task;

    // Never create negative durations / invalid dates: both bounds are
    // resolved against the SAME fixed duration, then the later of the
    // two required starts wins so neither constraint is violated.
    let newStart = task.startDate;
    if (startBound !== null && startBound > newStart) newStart = startBound;
    if (dueBound !== null) {
      const requiredStart = Utils.addDays(dueBound, -duration);
      if (requiredStart > newStart) newStart = requiredStart;
    }
    let newDue = Utils.addDays(newStart, duration);
    if (isMilestone(task)) newDue = newStart; // milestones stay zero-length

    if (newStart === task.startDate && newDue === task.dueDate) return task; // no violation, nothing to do
    return { ...task, startDate: newStart, dueDate: newDue };
  }

  // ---- full-graph recompute -------------------------------------------
  // Single topological pass (Kahn's algorithm) over the whole task list.
  // Chained (A->B->C->D->E), fan-out (A->B, A->C, A->D) and fan-in
  // (D depends on A, B, C) dependencies are all handled naturally by the
  // graph traversal — no special-casing needed for any of them.
  function recalcAll(tasks) {
    const byId = {};
    tasks.forEach(t => byId[t.id] = t);

    const successorsOf = {}; // predecessorId -> [{ succId, edge }]
    const indegree = {};
    tasks.forEach(t => { indegree[t.id] = 0; successorsOf[t.id] = []; });

    tasks.forEach(t => {
      depsOf(t).forEach(edge => {
        if (!byId[edge.taskId] || edge.taskId === t.id) return; // dangling/self-reference: ignore, no constraint
        successorsOf[edge.taskId].push({ succId: t.id, edge });
        indegree[t.id]++;
      });
    });

    const resolved = {};
    tasks.forEach(t => resolved[t.id] = t);
    const queue = tasks.filter(t => indegree[t.id] === 0).map(t => t.id);
    const clampedNames = [];
    let processed = 0;

    while (queue.length) {
      const id = queue.shift();
      processed++;
      const task = resolved[id];
      const edgesIn = depsOf(task).filter(e => byId[e.taskId] && e.taskId !== id);
      if (edgesIn.length) {
        const predecessorsResolved = edgesIn.map(edge => ({ predTask: resolved[edge.taskId], edge }));
        let next = applyConstraints(task, predecessorsResolved);
        const project = DataStore.getProjects().find(p => p.id === next.projectId);
        const clampedResult = clampToProject(next.startDate, next.dueDate, project);
        if (clampedResult.start !== next.startDate || clampedResult.due !== next.dueDate) {
          if (clampedResult.clamped) clampedNames.push(next.name);
          next = { ...next, startDate: clampedResult.start, dueDate: clampedResult.due };
        }
        resolved[id] = next;
      }
      successorsOf[id].forEach(({ succId }) => {
        indegree[succId]--;
        if (indegree[succId] === 0) queue.push(succId);
      });
    }

    return {
      tasks: tasks.map(t => resolved[t.id]),
      clampedNames,
      hadCycle: processed < tasks.length // some tasks never reached indegree 0 -> part of a cycle, left untouched
    };
  }

  return { TYPES, CYCLE_MESSAGE, depsOf, isMilestone, wouldCreateCycle, clampToProject, boundsFor, applyConstraints, recalcAll };
})();
