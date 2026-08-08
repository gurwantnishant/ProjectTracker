/* ============================================================
   TOPDOWN.JS
   Top-down date distribution: project date range -> milestones,
   milestone date range -> its tasks.

   Only items explicitly flagged datesAuto:true participate — every
   other item (datesAuto:false or missing, which is the safe default
   for existing/imported/manually-dated records) is left untouched and
   acts as a fixed anchor that auto items are distributed around.

   This runs centrally from storage.js on every project/milestone/task
   write, so it stays "live": edit a project's date range and every
   auto milestone/task under it reflows automatically. An item stops
   reflowing the moment a person gives it explicit dates (its
   datesAuto flag is cleared by the Milestone/Task dialog).
   ============================================================ */

const TopDown = (() => {

  function byCreatedAt(a, b) {
    return (a.createdAt || 0) - (b.createdAt || 0);
  }

  // Fill the datesAuto items in `items` (already sorted into the order
  // they should be laid out in) with contiguous, non-overlapping date
  // spans inside [rangeStart, rangeEnd]. Items that are NOT auto keep
  // their existing dates and act as fixed anchors: a run of consecutive
  // auto items is spread across the gap between whichever anchors (or
  // range edges) bound that run.
  function distributeRange(items, rangeStart, rangeEnd, accessors) {
    const { getStart, getEnd, setRange, isBlank } = accessors;
    if (!rangeStart || !rangeEnd || !items.length) return items;
    const result = items.slice();
    const n = result.length;
    let i = 0;
    while (i < n) {
      if (!isBlank(result[i])) { i++; continue; }
      let j = i;
      while (j < n && isBlank(result[j])) j++;
      const runLen = j - i;
      const boundStart = i === 0 ? rangeStart : (getEnd(result[i - 1]) || rangeStart);
      let boundEnd = j === n ? rangeEnd : (getStart(result[j]) || rangeEnd);
      if (boundEnd < boundStart) boundEnd = boundStart;
      const totalDays = Utils.daysBetween(boundStart, boundEnd);
      const sliceDays = Math.max(0, Math.floor(totalDays / runLen));
      let cursor = boundStart;
      for (let k = i; k < j; k++) {
        const isLast = k === j - 1;
        const segStart = cursor;
        let segEnd;
        if (isLast) {
          segEnd = boundEnd;
        } else {
          const candidate = Utils.addDays(cursor, sliceDays);
          segEnd = candidate > boundEnd ? boundEnd : candidate;
        }
        result[k] = setRange(result[k], segStart, segEnd);
        cursor = segEnd;
      }
      i = j;
    }
    return result;
  }

  // Spread auto milestones across their project's [startDate, dueDate].
  function distributeMilestones(milestones, projects) {
    const byProject = {};
    milestones.forEach(m => { (byProject[m.projectId] = byProject[m.projectId] || []).push(m); });
    let out = milestones.slice();
    Object.keys(byProject).forEach(projectId => {
      const project = projects.find(p => p.id === projectId);
      if (!project || !project.startDate || !project.dueDate) return;
      const group = byProject[projectId].slice().sort(byCreatedAt);
      const distributed = distributeRange(group, project.startDate, project.dueDate, {
        getStart: m => m.startDate,
        getEnd: m => m.plannedDate,
        isBlank: m => m.datesAuto === true,
        setRange: (m, s, e) => ({ ...m, startDate: s, plannedDate: e })
      });
      distributed.forEach(m => {
        const idx = out.findIndex(x => x.id === m.id);
        if (idx >= 0) out[idx] = m;
      });
    });
    return out;
  }

  // Spread auto tasks across their milestone's [startDate, plannedDate],
  // or their project's [startDate, dueDate] when not linked to a milestone.
  function distributeTasks(tasks, milestones, projects) {
    const buckets = {};
    tasks.forEach(t => {
      const key = t.milestoneId ? `m:${t.milestoneId}` : `p:${t.projectId}`;
      (buckets[key] = buckets[key] || []).push(t);
    });
    let out = tasks.slice();
    Object.keys(buckets).forEach(key => {
      const group = buckets[key].slice().sort(byCreatedAt);
      let rangeStart, rangeEnd;
      if (key.startsWith('m:')) {
        const m = milestones.find(x => x.id === key.slice(2));
        if (!m || !m.startDate || !m.plannedDate) return;
        rangeStart = m.startDate; rangeEnd = m.plannedDate;
      } else {
        const p = projects.find(x => x.id === key.slice(2));
        if (!p || !p.startDate || !p.dueDate) return;
        rangeStart = p.startDate; rangeEnd = p.dueDate;
      }
      const distributed = distributeRange(group, rangeStart, rangeEnd, {
        getStart: t => t.startDate,
        getEnd: t => t.dueDate,
        isBlank: t => t.datesAuto === true,
        // A milestone-type task is a point in time, not a span.
        setRange: (t, s, e) => ({ ...t, startDate: s, dueDate: t.type === 'milestone' ? s : e })
      });
      distributed.forEach(t => {
        const idx = out.findIndex(x => x.id === t.id);
        if (idx >= 0) out[idx] = t;
      });
    });
    return out;
  }

  return { distributeMilestones, distributeTasks };
})();
