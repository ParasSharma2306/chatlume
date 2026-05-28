/**
 * ChatLume HTML Export
 * Produces a fully self-contained .html file from the rendered message list.
 * Blob: URLs (loaded images, video, audio) are serialised to base64 before
 * the file is generated so the export works offline with no dependencies.
 *
 * @param {string}   containerId  ID of the message-list element to export
 * @param {string}   filename     Download filename
 * @param {Function} [onProgress] Called as (completedCount, totalCount) for each converted blob
 */
export async function exportChatAsHTML(containerId, filename = 'chat-export.html', onProgress) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error('[ChatLume Export] Container not found:', containerId);
    return;
  }

  // Clone — never mutate the live DOM
  const clone = container.cloneNode(true);

  // Strip the export button itself from the clone
  clone.querySelectorAll('[data-export-btn]').forEach(el => el.remove());

  // Collect every media element whose src is a live blob: URL
  const blobMedia = [
    ...[...clone.querySelectorAll('img')].filter(el => el.src?.startsWith('blob:')),
    ...[...clone.querySelectorAll('video')].filter(el => el.src?.startsWith('blob:')),
    ...[...clone.querySelectorAll('audio')].filter(el => el.src?.startsWith('blob:')),
  ];
  const total = blobMedia.length;
  let completed = 0;

  // Serialise blob URLs to base64 with a concurrency ceiling of 5
  await runWithConcurrency(blobMedia, 5, async (el) => {
    try {
      el.src = await fetchBlobAsBase64(el.src);
    } catch {
      el.removeAttribute('src');
    }
    onProgress?.(++completed, total);
  });

  // Add lazy loading to every img after conversion so the browser renders on-demand
  clone.querySelectorAll('img').forEach(img => img.setAttribute('loading', 'lazy'));

  // Inline all same-origin stylesheets (cross-origin sheets throw and are silently skipped)
  let css = '';
  for (const sheet of [...document.styleSheets]) {
    try {
      css += [...sheet.cssRules].map(r => r.cssText).join('\n') + '\n';
    } catch { /* cross-origin CDN sheets – skip */ }
  }

  const themeClass = document.body.classList.contains('light-theme') ? 'light-theme' : '';
  const exportedAt = new Date().toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  // Build the exported document.
  // The inlined CSS carries app rules like `body { overflow:hidden; height:100dvh }`
  // that prevent scrolling in a standalone file. The override block below undoes them.
  const fullHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chat Export — ChatLume</title>
  <style>
${css}

/* ── ChatLume Export: scroll + layout reset (appended after inlined CSS) ── */
html, body {
  height: auto !important;
  min-height: unset !important;
  overflow: visible !important;
  overflow-y: auto !important;
}
body {
  /* Remove the app-level background gradient that assumes a full-screen layout */
  background-image: none !important;
}
[data-export-btn], .export-btn { display: none !important; }
/* Export chrome */
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
/* Wrapper that centres and pads the message list */
.chatlume-export-content {
  max-width: 900px;
  margin: 0 auto;
  padding: 8px 5% 32px;
}
/* The cloned message-list must not retain any flex-child or overflow constraints */
#message-list,
#ig-message-list {
  height: auto !important;
  max-height: none !important;
  overflow: visible !important;
  position: static !important;
  flex: none !important;
}
/* Sticky date labels don't work in a flat static document */
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
    ${clone.outerHTML}
  </div>
</body>
</html>`;

  triggerDownload(fullHTML, filename);
}

/**
 * Runs `fn` over every item in `items` with at most `limit` concurrent executions.
 * Safe for any array size, including empty.
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
