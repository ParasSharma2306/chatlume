/**
 * ChatLume HTML Export (v1.8.5)
 *
 * Builds a self-contained, themed HTML document from already-parsed message
 * data. Exports can be downloaded as a standalone HTML file or as a ZIP
 * package containing the HTML and its referenced attachments. All CSS is
 * inlined and uses the system font stack, so the files have no dependencies.
 *
 * @param {Object}   opts
 * @param {string}   [opts.filename]      Download filename. Defaults to
 *                                        chatlume-export-YYYY-MM-DD.html
 * @param {"whatsapp"|"instagram"} [opts.theme]  Visual theme.
 * @param {"light"|"dark"} [opts.colorScheme] Viewer color scheme.
 * @param {boolean} [opts.includeAttachments] Package referenced media in ZIP.
 * @param {Map} [opts.mediaStore] Media records keyed by attachment ID.
 * @param {string}   [opts.title]         Chat title shown in the header.
 * @param {number}   [opts.messageCount]  Total message count for the header.
 * @param {Array}    opts.messages        Normalised export items. Each item is
 *   one of:
 *     { type: "date",   label }
 *     { type: "system", text }
 *     { type: "msg", sender, time, isMe, color, text,
 *       media: [{ kind, name }], shareLink?, shareText?, reactions? }
 */
import { buildRichText } from './shared/text.js?v=1.8.5';

export async function exportChatAsHTML({
  filename,
  theme = 'whatsapp',
  colorScheme = 'dark',
  includeAttachments = false,
  mediaStore = new Map(),
  title = 'Chat',
  messageCount = 0,
  messages = [],
} = {}) {
  const today = new Date();
  const dateStamp = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
  const fname = filename || `chatlume-export-${dateStamp}.html`;
  const mediaPaths = includeAttachments ? await collectExportMedia(messages, mediaStore) : new Map();
  const html = buildExportDocument({ theme, colorScheme, title, messageCount, messages, today, mediaPaths });

  if (!includeAttachments) {
    triggerDownload(new Blob([html], { type: 'text/html;charset=utf-8' }), fname);
    return { attachmentCount: 0 };
  }

  const zip = await import('https://cdn.jsdelivr.net/npm/@zip.js/zip.js/+esm');
  const zipWriter = new zip.ZipWriter(new zip.BlobWriter('application/zip'));
  try {
    await zipWriter.add('index.html', new zip.TextReader(html));
    for (const media of mediaPaths.values()) {
      if (media.blob) {
        await zipWriter.add(media.archivePath, new zip.BlobReader(media.blob), { level: 0 });
      }
    }
    const archive = await zipWriter.close();
    triggerDownload(archive, filename || `chatlume-export-${dateStamp}.zip`);
    return { attachmentCount: [...mediaPaths.values()].filter((media) => media.blob).length };
  } catch (error) {
    await zipWriter.close().catch(() => {});
    throw error;
  }
}

async function collectExportMedia(messages, mediaStore) {
  const { BlobWriter } = await import('https://cdn.jsdelivr.net/npm/@zip.js/zip.js/+esm');
  const mediaPaths = new Map();
  let index = 0;

  for (const item of messages) {
    for (const attachment of item?.media || []) {
      if (!attachment.id || mediaPaths.has(attachment.id)) continue;
      const media = mediaStore.get(attachment.id);
      if (!media?.entry) continue;

      const filename = safeArchiveFilename(media.name || attachment.name || `attachment-${index + 1}`);
      const archivePath = `attachments/${String(++index).padStart(4, '0')}-${filename}`;
      const blob = await media.entry.getData(new BlobWriter(media.mime || 'application/octet-stream'));
      mediaPaths.set(attachment.id, {
        archivePath,
        href: archivePath.split('/').map(encodeURIComponent).join('/'),
        blob,
        mime: media.mime || blob.type || 'application/octet-stream',
      });
    }
  }

  return mediaPaths;
}

