(function() {
  if (window.__CM_CONSOLE_BRIDGE) return;
  window.__CM_CONSOLE_BRIDGE = true;
  window.__CM_CONSOLE_BUFFER = [];
  window.__CM_CONSOLE_LOG = [];

  var MAX_ENTRIES = 500;
  var ORIG = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
  };

  function serialize(args) {
    return Array.from(args).map(function(a) {
      if (a === null) return 'null';
      if (a === undefined) return 'undefined';
      if (a instanceof Error) return a.stack || a.message || String(a);
      if (typeof a === 'object') {
        try { return JSON.stringify(a, null, 2); }
        catch(e) { return String(a); }
      }
      return String(a);
    }).join(' ');
  }

  function capture(level, args) {
    var entry = {
      level: level,
      ts: new Date().toISOString(),
      msg: serialize(args),
      url: window.location.href,
    };
    if (level === 'error') {
      try { entry.stack = new Error().stack; } catch(e) {}
    }
    window.__CM_CONSOLE_BUFFER.push(entry);
    if (window.__CM_CONSOLE_BUFFER.length > MAX_ENTRIES) {
      window.__CM_CONSOLE_BUFFER.shift();
    }
    // Also keep a local display copy for the console drawer
    window.__CM_CONSOLE_LOG.push(entry);
    if (window.__CM_CONSOLE_LOG.length > MAX_ENTRIES) {
      window.__CM_CONSOLE_LOG.shift();
    }
    updateConsoleBadge();
    if (window.__CM_DRAWER_OPEN) {
      renderConsoleEntries();
    }
  }

  console.log = function() { capture('log', arguments); ORIG.log.apply(console, arguments); };
  console.warn = function() { capture('warn', arguments); ORIG.warn.apply(console, arguments); };
  console.error = function() { capture('error', arguments); ORIG.error.apply(console, arguments); };
  console.info = function() { capture('info', arguments); ORIG.info.apply(console, arguments); };
  console.debug = function() { capture('debug', arguments); ORIG.debug.apply(console, arguments); };

  window.addEventListener('error', function(e) {
    capture('error', ['Uncaught ' + (e.error ? e.error.name + ': ' : '') + e.message + ' at ' + e.filename + ':' + e.lineno + ':' + e.colno]);
  });
  window.addEventListener('unhandledrejection', function(e) {
    capture('error', ['Unhandled Promise Rejection: ' + (e.reason ? (e.reason.message || String(e.reason)) : 'unknown')]);
  });

  // ── Toolbar ──────────────────────────────────────────────────────────────
  var TOOLBAR_HEIGHT = 36;
  var toolbar = document.createElement('div');
  toolbar.id = '__cm_toolbar';
  toolbar.style.cssText = 'position:fixed;top:0;left:0;right:0;height:' + TOOLBAR_HEIGHT + 'px;' +
    'background:#1e1e2e;color:#cdd6f4;display:flex;align-items:center;gap:4px;padding:0 8px;' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:12px;' +
    'z-index:2147483646;box-shadow:0 1px 3px rgba(0,0,0,0.3);user-select:none;-webkit-user-select:none;';

  function tbBtn(label, title, onClick) {
    var btn = document.createElement('button');
    btn.textContent = label;
    btn.title = title;
    btn.style.cssText = 'background:none;border:1px solid #45475a;color:#cdd6f4;border-radius:4px;' +
      'width:28px;height:24px;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;padding:0;';
    btn.addEventListener('mouseenter', function() { btn.style.background = '#45475a'; });
    btn.addEventListener('mouseleave', function() { btn.style.background = 'none'; });
    btn.addEventListener('click', onClick);
    return btn;
  }

  // Back / Forward / Refresh
  toolbar.appendChild(tbBtn('\u2190', 'Back', function() { window.history.back(); }));
  toolbar.appendChild(tbBtn('\u2192', 'Forward', function() { window.history.forward(); }));
  toolbar.appendChild(tbBtn('\u21BB', 'Refresh', function() { window.location.reload(); }));

  // URL bar (editable — press Enter to navigate)
  var urlBar = document.createElement('input');
  urlBar.type = 'text';
  urlBar.value = window.location.href;
  urlBar.style.cssText = 'flex:1;height:24px;background:#2a2a3c;border:1px solid #45475a;border-radius:4px;' +
    'color:#cdd6f4;padding:0 8px;font-size:11px;min-width:0;outline:none;';
  urlBar.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      var url = urlBar.value.trim();
      if (url && url !== window.location.href) {
        // Add protocol if missing
        if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
        window.location.href = url;
      }
      urlBar.blur();
    }
  });
  urlBar.addEventListener('focus', function() {
    urlBar.select();
    urlBar.style.borderColor = '#89b4fa';
  });
  urlBar.addEventListener('blur', function() {
    urlBar.style.borderColor = '#45475a';
  });
  toolbar.appendChild(urlBar);

  // Update URL bar on navigation
  function updateUrlBar() { urlBar.value = window.location.href; }
  window.addEventListener('popstate', updateUrlBar);
  window.addEventListener('hashchange', updateUrlBar);
  var origPushState = history.pushState;
  var origReplaceState = history.replaceState;
  history.pushState = function() { origPushState.apply(this, arguments); updateUrlBar(); };
  history.replaceState = function() { origReplaceState.apply(this, arguments); updateUrlBar(); };

  // Viewport presets
  var viewports = [
    { label: 'Mobile', w: 375 },
    { label: 'Tablet', w: 768 },
    { label: 'Desktop', w: 0 },
  ];
  var vpContainer = document.createElement('div');
  vpContainer.style.cssText = 'display:flex;gap:2px;margin-left:4px;';
  viewports.forEach(function(vp) {
    var btn = document.createElement('button');
    btn.textContent = vp.label;
    btn.title = vp.w ? vp.label + ' (' + vp.w + 'px)' : 'Full width';
    btn.style.cssText = 'background:none;border:1px solid #45475a;color:#a6adc8;border-radius:3px;' +
      'padding:2px 6px;cursor:pointer;font-size:10px;white-space:nowrap;';
    btn.addEventListener('mouseenter', function() { btn.style.background = '#45475a'; });
    btn.addEventListener('mouseleave', function() { btn.style.background = 'none'; });
    btn.addEventListener('click', function() {
      if (vp.w > 0) {
        document.documentElement.style.maxWidth = vp.w + 'px';
        document.documentElement.style.margin = '0 auto';
      } else {
        document.documentElement.style.maxWidth = '';
        document.documentElement.style.margin = '';
      }
    });
    vpContainer.appendChild(btn);
  });
  toolbar.appendChild(vpContainer);

  // Open in Browser — calls local Rust HTTP callback server
  toolbar.appendChild(tbBtn('\u2197', 'Open in Browser', function() {
    var port = window.__CM_CALLBACK_PORT;
    if (!port) { ORIG.warn('Preview callback port not set yet'); return; }
    fetch('http://127.0.0.1:' + port + '/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: window.location.href }),
    }).catch(function(err) { ORIG.error('Open in browser failed:', err); });
  }));

  // Screenshot to Chat — calls local Rust HTTP callback server
  toolbar.appendChild(tbBtn('\uD83D\uDCF7', 'Screenshot to Chat', function() {
    var port = window.__CM_CALLBACK_PORT;
    if (!port) {
      ORIG.warn('[CodeMantis] Screenshot: callback port not available, retrying...');
      setTimeout(function() {
        var retryPort = window.__CM_CALLBACK_PORT;
        if (!retryPort) {
          ORIG.error('[CodeMantis] Screenshot unavailable — callback port not set');
          return;
        }
        fetch('http://127.0.0.1:' + retryPort + '/screenshot', {
          method: 'POST',
        }).catch(function(err) { ORIG.error('Screenshot failed:', err); });
      }, 500);
      return;
    }
    fetch('http://127.0.0.1:' + port + '/screenshot', {
      method: 'POST',
    }).catch(function(err) { ORIG.error('Screenshot failed:', err); });
  }));

  // Console badge
  var consoleBadge = document.createElement('button');
  consoleBadge.title = 'Toggle Console';
  consoleBadge.style.cssText = 'background:none;border:1px solid #45475a;color:#a6adc8;border-radius:4px;' +
    'padding:2px 8px;cursor:pointer;font-size:11px;display:flex;align-items:center;gap:4px;white-space:nowrap;';
  consoleBadge.addEventListener('mouseenter', function() { consoleBadge.style.background = '#45475a'; });
  consoleBadge.addEventListener('mouseleave', function() { consoleBadge.style.background = 'none'; });
  consoleBadge.addEventListener('click', function() { toggleConsoleDrawer(); });
  toolbar.appendChild(consoleBadge);

  // Close preview button
  toolbar.appendChild(tbBtn('\u2715', 'Close Preview', function() {
    var port = window.__CM_CALLBACK_PORT;
    if (port) {
      fetch('http://127.0.0.1:' + port + '/close', { method: 'POST' })
        .catch(function() { window.close(); });
    } else {
      ORIG.warn('[CodeMantis] Close: no callback port, using window.close() fallback');
      window.close();
    }
  }));

  function updateConsoleBadge() {
    var errorCount = window.__CM_CONSOLE_LOG.filter(function(e) { return e.level === 'error'; }).length;
    var warnCount = window.__CM_CONSOLE_LOG.filter(function(e) { return e.level === 'warn'; }).length;
    var parts = ['\u2630'];
    if (errorCount > 0) parts.push('\u274C ' + errorCount);
    if (warnCount > 0) parts.push('\u26A0 ' + warnCount);
    consoleBadge.textContent = parts.join(' ');
    if (errorCount > 0) {
      consoleBadge.style.borderColor = '#f38ba8';
      consoleBadge.style.color = '#f38ba8';
    } else if (warnCount > 0) {
      consoleBadge.style.borderColor = '#fab387';
      consoleBadge.style.color = '#fab387';
    } else {
      consoleBadge.style.borderColor = '#45475a';
      consoleBadge.style.color = '#a6adc8';
    }
  }
  updateConsoleBadge();

  // Push body content down so it's not hidden behind toolbar.
  // margin-top handles normal flow content; scroll-padding-top handles anchor scrolling.
  // Fixed/sticky elements (headers, navs) are offset separately via JS below.
  var cmStyle = document.createElement('style');
  cmStyle.id = '__cm_toolbar_style';
  cmStyle.textContent =
    'html { padding-top: ' + TOOLBAR_HEIGHT + 'px !important; box-sizing: border-box !important; ' +
    'scroll-padding-top: ' + TOOLBAR_HEIGHT + 'px; }' +
    ' body { margin-top: 0 !important; max-height: calc(100vh - ' + TOOLBAR_HEIGHT + 'px) !important; }';

  function insertStyle() {
    var target = document.head || document.documentElement;
    target.appendChild(cmStyle);
  }

  // Scan for fixed/sticky elements at top:0 and push them below the toolbar.
  // CSS margin-top cannot affect position:fixed elements (they're viewport-relative),
  // so we must adjust their top property directly.
  // Uses WeakSet (not data attributes) to track offset elements — avoids mutating
  // the DOM in ways that cause React/Next.js hydration mismatches.
  var _cmOffsetted = typeof WeakSet !== 'undefined' ? new WeakSet() : { _s: [], has: function(e) { return this._s.indexOf(e) >= 0; }, add: function(e) { this._s.push(e); } };

  function offsetFixedElements() {
    if (!document.body) return;
    var els = document.body.getElementsByTagName('*');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (_cmOffsetted.has(el)) continue;
      if (el.id === '__cm_toolbar' || el.id === '__cm_console_drawer' || el.id === '__cm_toolbar_style') continue;
      var cs = window.getComputedStyle(el);
      if ((cs.position === 'fixed' || cs.position === 'sticky') && cs.top === '0px') {
        el.style.setProperty('top', TOOLBAR_HEIGHT + 'px', 'important');
        _cmOffsetted.add(el);
      }
    }
  }

  // Debounced MutationObserver for SPA frameworks that mount headers dynamically
  var _cmOffsetTimer = null;
  var _cmObserver = new MutationObserver(function() {
    if (_cmOffsetTimer) clearTimeout(_cmOffsetTimer);
    _cmOffsetTimer = setTimeout(offsetFixedElements, 200);
  });

  // Start offset scanning after hydration is complete.
  // Running before hydration causes React/Next.js mismatch errors because we
  // modify element attributes that React compares against server-rendered HTML.
  function startOffsetScanning() {
    if (!document.body) return;
    offsetFixedElements();
    _cmObserver.observe(document.body, { childList: true, subtree: true });
  }

  function scheduleOffsetScanning() {
    if (document.readyState === 'complete') {
      setTimeout(startOffsetScanning, 500);
    } else {
      window.addEventListener('load', function() {
        setTimeout(startOffsetScanning, 500);
      });
    }
  }

  // Insert toolbar + style (immediate), schedule offset scanning (deferred)
  function insertToolbar() {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', function() {
        document.body.parentNode.insertBefore(toolbar, document.body);
        insertStyle();
        scheduleOffsetScanning();
      });
    } else {
      document.body.parentNode.insertBefore(toolbar, document.body);
      insertStyle();
      scheduleOffsetScanning();
    }
  }
  insertToolbar();

  // ── Keyboard Shortcuts ─────────────────────────────────────────────────
  // Cmd+Shift+C (macOS) / Ctrl+Shift+C — toggle Console Drawer
  document.addEventListener('keydown', function(e) {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      toggleConsoleDrawer();
    }
  });

  // ── Console Drawer ───────────────────────────────────────────────────────
  var DRAWER_MIN_HEIGHT = 120;
  var DRAWER_DEFAULT_HEIGHT = 200;
  window.__CM_DRAWER_OPEN = false;

  var drawer = document.createElement('div');
  drawer.id = '__cm_console_drawer';
  drawer.style.cssText = 'position:fixed;bottom:0;left:0;right:0;height:' + DRAWER_DEFAULT_HEIGHT + 'px;' +
    'background:#1e1e2e;border-top:2px solid #45475a;display:none;flex-direction:column;' +
    'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#cdd6f4;' +
    'z-index:2147483646;';

  // Resize handle
  var resizeHandle = document.createElement('div');
  resizeHandle.style.cssText = 'height:6px;cursor:ns-resize;background:transparent;flex-shrink:0;';
  var resizing = false;
  resizeHandle.addEventListener('mousedown', function(e) {
    e.preventDefault();
    resizing = true;
    var startY = e.clientY;
    var startH = parseInt(drawer.style.height, 10) || DRAWER_DEFAULT_HEIGHT;
    function onMove(ev) {
      if (!resizing) return;
      var newH = startH + (startY - ev.clientY);
      if (newH < DRAWER_MIN_HEIGHT) newH = DRAWER_MIN_HEIGHT;
      if (newH > window.innerHeight - TOOLBAR_HEIGHT - 40) newH = window.innerHeight - TOOLBAR_HEIGHT - 40;
      drawer.style.height = newH + 'px';
      if (window.__CM_DRAWER_OPEN) {
        document.body.style.setProperty('padding-bottom', newH + 'px', 'important');
      }
    }
    function onUp() {
      resizing = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
  drawer.appendChild(resizeHandle);

  // Drawer header
  var drawerHeader = document.createElement('div');
  drawerHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:4px 8px;' +
    'border-bottom:1px solid #313244;flex-shrink:0;';

  var drawerTitle = document.createElement('span');
  drawerTitle.textContent = 'Console';
  drawerTitle.style.cssText = 'font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#a6adc8;';
  drawerHeader.appendChild(drawerTitle);

  var drawerActions = document.createElement('div');
  drawerActions.style.cssText = 'display:flex;gap:6px;';

  function drawerBtn(label, title, onClick) {
    var btn = document.createElement('button');
    btn.textContent = label;
    btn.title = title;
    btn.style.cssText = 'background:none;border:none;color:#a6adc8;cursor:pointer;font-size:11px;padding:2px 6px;border-radius:3px;';
    btn.addEventListener('mouseenter', function() { btn.style.background = '#45475a'; });
    btn.addEventListener('mouseleave', function() { btn.style.background = 'none'; });
    btn.addEventListener('click', onClick);
    return btn;
  }

  drawerActions.appendChild(drawerBtn('Clear', 'Clear console', function() {
    window.__CM_CONSOLE_LOG = [];
    updateConsoleBadge();
    renderConsoleEntries();
  }));

  drawerActions.appendChild(drawerBtn('Copy All', 'Copy all entries', function() {
    var text = window.__CM_CONSOLE_LOG.map(function(e) {
      return '[' + e.ts + '] [' + e.level.toUpperCase() + '] ' + e.msg;
    }).join('\n');
    navigator.clipboard.writeText(text).catch(function() {});
  }));

  drawerActions.appendChild(drawerBtn('Send to Chat', 'Send logs to chat input', function() {
    var port = window.__CM_CALLBACK_PORT;
    if (!port) { ORIG.warn('[CodeMantis] Send to Chat: callback port not available'); return; }
    var entries = window.__CM_CONSOLE_LOG.filter(function(e) {
      return e.level === 'error' || e.level === 'warn';
    });
    if (entries.length === 0) entries = window.__CM_CONSOLE_LOG;
    var text = entries.map(function(e) {
      return '[' + e.level.toUpperCase() + '] ' + e.msg;
    }).join('\n');
    fetch('http://127.0.0.1:' + port + '/console-to-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logs: text }),
    }).catch(function(err) { ORIG.error('Send to chat failed:', err); });
  }));

  drawerActions.appendChild(drawerBtn('\u2715', 'Close console', function() {
    toggleConsoleDrawer();
  }));

  drawerHeader.appendChild(drawerActions);
  drawer.appendChild(drawerHeader);

  // Entry list
  var entryList = document.createElement('div');
  entryList.style.cssText = 'flex:1;overflow-y:auto;padding:4px 0;';
  drawer.appendChild(entryList);

  var LEVEL_COLORS = {
    error: '#f38ba8',
    warn: '#fab387',
    info: '#89b4fa',
    log: '#cdd6f4',
    debug: '#6c7086',
  };

  function renderConsoleEntries() {
    entryList.innerHTML = '';
    var entries = window.__CM_CONSOLE_LOG;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var row = document.createElement('div');
      row.style.cssText = 'padding:2px 8px;border-bottom:1px solid #181825;display:flex;gap:8px;align-items:flex-start;' +
        'word-break:break-all;';

      var ts = document.createElement('span');
      ts.textContent = e.ts.split('T')[1].split('.')[0];
      ts.style.cssText = 'color:#6c7086;flex-shrink:0;font-size:10px;margin-top:1px;';
      row.appendChild(ts);

      var lvl = document.createElement('span');
      lvl.textContent = e.level.toUpperCase().slice(0, 3);
      lvl.style.cssText = 'color:' + (LEVEL_COLORS[e.level] || '#cdd6f4') + ';flex-shrink:0;font-size:10px;' +
        'font-weight:600;width:28px;margin-top:1px;';
      row.appendChild(lvl);

      var msg = document.createElement('span');
      msg.textContent = e.msg;
      msg.style.cssText = 'color:' + (LEVEL_COLORS[e.level] || '#cdd6f4') + ';flex:1;white-space:pre-wrap;';
      row.appendChild(msg);

      // Expandable stack trace for errors
      if (e.stack && e.level === 'error') {
        (function(stack, parentRow) {
          var toggle = document.createElement('button');
          toggle.textContent = '\u25B6';
          toggle.title = 'Show stack trace';
          toggle.style.cssText = 'background:none;border:none;color:#6c7086;cursor:pointer;font-size:10px;flex-shrink:0;padding:0;';
          parentRow.appendChild(toggle);

          var stackDiv = document.createElement('div');
          stackDiv.style.cssText = 'display:none;padding:4px 8px 4px 68px;color:#6c7086;font-size:10px;white-space:pre-wrap;word-break:break-all;border-bottom:1px solid #181825;';
          stackDiv.textContent = stack;

          toggle.addEventListener('click', function() {
            if (stackDiv.style.display === 'none') {
              stackDiv.style.display = 'block';
              toggle.textContent = '\u25BC';
            } else {
              stackDiv.style.display = 'none';
              toggle.textContent = '\u25B6';
            }
          });

          entryList.appendChild(parentRow);
          entryList.appendChild(stackDiv);
        })(e.stack, row);
      } else {
        entryList.appendChild(row);
      }
    }
    // Auto-scroll to bottom
    entryList.scrollTop = entryList.scrollHeight;
  }

  function toggleConsoleDrawer() {
    window.__CM_DRAWER_OPEN = !window.__CM_DRAWER_OPEN;
    if (window.__CM_DRAWER_OPEN) {
      drawer.style.display = 'flex';
      var h = parseInt(drawer.style.height, 10) || DRAWER_DEFAULT_HEIGHT;
      document.body.style.setProperty('padding-bottom', h + 'px', 'important');
      renderConsoleEntries();
    } else {
      drawer.style.display = 'none';
      document.body.style.removeProperty('padding-bottom');
    }
  }

  // Insert drawer
  function insertDrawer() {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', function() {
        document.body.parentNode.appendChild(drawer);
      });
    } else {
      document.body.parentNode.appendChild(drawer);
    }
  }
  insertDrawer();
})();
