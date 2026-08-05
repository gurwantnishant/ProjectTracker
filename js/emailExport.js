/* ============================================================
   EMAILEXPORT.JS
   Exports the currently-viewed dashboard (org overview or a
   single project) as PNG and/or PDF, then opens the user's
   default mail client (Outlook desktop via mailto:) with a
   pre-filled subject/body so they can attach the just-downloaded
   file(s) and send.

   Zero-infrastructure by design: no server, no OAuth, no build
   step. html2canvas / jsPDF are loaded on demand from a small
   set of CDN mirrors so this still works even if one CDN is
   blocked on a corporate network. If every mirror is blocked,
   the modal degrades gracefully to a text-only email (no
   attachment) instead of failing silently.
   ============================================================ */

const EmailExport = (() => {

  const H2C_SOURCES = [
    'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
    'https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js'
  ];
  const JSPDF_SOURCES = [
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
    'https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js'
  ];

  function loadScriptOnce(url) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${url}"]`);
      if (existing) { existing.addEventListener('load', resolve); existing.addEventListener('error', reject); if (existing.dataset.loaded) resolve(); return; }
      const s = document.createElement('script');
      s.src = url;
      s.onload = () => { s.dataset.loaded = '1'; resolve(); };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function loadWithFallback(sources, isReady) {
    if (isReady()) return true;
    for (const url of sources) {
      try {
        await loadScriptOnce(url);
        if (isReady()) return true;
      } catch (e) { /* try next mirror */ }
    }
    return false;
  }

  async function ensureHtml2Canvas() {
    return loadWithFallback(H2C_SOURCES, () => typeof window.html2canvas === 'function');
  }
  async function ensureJsPdf() {
    return loadWithFallback(JSPDF_SOURCES, () => !!(window.jspdf && window.jspdf.jsPDF));
  }

  function slug(str) {
    return (str || 'dashboard').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function captureCanvas(node) {
    return window.html2canvas(node, {
      backgroundColor: getComputedStyle(document.body).backgroundColor || '#ffffff',
      scale: Math.min(2, window.devicePixelRatio || 1.5),
      useCORS: true,
      logging: false
    });
  }

  async function buildPngBlob(node) {
    const canvas = await captureCanvas(node);
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  }

  async function buildPdfBlob(node) {
    const canvas = await captureCanvas(node);
    const { jsPDF } = window.jspdf;
    const imgData = canvas.toDataURL('image/png');
    const pageWidthMm = 210; // A4 portrait width
    const marginMm = 8;
    const usableWidthMm = pageWidthMm - marginMm * 2;
    const imgWidthMm = usableWidthMm;
    const imgHeightMm = (canvas.height / canvas.width) * imgWidthMm;

    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const pageHeightMm = pdf.internal.pageSize.getHeight();
    const usableHeightMm = pageHeightMm - marginMm * 2;

    if (imgHeightMm <= usableHeightMm) {
      pdf.addImage(imgData, 'PNG', marginMm, marginMm, imgWidthMm, imgHeightMm);
    } else {
      // Slice the tall canvas into page-sized chunks
      const scale = canvas.width / imgWidthMm; // px per mm
      const pageSlicePx = usableHeightMm * scale;
      let renderedPx = 0;
      let first = true;
      while (renderedPx < canvas.height) {
        const sliceHeightPx = Math.min(pageSlicePx, canvas.height - renderedPx);
        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = sliceHeightPx;
        const ctx = sliceCanvas.getContext('2d');
        ctx.drawImage(canvas, 0, renderedPx, canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx);
        const sliceData = sliceCanvas.toDataURL('image/png');
        if (!first) pdf.addPage();
        pdf.addImage(sliceData, 'PNG', marginMm, marginMm, imgWidthMm, (sliceHeightPx / canvas.width) * imgWidthMm);
        renderedPx += sliceHeightPx;
        first = false;
      }
    }
    return pdf.output('blob');
  }

  function defaultSubject(label) {
    return `FlowSpace Dashboard – ${label} – ${Utils.fmtDate(Utils.todayISO())}`;
  }

  function defaultBody(label, filenames) {
    return [
      `Hi,`,
      ``,
      `Sharing the current FlowSpace dashboard for ${label}.`,
      ``,
      filenames.length ? `Please attach: ${filenames.join(', ')} (just downloaded to your Downloads folder).` : ``,
      ``,
      `Thanks,`
    ].filter(Boolean).join('\n');
  }

  function buildMailto({ to, cc, subject, body }) {
    // The "to" segment of a mailto: URI keeps @ and , unescaped; only the
    // query params (cc/subject/body) need standard encoding.
    const params = new URLSearchParams();
    if (cc) params.set('cc', cc);
    params.set('subject', subject);
    params.set('body', body);
    return `mailto:${to || ''}?${params.toString()}`;
  }

  function openModal(getCaptureNode, label) {
    const today = Utils.todayISO();
    const suggestedName = `FlowSpace-${slug(label)}-${today}`;

    const bodyHtml = `
      <div class="form-grid">
        <div class="form-field span-2"><label>To</label><input type="text" id="ee_to" placeholder="name@panasonic.com, name2@panasonic.com"></div>
        <div class="form-field span-2"><label>Cc (optional)</label><input type="text" id="ee_cc" placeholder=""></div>
        <div class="form-field span-2"><label>Subject</label><input type="text" id="ee_subject" value="${Utils.escapeHtml(defaultSubject(label))}"></div>
        <div class="form-field span-2"><label>Message</label><textarea id="ee_message" rows="5">${Utils.escapeHtml(defaultBody(label, []))}</textarea></div>
        <div class="form-field span-2">
          <label>Attach as</label>
          <div style="display:flex; gap:16px; margin-top:4px;">
            <label style="display:flex; align-items:center; gap:6px; font-weight:500;"><input type="checkbox" id="ee_png" checked> PNG snapshot</label>
            <label style="display:flex; align-items:center; gap:6px; font-weight:500;"><input type="checkbox" id="ee_pdf" checked> PDF report</label>
          </div>
        </div>
        <div class="form-field span-2" id="ee_note" style="font-size:12.5px; color:var(--ink-faint);">
          Browsers can't attach files to an email automatically. Clicking "Generate &amp; Open Outlook" will download the file(s) below, then open a new Outlook message with the subject/body filled in — just drag the downloaded file(s) into it.
        </div>
      </div>
    `;

    const footerHtml = `
      <button class="btn-secondary" data-close>Cancel</button>
      <button class="btn-primary" id="ee_go">Generate &amp; Open Outlook</button>
    `;

    Utils.openModal({
      title: '📧 Email Dashboard',
      bodyHtml,
      footerHtml,
      onMount: (root, close) => {
        root.querySelector('[data-close]').addEventListener('click', close);
        const goBtn = root.querySelector('#ee_go');

        goBtn.addEventListener('click', async () => {
          const to = root.querySelector('#ee_to').value.trim();
          const cc = root.querySelector('#ee_cc').value.trim();
          const subject = root.querySelector('#ee_subject').value.trim() || defaultSubject(label);
          const wantPng = root.querySelector('#ee_png').checked;
          const wantPdf = root.querySelector('#ee_pdf').checked;
          const userMessage = root.querySelector('#ee_message').value;

          if (!wantPng && !wantPdf) {
            Utils.toast('Pick at least one attachment format', { tone: 'error' });
            return;
          }

          goBtn.disabled = true;
          const originalLabel = goBtn.textContent;
          goBtn.textContent = 'Generating…';

          const node = getCaptureNode();
          if (!node) {
            Utils.toast('Could not find the dashboard content to export', { tone: 'error' });
            goBtn.disabled = false;
            goBtn.textContent = originalLabel;
            return;
          }

          const filenames = [];
          let anyGenerated = false;

          try {
            const canvasReady = await ensureHtml2Canvas();
            if (!canvasReady) {
              Utils.toast('Could not load the export library (network/proxy may be blocking it). Opening Outlook without an attachment — you can screenshot the dashboard manually.', { tone: 'error', duration: 8000 });
            } else {
              if (wantPng) {
                const pngBlob = await buildPngBlob(node);
                if (pngBlob) {
                  const fname = `${suggestedName}.png`;
                  downloadBlob(pngBlob, fname);
                  filenames.push(fname);
                  anyGenerated = true;
                }
              }
              if (wantPdf) {
                const pdfReady = await ensureJsPdf();
                if (pdfReady) {
                  const pdfBlob = await buildPdfBlob(node);
                  if (pdfBlob) {
                    const fname = `${suggestedName}.pdf`;
                    downloadBlob(pdfBlob, fname);
                    filenames.push(fname);
                    anyGenerated = true;
                  }
                } else {
                  Utils.toast('PDF library unavailable — sent PNG only.', { tone: 'error' });
                }
              }
            }
          } catch (err) {
            console.error('EmailExport generation failed:', err);
            Utils.toast('Export failed — opening Outlook without an attachment.', { tone: 'error', duration: 6000 });
          }

          // Rebuild the body to mention the actual files we produced (fall back to user's edited text otherwise)
          const finalBody = filenames.length
            ? (userMessage.includes(filenames[0]) ? userMessage : `${userMessage}\n\n(Attach: ${filenames.join(', ')})`)
            : userMessage;

          const mailto = buildMailto({ to, cc, subject, body: finalBody });
          window.location.href = mailto;

          if (anyGenerated) {
            Utils.toast(`Downloaded ${filenames.join(' & ')} — attach in the Outlook window that just opened.`, { duration: 7000 });
          }

          close();
        });
      }
    });
  }

  return { openModal };
})();