function safeArchiveFilename(name) {
  return String(name || 'attachment')
    .split(/[\\/]/).pop()
    .replace(/[<>:"|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '') || 'attachment';
}

// ── Constants ──────────────────────────────────────────────────────────────
const MEDIA_NOTICE =
  '⚡ Media files are not included in this export to keep file size minimal and loading fast. ' +
  'Use the filenames shown in the message cards to locate media in your original export folder.';

// kind → emoji icon (spec section 1)
const MEDIA_ICONS = {
  image: '🖼️',
  sticker: '🎭',
  video: '🎥',
  audio: '🎵',
  voice: '🎵',
  document: '📄',
  archive: '📄',
  contact: '📄',
  missing: '📎',
};

const MEDIA_LABELS = {
  image: 'Image',
  sticker: 'Sticker',
  video: 'Video',
  audio: 'Voice note / audio',
  voice: 'Voice note',
  document: 'Document',
  archive: 'Archive',
  contact: 'Contact',
  missing: 'Attachment',
};

// ── Document builder ─────────────────────────────────────────────────────────
function buildExportDocument({ theme, colorScheme, title, messageCount, messages, today, mediaPaths }) {
  const isIg = theme === 'instagram';
  const isLight = colorScheme === 'light';
  const exportedAt = today.toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const body = renderMessages(messages, theme, mediaPaths);
  const includedCount = [...mediaPaths.values()].filter((media) => media.blob).length;
  const mediaNotice = includedCount
    ? `Attachments are included in the <code>attachments</code> folder (${includedCount.toLocaleString()}). Keep that folder beside this HTML file.`
    : MEDIA_NOTICE;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ChatLume Export — ${escapeHtml(title)}</title>
<style>${exportStyles(isIg, isLight)}</style>
</head>
<body class="${isIg ? 'ig' : 'wa'}">
  <div class="ce-wrap">
    <header class="ce-header">
      <div class="ce-brand">${isIg ? '📸' : '💬'} ChatLume Export</div>
      <h1>${escapeHtml(title)}</h1>
      <div class="ce-sub">${escapeHtml(exportedAt)} · ${Number(messageCount).toLocaleString()} messages</div>
    </header>

    <div class="ce-notice">${mediaNotice}</div>

    <main class="ce-list">
${body}
    </main>

    <footer class="ce-footer">
      <p>Generated by ChatLume — <a href="https://chatlume.app" target="_blank" rel="noopener noreferrer">chatlume.app</a>.</p>
    </footer>
  </div>
</body>
</html>`;
}

// ── Message rendering ────────────────────────────────────────────────────────
function renderMessages(messages, theme, mediaPaths) {
  let lastSender = null;
  const out = [];

  for (const item of messages) {
    if (!item) continue;

    if (item.type === 'date') {
      out.push(`      <div class="ce-date">${escapeHtml(item.label || '')}</div>`);
      lastSender = null;
      continue;
    }

    if (item.type === 'system') {
      out.push(`      <div class="ce-system">${renderText(item.text || '', theme)}</div>`);
      lastSender = null;
      continue;
    }

    // msg
    const isFirst = item.sender !== lastSender;
    const rowCls = `ce-row ${item.isMe ? 'sent' : 'received'}${isFirst ? ' first' : ''}`;
    const senderHtml = !item.isMe && isFirst && item.sender
      ? `<div class="ce-sender" style="color:${escapeAttr(item.color || '#888')}">${escapeHtml(item.sender)}</div>`
      : '';
    const textHtml = item.text ? `<div class="ce-text">${renderText(item.text, theme)}</div>` : '';
    const mediaHtml = (item.media && item.media.length) ? renderMediaCards(item.media, mediaPaths) : '';
    const shareHtml = item.shareLink ? renderShare(item.shareLink, item.shareText) : '';
    const reactionsHtml = (item.reactions && item.reactions.length) ? renderReactions(item.reactions) : '';
    const timeHtml = item.time ? `<div class="ce-time">${escapeHtml(item.time)}</div>` : '';

    out.push(
`      <div class="${rowCls}">
        <div class="ce-bubble">${senderHtml}${textHtml}${mediaHtml}${shareHtml}${timeHtml}</div>${reactionsHtml}
      </div>`
    );
    lastSender = item.sender;
  }

  return out.join('\n');
}

function renderMediaCards(media, mediaPaths) {
  return media.map((m) => {
    const kind = m.kind || 'document';
    const icon = MEDIA_ICONS[kind] || MEDIA_ICONS.document;
    const label = MEDIA_LABELS[kind] || 'File';
    const name = m.name || 'attachment';
    const included = m.id && mediaPaths.get(m.id);
    let preview = '';
    if (included) {
      const href = escapeAttr(included.href);
      if (kind === 'image' || kind === 'sticker') {
        preview = `<a class="ce-media-preview-link" href="${href}" target="_blank" rel="noopener noreferrer"><img class="ce-media-preview" src="${href}" alt="${escapeAttr(name)}"></a>`;
      } else if (kind === 'video') {
        preview = `<video class="ce-media-preview" controls preload="metadata"><source src="${href}" type="${escapeAttr(included.mime)}"></video>`;
      } else if (kind === 'audio' || kind === 'voice') {
        preview = `<audio class="ce-media-audio" controls preload="metadata"><source src="${href}" type="${escapeAttr(included.mime)}"></audio>`;
      } else {
        preview = `<a class="ce-media-download" href="${href}" download>Download attachment</a>`;
      }
    }
    return `<div class="ce-media"><div class="ce-media-heading"><span class="ce-media-icon">${icon}</span><span class="ce-media-info"><span class="ce-media-label">${escapeHtml(label)}</span><span class="ce-media-name">${escapeHtml(name)}</span></span></div>${preview}</div>`;
  }).join('');
}

function renderShare(link, text) {
  const label = text ? escapeHtml(text) : escapeHtml(link);
  return `<div class="ce-share">🔗 <a href="${escapeAttr(link)}" target="_blank" rel="noopener noreferrer">${label}</a></div>`;
}

function renderReactions(reactions) {
  const grouped = {};
  reactions.forEach((r) => {
    const emoji = r.reaction || '';
    if (!emoji) return;
    grouped[emoji] = (grouped[emoji] || 0) + 1;
  });
  const pills = Object.entries(grouped)
    .map(([emoji, count]) => `<span class="ce-react">${escapeHtml(emoji)}${count > 1 ? ` ${count}` : ''}</span>`)
    .join('');
  return pills ? `<div class="ce-reactions">${pills}</div>` : '';
}

// Escape, linkify, and apply WhatsApp-style formatting. Newlines → <br>.
// The interleaved link/format pass lives in shared/text.js so the viewer and
// the export can never drift apart on what a message looks like.
function renderText(text, theme) {
  return buildRichText(escapeHtml(text || ''), { formatting: theme !== 'instagram' })
    .replace(/\n/g, '<br>');
}

// ── Theme styles ─────────────────────────────────────────────────────────────
function exportStyles(isIg, isLight) {
  const t = isIg
    ? {
        bg: isLight ? '#ffffff' : '#000000',
        surface: isLight ? '#fafafa' : '#121212',
        text: isLight ? '#262626' : '#f5f5f5',
        muted: isLight ? '#737373' : '#a8a8a8',
        sentBg: 'linear-gradient(135deg, #405DE6 0%, #833AB4 55%, #C13584 100%)',
        sentText: '#ffffff',
        recvBg: isLight ? '#efefef' : '#262626',
        recvText: isLight ? '#262626' : '#f5f5f5',
        accent: '#C13584',
        chip: isLight ? 'rgba(239,239,239,0.92)' : 'rgba(38,38,38,0.92)',
        border: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)',
        link: isLight ? '#385898' : '#7aa7ff',
        textLink: isLight ? '#385898' : '#cbe',
        media: isLight ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.06)',
        share: isLight ? 'rgba(0,0,0,0.025)' : 'rgba(255,255,255,0.05)',
      }
    : {
        bg: isLight ? '#efeae2' : '#0b141a',
        surface: isLight ? '#ffffff' : '#111b21',
        text: isLight ? '#111b21' : '#e9edef',
        muted: isLight ? '#667781' : '#8696a0',
        sentBg: isLight ? '#d9fdd3' : '#005c4b',
        sentText: isLight ? '#111b21' : '#e9edef',
        recvBg: isLight ? '#ffffff' : '#202c33',
        recvText: isLight ? '#111b21' : '#e9edef',
        accent: '#00a884',
        chip: isLight ? 'rgba(255,255,255,0.92)' : 'rgba(24,34,41,0.92)',
        border: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)',
        link: isLight ? '#027eb5' : '#53bdeb',
        textLink: isLight ? '#027eb5' : '#aef',
        media: isLight ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.06)',
        share: isLight ? 'rgba(0,0,0,0.025)' : 'rgba(255,255,255,0.05)',
      };

  return `
*{margin:0;padding:0;box-sizing:border-box;}
html{scroll-behavior:auto;}
body{
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  background:${t.bg};color:${t.text};line-height:1.5;
  -webkit-font-smoothing:antialiased;padding:16px;
}
a{color:${t.link};}
.ce-wrap{max-width:780px;margin:0 auto;}
.ce-header{text-align:center;padding:22px 16px 18px;border-bottom:1px solid ${t.border};margin-bottom:6px;}
.ce-brand{font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${t.accent};}
.ce-header h1{font-size:24px;font-weight:700;margin:8px 0 6px;word-break:break-word;}
.ce-sub{font-size:13px;color:${t.muted};}
.ce-notice{
  background:${t.surface};border:1px solid ${t.border};border-left:3px solid ${t.accent};
  border-radius:10px;padding:12px 16px;margin:16px 0;font-size:13.5px;color:${t.muted};line-height:1.6;
}
.ce-list{display:flex;flex-direction:column;gap:2px;padding:4px 0 24px;}
.ce-date{
  align-self:center;background:${t.chip};color:${t.muted};font-size:12px;font-weight:600;
  padding:5px 14px;border-radius:999px;margin:14px 0 8px;
  backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
}
.ce-system{
  align-self:center;text-align:center;background:${t.surface};color:${t.muted};
  font-size:12px;padding:6px 14px;border-radius:8px;margin:8px 0;max-width:90%;
}
.ce-row{display:flex;flex-direction:column;max-width:78%;margin-bottom:2px;}
.ce-row.first{margin-top:8px;}
.ce-row.received{align-self:flex-start;align-items:flex-start;}
.ce-row.sent{align-self:flex-end;align-items:flex-end;}
.ce-bubble{
  border-radius:16px;padding:7px 11px 6px;font-size:14.5px;position:relative;
  box-shadow:0 1px 1px rgba(0,0,0,0.18);word-break:break-word;overflow-wrap:anywhere;
}
.ce-row.received .ce-bubble{background:${t.recvBg};color:${t.recvText};border-top-left-radius:4px;}
.ce-row.sent .ce-bubble{background:${t.sentBg};color:${t.sentText};border-top-right-radius:4px;}
.ce-row:not(.first) .ce-bubble{border-radius:16px;}
.ce-sender{font-size:12.8px;font-weight:600;margin-bottom:3px;}
.ce-text a{color:${t.textLink};text-decoration:underline;}
.ce-text{white-space:normal;}
.ce-time{font-size:10.5px;color:${t.muted};opacity:0.7;text-align:right;margin-top:3px;}
.ce-row.sent .ce-time{color:rgba(255,255,255,0.7);}
.ce-media{
  margin-top:6px;padding:9px 11px;
  background:${t.media};border:1px solid ${t.border};border-radius:10px;
}
.ce-media-heading{display:flex;align-items:center;gap:10px;min-width:0;}
.ce-media-icon{font-size:22px;flex-shrink:0;line-height:1;}
.ce-media-info{display:flex;flex-direction:column;min-width:0;}
.ce-media-preview-link{display:block;margin-top:9px;}
.ce-media-preview{display:block;max-width:100%;max-height:420px;border-radius:7px;object-fit:contain;}
.ce-media-audio{display:block;width:min(340px,100%);margin-top:9px;}
.ce-media-download{display:inline-block;margin-top:8px;color:${t.link};font-size:13px;}
.ce-media-label{font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:${t.muted};font-weight:600;}
.ce-media-name{
  font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;
  font-size:12.5px;word-break:break-all;
}
.ce-share{
  display:flex;align-items:center;gap:6px;margin-top:6px;padding:8px 11px;
  background:${t.share};border:1px solid ${t.border};border-radius:10px;font-size:13px;
}
.ce-share a{word-break:break-all;}
.ce-reactions{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;}
.ce-react{
  background:${t.surface};border:1px solid ${t.border};border-radius:12px;
  padding:2px 8px;font-size:13px;
}
.ce-footer{
  text-align:center;padding:24px 16px 12px;margin-top:12px;border-top:1px solid ${t.border};
  font-size:12px;color:${t.muted};line-height:1.7;
}
.ce-footer a{color:${t.accent};}
@media (max-width:600px){
  .ce-row{max-width:88%;}
  body{padding:10px;}
}
`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function pad2(n) {
  return String(n).padStart(2, '0');
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function triggerDownload(htmlString, filename) {
  const blob = htmlString instanceof Blob
    ? htmlString
    : new Blob([htmlString], { type: 'text/html;charset=utf-8' });
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
