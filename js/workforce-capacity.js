/* ============================================================
   WORKFORCE-CAPACITY.JS
   Pure calculation engine for Workforce Planning. Nothing in here
   writes to DataStore or touches the DOM — it only derives capacity,
   allocation, utilization and overallocation from data that already
   lives in Projectly (members, tasks) plus the new workforce
   collections (allocations, leaveRecords, holidays).

   Core rule (per spec): capacity is never stored as a static value —
   it's always derived on read from:
     Available Capacity = Working Capacity − Leave/Holiday − Planned Work
   ============================================================ */

const WorkforceCapacity = (() => {

  const DEFAULT_THRESHOLDS = { underutilized: 50, optimal: 85, high: 100 }; // % boundaries, configurable

  function getThresholds() {
    return { ...DEFAULT_THRESHOLDS, ...(DataStore.getSetting('workforceThresholds', {}) || {}) };
  }
  function setThresholds(t) { DataStore.setSetting('workforceThresholds', t); }

  function isWeekday(iso) {
    const day = new Date(iso + 'T00:00:00').getDay();
    return day !== 0 && day !== 6;
  }

  // Inclusive count of Mon–Fri days between two ISO dates.
  function workingDaysBetween(start, end) {
    if (!start || !end || end < start) return 0;
    let count = 0, cur = start;
    let guard = 0;
    while (cur <= end && guard < 3660) { // ~10yr safety cap
      if (isWeekday(cur)) count++;
      cur = Utils.addDays(cur, 1);
      guard++;
    }
    return count;
  }

  function overlapRange(aStart, aEnd, bStart, bEnd) {
    const start = aStart > bStart ? aStart : bStart;
    const end = aEnd < bEnd ? aEnd : bEnd;
    if (!start || !end || start > end) return null;
    return { start, end };
  }

  function holidaysInRange(start, end, location) {
    return DataStore.getHolidays().filter(h =>
      h.date >= start && h.date <= end && isWeekday(h.date) &&
      (!h.location || !location || h.location === location)
    );
  }

  function leaveHoursInRange(member, start, end) {
    let hours = 0;
    DataStore.getLeaveRecords()
      .filter(l => l.memberId === member.id && l.status !== 'Rejected')
      .forEach(l => {
        const ov = overlapRange(start, end, l.startDate, l.endDate || l.startDate);
        if (!ov) return;
        if (typeof l.hours === 'number' && l.hours > 0 && (l.endDate || l.startDate) === l.startDate) {
          hours += l.hours; // explicit hours given for a single-day record
        } else {
          hours += workingDaysBetween(ov.start, ov.end) * (member.hoursPerDay || 8);
        }
      });
    return hours;
  }

  function allocationsForMember(memberId) {
    return DataStore.getAllocations().filter(a => a.memberId === memberId);
  }

  function plannedHoursInRange(member, start, end) {
    let hours = 0;
    allocationsForMember(member.id).forEach(a => {
      const aEnd = a.endDate || a.startDate;
      const ov = overlapRange(start, end, a.startDate, aEnd);
      if (!ov) return;
      const overlapDays = workingDaysBetween(ov.start, ov.end);
      if (a.plannedHours) {
        const totalDays = workingDaysBetween(a.startDate, aEnd) || 1;
        hours += a.plannedHours * (overlapDays / totalDays);
      } else if (a.allocationPercent) {
        hours += overlapDays * (member.hoursPerDay || 8) * (a.allocationPercent / 100);
      }
    });
    return Math.round(hours * 10) / 10;
  }

  function actualHoursInRange(member, start, end) {
    return DataStore.getTasks()
      .filter(t => (t.assignedTo || '') === member.name)
      .filter(t => {
        const s = t.startDate || t.dueDate, e = t.dueDate || t.startDate;
        return s && e && overlapRange(start, end, s, e) !== null;
      })
      .reduce((sum, t) => sum + (Number(t.actualHours) || 0), 0);
  }

  // Sum of allocationPercent across every allocation active on refDate —
  // this is the spec's headline example (60% + 30% + 20% = 110%).
  function currentAllocationPercent(memberId, refDate) {
    const today = refDate || Utils.todayISO();
    return allocationsForMember(memberId)
      .filter(a => a.startDate <= today && (a.endDate || a.startDate) >= today)
      .reduce((sum, a) => sum + (Number(a.allocationPercent) || 0), 0);
  }

  function capacityFor(member, start, end) {
    const workingDays = workingDaysBetween(start, end);
    const workingCapacity = workingDays * (member.hoursPerDay || 8);
    const holidayHours = holidaysInRange(start, end, member.location).length * (member.hoursPerDay || 8);
    const leaveHours = leaveHoursInRange(member, start, end);
    const plannedHours = plannedHoursInRange(member, start, end);
    const actualHours = actualHoursInRange(member, start, end);
    const netCapacity = Math.max(0, workingCapacity - holidayHours - leaveHours);
    const availableCapacity = Math.round((netCapacity - plannedHours) * 10) / 10;
    const utilizationPct = netCapacity > 0 ? Math.round((actualHours / netCapacity) * 100) : 0;
    const allocationPct = currentAllocationPercent(member.id, end < Utils.todayISO() ? end : undefined);
    return {
      start, end, workingDays, workingCapacity, holidayHours, leaveHours, netCapacity,
      plannedHours, actualHours, availableCapacity, utilizationPct, allocationPct,
      overallocatedByHours: plannedHours > netCapacity + 0.01,
      overallocatedByPercent: allocationPct > 100
    };
  }

  function utilizationBand(pct) {
    const t = getThresholds();
    if (pct > t.high) return { key: 'overallocated', label: 'Overallocated', cls: 'badge--status-cancelled' };
    if (pct >= t.optimal) return { key: 'high', label: 'High Utilization', cls: 'badge--status-testing' };
    if (pct >= t.underutilized) return { key: 'optimal', label: 'Optimal', cls: 'badge--status-completed' };
    return { key: 'under', label: 'Underutilized', cls: 'badge--status-notstarted' };
  }

  function monthRange(refDate) {
    const d = new Date((refDate || Utils.todayISO()) + 'T00:00:00');
    return {
      start: new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10),
      end: new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10)
    };
  }

  function weekRange(refDate) {
    const d = new Date((refDate || Utils.todayISO()) + 'T00:00:00');
    const day = d.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const start = new Date(d); start.setDate(d.getDate() + mondayOffset);
    const end = new Date(start); end.setDate(start.getDate() + 4);
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }

  return {
    getThresholds, setThresholds,
    workingDaysBetween, overlapRange,
    capacityFor, currentAllocationPercent, utilizationBand,
    monthRange, weekRange, plannedHoursInRange, actualHoursInRange
  };
})();
