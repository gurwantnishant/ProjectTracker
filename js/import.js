/* ============================================================
   IMPORT.JS
   "Import Project" wizard: lets a user paste a project planner
   (outline text) or upload an Excel/CSV file and auto-creates a
   Project + Milestones + Tasks + Subtasks from it.

   Parsing convention (paste mode), matched to the common
   Phase > Sub-group > Checklist-item outline shape:
     - A line starting with "Phase" (e.g. "Phase 1 - Kickoff"),
       or a Markdown "# " line                -> Milestone
     - A line starting with "-", "*", "•", "·",
       a Markdown "### " line, or an indented
       line (2+ leading spaces)               -> Subtask
     - Anything else (plain, un-indented line),
       or a Markdown "## " line                -> Task

   Spreadsheet mode expects (Phase|Milestone) / (Task) /
   (Subtask|Item) columns, optionally with Assignee, Due Date,
   and Priority columns. Blank cells continue the previous row's
   Phase/Task (fill-down), mirroring how an outline reads down
   a sheet.
   ============================================================ */

const Importer = (() => {
  const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

  let state = null;

  function uid() { return Utils.uid('improw'); }

  // ---------------- text parsing ----------------
  function classifyLine(raw) {
    const expanded = raw.replace(/\t/g, '    ');
    const trimmed = expanded.trim();
    if (!trimmed) return null;
    const indent = expanded.length - expanded.replace(/^ +/, '').length;
    let m;

    if ((m = trimmed.match(/^###\s+(.*)/))) return { level: 'subtask', name: m[1].trim() };
    if ((m = trimmed.match(/^##\s+(.*)/))) return { level: 'task', name: m[1].trim() };
    if ((m = trimmed.match(/^#\s+(.*)/))) return { level: 'milestone', name: m[1].trim() };

    if (/^phase\b/i.test(trimmed)) return { level: 'milestone', name: trimmed };

    if ((m = trimmed.match(/^[-*•·]\s+(.*)/))) return { level: 'subtask', name: m[1].trim() };

    if (indent >= 2) return { level: 'subtask', name: trimmed };

    return { level: 'task', name: trimmed };
  }

  function parseOutlineText(text) {
    return text.split('\n').map(classifyLine).filter(Boolean).map(r => ({ id: uid(), ...r }));
  }

  // ---------------- Word (.docx) parsing ----------------
  // Mammoth converts the .docx into semantic HTML (h1/h2/h3.../p/ul>li),
  // which gives us real structural signal instead of guessing from plain
  // text. We auto-detect which heading level is used as the recurring
  // "section" marker (Milestone) vs. the level below it (Task) — this
  // naturally skips a one-off document title (e.g. a lone H1) since it
  // won't repeat, while staying flexible about which heading levels a
  // given document actually uses. List items are always Subtasks.
  function readWordFile(file) {
    return new Promise((resolve, reject) => {
      if (typeof mammoth === 'undefined') { reject(new Error('Word-parsing library did not load. Check your connection and try again.')); return; }
      const reader = new FileReader();
      reader.onload = (e) => {
        mammoth.convertToHtml({ arrayBuffer: e.target.result })
          .then(result => resolve(result.value))
          .catch(reject);
      };
      reader.onerror = () => reject(new Error('Could not read that file.'));
      reader.readAsArrayBuffer(file);
    });
  }

  function parseWordHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const elements = Array.from(doc.body.children);

    // Count how often each heading level (1-6) appears.
    const headingCounts = {};
    elements.forEach(el => {
      const m = el.tagName.match(/^H([1-6])$/);
      if (m) headingCounts[m[1]] = (headingCounts[m[1]] || 0) + 1;
    });
    // A heading level only counts as a structural marker if it repeats —
    // a single H1 is almost always just the document title.
    const recurringLevels = Object.keys(headingCounts).map(Number).filter(l => headingCounts[l] >= 2).sort((a, b) => a - b);
    const milestoneLevel = recurringLevels[0] || null;
    const taskLevel = recurringLevels.find(l => l > milestoneLevel) || null;

    const rows = [];
    elements.forEach(el => {
      const text = el.textContent.replace(/\s+/g, ' ').trim();
      if (!text) return;
      const headingMatch = el.tagName.match(/^H([1-6])$/);

      if (headingMatch) {
        const level = Number(headingMatch[1]);
        if (milestoneLevel && level === milestoneLevel) rows.push({ id: uid(), level: 'milestone', name: text });
        else if (taskLevel && level === taskLevel) rows.push({ id: uid(), level: 'task', name: text });
        else if (milestoneLevel && level > (taskLevel || milestoneLevel)) rows.push({ id: uid(), level: 'task', name: text });
        // a non-recurring heading (e.g. the lone document title) is skipped
        return;
      }

      if (el.tagName === 'UL' || el.tagName === 'OL') {
        Array.from(el.querySelectorAll('li')).forEach(li => {
          const liText = li.textContent.replace(/\s+/g, ' ').trim();
          if (liText) rows.push({ id: uid(), level: 'subtask', name: liText });
        });
        return;
      }

      if (el.tagName === 'P') {
        // No recognizable heading structure in this doc at all -> fall back
        // to the same line-by-line convention used for pasted text.
        if (!milestoneLevel) {
          const classified = classifyLine(text);
          if (classified) rows.push({ id: uid(), ...classified });
        } else {
          // Structured doc: only pick up stray bullet-style paragraphs
          // (Word sometimes exports unstyled "- item" lines as plain <p>);
          // ignore other prose so we don't turn narrative text into tasks.
          const m = text.match(/^[-*•·]\s+(.*)/);
          if (m) rows.push({ id: uid(), level: 'subtask', name: m[1].trim() });
        }
      }
    });
    return rows;
  }

  // ---------------- preview row rendering ----------------
  const LEVEL_LABEL = { milestone: 'Milestone', task: 'Task', subtask: 'Subtask' };

  function rowHtml(row) {
    return `
      <div class="imp-row imp-row--${row.level}" data-id="${row.id}">
        <select class="imp-row__level">
          ${['milestone', 'task', 'subtask'].map(l => `<option value="${l}" ${row.level === l ? 'selected' : ''}>${LEVEL_LABEL[l]}</option>`).join('')}
        </select>
        <input type="text" class="imp-row__name" value="${Utils.escapeHtml(row.name)}" placeholder="Name">
        <button type="button" class="icon-btn imp-row__remove" title="Remove row">✕</button>
      </div>
    `;
  }

  function renderRows(host) {
    host.innerHTML = state.rows.length
      ? state.rows.map(rowHtml).join('')
      : `<div class="text-faint" style="padding:10px 0;">Nothing parsed yet. Go back and paste some text or upload a file.</div>`;
    bindRowEvents(host);
  }

  function bindRowEvents(host) {
    host.querySelectorAll('.imp-row').forEach(el => {
      const id = el.dataset.id;
      el.querySelector('.imp-row__level').addEventListener('change', (e) => {
        const row = state.rows.find(r => r.id === id);
        if (row) row.level = e.target.value;
        el.className = `imp-row imp-row--${e.target.value}`;
        updateSummary(host);
      });
      el.querySelector('.imp-row__name').addEventListener('input', (e) => {
        const row = state.rows.find(r => r.id === id);
        if (row) row.name = e.target.value;
      });
      el.querySelector('.imp-row__remove').addEventListener('click', () => {
        state.rows = state.rows.filter(r => r.id !== id);
        renderRows(host);
        updateSummary(host);
      });
    });
  }

  function updateSummary(host) {
    const wrap = host.closest('.modal__body') || document;
    const el = wrap.querySelector('#imp_summary');
    if (!el) return;
    const counts = { milestone: 0, task: 0, subtask: 0 };
    state.rows.forEach(r => counts[r.level]++);
    el.textContent = `${counts.milestone} milestone${counts.milestone === 1 ? '' : 's'} · ${counts.task} task${counts.task === 1 ? '' : 's'} · ${counts.subtask} subtask${counts.subtask === 1 ? '' : 's'}`;
  }

  // ---------------- tree building + creation ----------------
  function buildTree(rows) {
    const milestones = []; // { name, tasks: [{ name, meta, subtasks:[name,...] }] }
    let curMilestone = null, curTask = null;

    function ensureMilestone() {
      if (!curMilestone) {
        curMilestone = { name: 'General', tasks: [] };
        milestones.push(curMilestone);
      }
      return curMilestone;
    }
    function ensureTask() {
      ensureMilestone();
      if (!curTask) {
        curTask = { name: 'General Tasks', meta: {}, subtasks: [] };
        curMilestone.tasks.push(curTask);
      }
      return curTask;
    }

    rows.forEach(r => {
      const name = r.name.trim();
      if (!name) return;
      if (r.level === 'milestone') {
        curMilestone = { name, tasks: [] };
        milestones.push(curMilestone);
        curTask = null;
      } else if (r.level === 'task') {
        ensureMilestone();
        curTask = { name, meta: r.meta || {}, subtasks: [] };
        curMilestone.tasks.push(curTask);
      } else {
        ensureTask();
        curTask.subtasks.push(name);
      }
    });
    return milestones.filter(m => m.tasks.length || m.name !== 'General');
  }

  function spreadDate(startISO, dueISO, index, total) {
    if (!startISO || !dueISO) return dueISO || startISO || Utils.todayISO();
    const totalDays = Math.max(0, Utils.daysBetween(startISO, dueISO));
    const fraction = total > 1 ? index / (total - 1) : (total === 1 ? 1 : 0);
    return Utils.addDays(startISO, Math.round(totalDays * fraction));
  }

  async function createProjectFromTree(projectFields, milestoneTree) {
    const project = {
      id: Utils.uid('proj'),
      name: projectFields.name || 'Untitled Project',
      description: '',
      owner: projectFields.owner,
      department: projectFields.department,
      startDate: projectFields.startDate,
      dueDate: projectFields.dueDate,
      priority: projectFields.priority,
      status: 'Not Started',
      portfolioId: null,
      tags: [],
      budget: null,
      actualCost: null,
      progress: 0,
      color: projectFields.color,
      archived: false,
      createdAt: Date.now()
    };

    const newMilestones = milestoneTree.map((m, i) => ({
      id: Utils.uid('mile'),
      projectId: project.id,
      name: m.name,
      description: '',
      owner: project.owner,
      status: 'Not Started',
      plannedDate: spreadDate(project.startDate, project.dueDate, i, milestoneTree.length),
      actualDate: null,
      completion: 0,
      dependsOn: null,
      createdAt: Date.now()
    }));

    const flatTasks = [];
    milestoneTree.forEach((m, mi) => m.tasks.forEach(t => flatTasks.push({ ...t, milestoneId: newMilestones[mi].id })));

    const newTasks = flatTasks.map((t, i) => {
      const spread = spreadDate(project.startDate, project.dueDate, i, flatTasks.length);
      // t.meta.dueDate (when present) comes from free-text parsed out of the
      // source document/paste, so it isn't guaranteed to be sane — every
      // imported task's startDate is fixed to project.startDate, so guard
      // against a parsed dueDate landing before it (same rule as the Task
      // dialog: due can equal start, just never be earlier).
      const metaDue = t.meta && t.meta.dueDate;
      const dueDate = (metaDue && metaDue >= project.startDate) ? metaDue : spread;
      const rawPriority = t.meta && t.meta.priority ? String(t.meta.priority).trim().toLowerCase() : '';
      const matchedPriority = PRIORITIES.find(p => p.toLowerCase() === rawPriority);
      return {
        id: Utils.uid('task'),
        name: t.name,
        description: '',
        projectId: project.id,
        milestoneId: t.milestoneId,
        assignedTo: (t.meta && t.meta.assignee) || project.owner,
        // Imported tasks are always real tasks, never milestones — even
        // though spreadDate() can legitimately land dueDate === startDate
        // for early items (e.g. i=0), which must still render as a bar.
        type: 'task',
        startDate: project.startDate,
        dueDate,
        priority: matchedPriority || 'Medium',
        status: 'Not Started',
        progress: 0,
        subtasks: t.subtasks.map(name => ({ id: Utils.uid('subtask'), name, completed: false })),
        estimatedHours: 0,
        actualHours: 0,
        dependencies: [],
        comments: [],
        createdAt: Date.now()
      };
    });

    await DataStore.setProjects([...DataStore.getProjects(), project]);
    if (newMilestones.length) await DataStore.setMilestones([...DataStore.getMilestones(), ...newMilestones]);
    if (newTasks.length) await DataStore.setTasks([...DataStore.getTasks(), ...newTasks]);

    return { project, milestoneCount: newMilestones.length, taskCount: newTasks.length, subtaskCount: newTasks.reduce((n, t) => n + t.subtasks.length, 0) };
  }

  // ---------------- step 1: source + basics ----------------
  function projectFieldsHtml(p) {
    return `
      <div class="form-grid">
        <div class="form-field span-2"><label>Project Name</label><input type="text" id="imp_name" value="${Utils.escapeHtml(p.name)}" placeholder="e.g. Logistics Cost Dashboard"></div>
        <div class="form-field"><label>Owner</label><select id="imp_owner">${Utils.managerOptionsHtml(p.owner)}</select></div>
        <div class="form-field"><label>Department</label><input type="text" id="imp_dept" value="${Utils.escapeHtml(p.department)}"></div>
        <div class="form-field"><label>Start Date</label><input type="date" id="imp_start" value="${p.startDate}"></div>
        <div class="form-field"><label>Due Date</label><input type="date" id="imp_due" value="${p.dueDate}"></div>
        <div class="form-field"><label>Priority</label><select id="imp_priority">${PRIORITIES.map(x => `<option ${p.priority === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
        <div class="form-field span-2"><label>Color</label><div class="color-picker" id="imp_colorPicker">${Utils.colorPickerHtml(p.color)}</div></div>
      </div>
    `;
  }

  function sourceHtml(source, text) {
    return `
      <div class="panel__title" style="margin-top:18px;">Project Plan</div>
      <div class="flex gap-8" style="margin-bottom:10px;">
        <label class="flex gap-8" style="cursor:pointer;"><input type="radio" name="imp_source" value="paste" ${source === 'paste' ? 'checked' : ''}> Paste text</label>
        <label class="flex gap-8" style="cursor:pointer;"><input type="radio" name="imp_source" value="file" ${source === 'file' ? 'checked' : ''}> Upload Word document</label>
      </div>
      <div id="imp_pasteWrap" style="${source === 'paste' ? '' : 'display:none;'}">
        <div class="form-field__hint" style="margin-bottom:6px;">
          A line starting with <strong>Phase</strong> (or <code>#</code>) becomes a <strong>Milestone</strong>. A plain line becomes a <strong>Task</strong>. A line starting with <code>-</code>, <code>*</code>, <code>•</code> (or indented) becomes a <strong>Subtask</strong>. You'll get to fix any of these on the next screen.
        </div>
        <textarea id="imp_pasteArea" style="min-height:220px; font-family: var(--font-mono); font-size:12.5px; width:100%;" placeholder="Phase 1 - Project Initiation
Project Kickoff
- Identify stakeholders
- Conduct kickoff meeting
Phase 2 - Source System Analysis
Source System Identification
- Identify SQL databases">${Utils.escapeHtml(text)}</textarea>
      </div>
      <div id="imp_fileWrap" style="${source === 'file' ? '' : 'display:none;'}">
        <div class="form-field__hint" style="margin-bottom:6px;">Uses your document's own <strong>Heading</strong> styles: the heading level that repeats (e.g. "Phase 1", "Phase 2"...) becomes a <strong>Milestone</strong>, the heading level nested under it becomes a <strong>Task</strong>, and any bulleted/numbered list becomes <strong>Subtasks</strong>. Only <code>.docx</code> is supported — an old-format <code>.doc</code> file will need to be re-saved as <code>.docx</code> first.</div>
        <input type="file" id="imp_fileInput" accept=".docx">
        <div id="imp_fileStatus" class="text-faint" style="margin-top:6px; font-size:12px;"></div>
      </div>
    `;
  }

  function openModal() {
    state = {
      source: 'paste',
      text: '',
      rows: [],
      project: {
        name: '', owner: '', department: '',
        startDate: Utils.todayISO(), dueDate: Utils.addDays(Utils.todayISO(), 60),
        priority: 'Medium', color: 'indigo'
      }
    };
    renderStep1();
  }

  function readProjectFields(root) {
    return {
      name: root.querySelector('#imp_name').value.trim(),
      owner: root.querySelector('#imp_owner').value,
      department: root.querySelector('#imp_dept').value.trim(),
      startDate: root.querySelector('#imp_start').value || Utils.todayISO(),
      dueDate: root.querySelector('#imp_due').value || Utils.todayISO(),
      priority: root.querySelector('#imp_priority').value
    };
  }

  function renderStep1() {
    let getColor;
    Utils.openModal({
      title: 'Import Project',
      wide: true,
      bodyHtml: projectFieldsHtml(state.project) + sourceHtml(state.source, state.text),
      footerHtml: `<button class="btn-secondary" data-close>Cancel</button><button class="btn-primary" id="impParseBtn">Parse &amp; Preview →</button>`,
      onMount: (root, close) => {
        getColor = Utils.bindColorPicker(root);
        root.querySelector('[data-close]').addEventListener('click', close);

        root.querySelectorAll('input[name="imp_source"]').forEach(r => r.addEventListener('change', (e) => {
          state.source = e.target.value;
          root.querySelector('#imp_pasteWrap').style.display = state.source === 'paste' ? '' : 'none';
          root.querySelector('#imp_fileWrap').style.display = state.source === 'file' ? '' : 'none';
        }));

        let pendingHtml = null;
        const fileInput = root.querySelector('#imp_fileInput');
        const fileStatus = root.querySelector('#imp_fileStatus');
        fileInput.addEventListener('change', async () => {
          const file = fileInput.files[0];
          if (!file) return;
          if (!/\.docx$/i.test(file.name)) {
            pendingHtml = null;
            fileStatus.textContent = 'Please choose a .docx file (old-format .doc isn\'t supported — re-save it as .docx first).';
            return;
          }
          fileStatus.textContent = 'Reading document…';
          try {
            pendingHtml = await readWordFile(file);
            fileStatus.textContent = `Loaded "${file.name}".`;
          } catch (err) {
            pendingHtml = null;
            fileStatus.textContent = err.message || 'Could not read that file.';
          }
        });

        root.querySelector('#impParseBtn').addEventListener('click', () => {
          const fields = readProjectFields(root);
          if (!fields.name) { Utils.toast('Give the project a name first'); return; }
          if (fields.startDate && fields.dueDate && fields.dueDate < fields.startDate) { Utils.toast('Due date is before the start date'); return; }
          state.project = { ...fields, color: getColor() };

          if (state.source === 'paste') {
            state.text = root.querySelector('#imp_pasteArea').value;
            if (!state.text.trim()) { Utils.toast('Paste your project planner text first'); return; }
            state.rows = parseOutlineText(state.text);
            close();
            renderStep2();
          } else {
            if (!pendingHtml) { Utils.toast('Choose a Word (.docx) file to upload first'); return; }
            state.rows = parseWordHtml(pendingHtml);
            close();
            renderStep2();
          }
        });
      }
    });
  }

  function renderStep2() {
    Utils.openModal({
      title: `Import Project — Preview "${state.project.name}"`,
      wide: true,
      bodyHtml: `
        <div class="form-field__hint" style="margin-bottom:10px;">Review what will be created. Change a row's type with the dropdown, edit its name, or remove it — order matters: a Task attaches to the Milestone above it, a Subtask attaches to the Task above it.</div>
        <div id="imp_summary" class="text-faint" style="margin-bottom:8px; font-size:12.5px; font-weight:600;"></div>
        <div id="imp_rows" style="max-height:380px; overflow-y:auto; display:flex; flex-direction:column; gap:6px; padding-right:4px;"></div>
        <button type="button" class="btn-secondary btn-sm" id="imp_addRow" style="margin-top:10px;">+ Add Row</button>
      `,
      footerHtml: `<button class="btn-secondary" id="impBackBtn">← Back</button><button class="btn-primary" id="impCreateBtn">Create Project</button>`,
      onMount: (root, close) => {
        const rowsHost = root.querySelector('#imp_rows');
        renderRows(rowsHost);
        updateSummary(rowsHost);

        root.querySelector('#imp_addRow').addEventListener('click', () => {
          state.rows.push({ id: uid(), level: 'task', name: '' });
          renderRows(rowsHost);
          updateSummary(rowsHost);
          const inputs = rowsHost.querySelectorAll('.imp-row__name');
          if (inputs.length) inputs[inputs.length - 1].focus();
        });

        root.querySelector('#impBackBtn').addEventListener('click', () => { close(); renderStep1(); });

        root.querySelector('#impCreateBtn').addEventListener('click', async () => {
          const cleanRows = state.rows.filter(r => r.name.trim());
          if (!cleanRows.length) { Utils.toast('Add at least one row before creating the project'); return; }
          const tree = buildTree(cleanRows);
          const btn = root.querySelector('#impCreateBtn');
          btn.disabled = true;
          btn.textContent = 'Creating…';
          try {
            const result = await createProjectFromTree(state.project, tree);
            Utils.toast(`Created "${result.project.name}" with ${result.milestoneCount} milestone(s), ${result.taskCount} task(s), ${result.subtaskCount} subtask(s)`);
            close();
            App.navigate('projects', { focusId: result.project.id });
          } catch (err) {
            console.error(err);
            Utils.toast('Something went wrong creating the project');
            btn.disabled = false;
            btn.textContent = 'Create Project';
          }
        });
      }
    });
  }

  return { openModal };
})();
