/**
 * ChatLume HTML Export
 *
 * @param {Object}   opts
 * @param {string}   opts.filename      Download filename
 * @param {Function} opts.renderAllFn   Returns an HTML string of the complete
 *                                      message list element (all messages, not
 *                                      just the current DOM window).
 * @param {Function} [opts.onProgress]  Called as (completedCount, totalCount)
 *                                      after each blob→base64 conversion.
 */
export async function exportChatAsHTML({ filename = 'chat-export.html', renderAllFn, onProgress } = {}) {
  if (!renderAllFn) {
    console.error('[ChatLume Export] renderAllFn is required');
    return;
  }

  // Render ALL messages (bypasses the 180-item virtual-scroll window)
  const messagesHtml = renderAllFn();

  // Wrap in a temporary container so we can manipulate elements in-memory
  const temp = document.createElement('div');
  temp.innerHTML = messagesHtml;

  // Collect every media element whose src is a live blob: URL.
  // (Elements that were never scrolled into view have no src, so they're skipped.)
  const blobMedia = [
    ...[...temp.querySelectorAll('img')].filter(el => el.src?.startsWith('blob:')),
    ...[...temp.querySelectorAll('video')].filter(el => el.src?.startsWith('blob:')),
    ...[...temp.querySelectorAll('audio')].filter(el => el.src?.startsWith('blob:')),
  ];
  const total = blobMedia.length;
  let completed = 0;

  // Convert blob URLs to base64 with a concurrency ceiling of 5
  await runWithConcurrency(blobMedia, 5, async (el) => {
    try {
      el.src = await fetchBlobAsBase64(el.src);
    } catch {
      el.removeAttribute('src');
    }
    onProgress?.(++completed, total);
  });

  // Browser-native lazy rendering: images load as the user scrolls, not all at once
  temp.querySelectorAll('img').forEach(img => img.setAttribute('loading', 'lazy'));

  // Inline all same-origin stylesheets (cross-origin CDN sheets are silently skipped)
  let css = '';
  for (const sheet of [...document.styleSheets]) {
    try {
      css += [...sheet.cssRules].map(r => r.cssText).join('\n') + '\n';
    } catch { /* cross-origin – skip */ }
  }

  const themeClass = document.body.classList.contains('light-theme') ? 'light-theme' : '';
  const exportedAt = new Date().toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  // The inlined CSS contains app-specific rules (body{overflow:hidden;height:100dvh})
  // that break a static page. The override block appended below undoes them.
  const fullHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chat Export — ChatLume</title>
  <script>window.onload = function() { window.scrollTo(0, 0); }<\/script>
  <style>
${css}

/* ── ChatLume Export: scroll + layout reset (appended after inlined CSS) ── */
html, body {
  height: auto !important;
  min-height: unset !important;
  overflow: visible !important;
  overflow-y: auto !important;
  scroll-behavior: auto !important;
}
body {
  background-image: none !important;
}
[data-export-btn], .export-btn { display: none !important; }
.chatlume-export-banner {
  text-align: center;
  padding: 10px 16px;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 12px;
  opacity: 0.55;
  border-bottom: 1px solid rgba(128,128,128,0.2);
  margin-bottom: 8px;
}
.chatlume-export-banner a { color: inherit; text-decoration: underline; }
.chatlume-export-content {
  max-width: 900px;
  margin: 0 auto;
  padding: 8px 5% 32px;
}
#message-list,
#ig-message-list {
  height: auto !important;
  max-height: none !important;
  overflow: visible !important;
  position: static !important;
  flex: none !important;
}
.sticky-date {
  position: static !important;
  top: unset !important;
}
  </style>
</head>
<body${themeClass ? ` class="${themeClass}"` : ''}>
  <div class="chatlume-export-banner">
    Exported with <a href="https://chatlume.parassharma.in" target="_blank">ChatLume</a> &middot; ${exportedAt}
  </div>
  <div class="chatlume-export-content">
    ${temp.innerHTML}
  </div>
</body>
</html>`;

  triggerDownload(fullHTML, filename);
}

/**
 * Runs fn over every item with at most `limit` concurrent executions.
 */
async function runWithConcurrency(items, limit, fn) {
  if (!items.length) return;
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      let item;
      while ((item = queue.shift()) !== undefined) {
        await fn(item);
      }
    })
  );
}

function fetchBlobAsBase64(blobUrl) {
  return fetch(blobUrl)
    .then(r => r.blob())
    .then(blob => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(/** @type {string} */ (reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    }));
}

function triggerDownload(htmlString, filename) {
  const blob = new Blob([htmlString], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
