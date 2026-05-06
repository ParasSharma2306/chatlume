(function () {
  'use strict';

  // Inject shared nav styles once
  if (!document.getElementById('cl-auth-styles')) {
    const s = document.createElement('style');
    s.id = 'cl-auth-styles';
    s.textContent = `
      .auth-nav-slot {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-left: 8px;
      }
      .nav-auth-email {
        font-size: 13px;
        color: var(--text-secondary);
        max-width: 150px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .nav-pro-badge {
        background: rgba(0,168,132,0.15);
        color: var(--primary);
        border: 1px solid rgba(0,168,132,0.3);
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 11px;
        font-weight: 700;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .nav-auth-link {
        color: var(--text-secondary);
        text-decoration: none;
        font-weight: 500;
        font-size: 14px;
        transition: color 0.2s;
        white-space: nowrap;
      }
      .nav-auth-link:hover { color: var(--primary); }
      .nav-get-pro {
        background: var(--primary);
        color: #fff !important;
        padding: 6px 14px;
        border-radius: 20px;
        font-size: 13px;
        font-weight: 600;
        text-decoration: none;
        white-space: nowrap;
        transition: background 0.2s;
        flex-shrink: 0;
      }
      .nav-get-pro:hover { background: var(--primary-hover); }
      .auth-settings-hint {
        display: none;
        align-items: center;
        gap: 8px;
        background: rgba(0,168,132,0.07);
        border: 1px solid rgba(0,168,132,0.18);
        border-radius: 12px;
        padding: 10px 14px;
        font-size: 13px;
        color: var(--text-secondary);
        margin-bottom: 12px;
        line-height: 1.4;
      }
      .auth-settings-hint a {
        color: var(--primary);
        text-decoration: none;
        font-weight: 500;
      }
      .auth-settings-hint a:hover { text-decoration: underline; }
    `;
    document.head.appendChild(s);
  }

  function _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async function getUser() {
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async function logout() {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    window.location.href = '/';
  }

  async function createCheckout() {
    try {
      const res = await fetch('/api/payments/create-checkout', { method: 'POST' });
      const data = await res.json();
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }
      console.error('No checkoutUrl in response', data);
    } catch (err) {
      console.error('createCheckout error:', err);
    }
  }

  // ── Internal init ───────────────────────────────────────────────────────────

  function _renderNavSlot(slot, user) {
    if (user) {
      const isPro = user.subscription?.status === 'pro';
      slot.innerHTML =
        `<span class="nav-auth-email">${_esc(user.email)}</span>` +
        (isPro ? `<span class="nav-pro-badge">Pro ✨</span>` : '') +
        `<a class="nav-auth-link" href="/account">Account</a>`;
    } else {
      slot.innerHTML =
        `<a class="nav-auth-link" href="/login">Login</a>` +
        `<a class="nav-get-pro" href="/pricing">Get Pro</a>`;
    }
  }

  function _renderSettingsHint(user) {
    const hint = document.getElementById('auth-settings-hint');
    if (!hint) return;
    if (!user) {
      hint.style.display = 'flex';
    }
  }

  function _setFooterYear() {
    const yr = new Date().getFullYear();
    document.querySelectorAll('.footer-year').forEach(el => { el.textContent = yr; });
  }

  async function _init() {
    _setFooterYear();
    const user = await getUser();

    // Redirect away from auth pages if already logged in
    const path = window.location.pathname;
    if (user && (path === '/login' || path === '/signup')) {
      window.location.href = '/account';
      return;
    }

    const slot = document.querySelector('.auth-nav-slot');
    if (slot) _renderNavSlot(slot, user);
    _renderSettingsHint(user);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    // DOM already ready (script loaded with defer or at end of body)
    _init();
  }

  window.ChatLumeAuth = { getUser, logout, createCheckout };
})();
