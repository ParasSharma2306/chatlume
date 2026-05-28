/**
 * ChatLume HTML Export
 * Exports the rendered chat as a fully self-contained .html file.
 * All blob: URLs (images, audio) are converted to base64 so the
 * exported file works offline with no external dependencies.
 */

export async function exportChatAsHTML(containerId, filename = 'chat-export.html') {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error('[ChatLume Export] Container not found:', containerId);
    return;
  }

  // Clone — never mutate the live DOM
  const clone = container.cloneNode(true);

  // Convert blob: image URLs to base64
  const imgs = [...clone.querySelectorAll('img')];
  await Promise.all(imgs.map(async (img) => {
    if (img.src && img.src.startsWith('blob:')) {
      try {
        const b64 = await fetchBlobAsBase64(img.src);
        img.src = b64;
      } catch {
        img.removeAttribute('src');
      }
    }
  }));

  // Convert blob: audio URLs to base64
  const audios = [...clone.querySelectorAll('audio')];
  await Promise.all(audios.map(async (audio) => {
    if (audio.src && audio.src.startsWith('blob:')) {
      try {
        const b64 = await fetchBlobAsBase64(audio.src);
        audio.src = b64;
      } catch {
        audio.removeAttribute('src');
      }
    }
  }));

  // Remove export button from clone so it doesn't appear in the export
  clone.querySelectorAll('[data-export-btn]').forEach(el => el.remove());

  // Inline all CSS from the page
  let css = '';
  for (const sheet of [...document.styleSheets]) {
    try {
      css += [...sheet.cssRules].map(r => r.cssText).join('\n') + '\n';
    } catch { /* cross-origin, skip */ }
  }

  // Capture current theme
  const theme = document.documentElement.dataset.theme ||
                document.body.dataset.theme ||
                (document.body.classList.contains('light-theme') ? 'light' : '');

  const exportedAt = new Date().toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  const fullHTML = `<!DOCTYPE html>
<html lang="en"${theme ? ` data-theme="${theme}"` : ''}>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chat Export — ChatLume</title>
  <style>
${css}
    /* Export-only overrides */
    [data-export-btn], .export-btn { display: none !important; }
    body { margin: 0; }
    .chatlume-export-banner {
      text-align: center;
      padding: 10px 16px;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 12px;
      opacity: 0.55;
      border-bottom: 1px solid rgba(128,128,128,0.2);
      margin-bottom: 8px;
    }
    .chatlume-export-banner a {
      color: inherit;
      text-decoration: underline;
    }
  </style>
</head>
<body${theme ? ` class="${theme}-theme"` : ''}>
  <div class="chatlume-export-banner">
    Exported with <a href="https://chatlume.parassharma.in" target="_blank">ChatLume</a> &middot; ${exportedAt}
  </div>
  ${clone.outerHTML}
</body>
</html>`;

  triggerDownload(fullHTML, filename);
}

function fetchBlobAsBase64(blobUrl) {
  return fetch(blobUrl)
    .then(r => r.blob())
    .then(blob => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
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
