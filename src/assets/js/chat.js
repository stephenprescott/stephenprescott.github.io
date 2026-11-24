(function () {
  var root = document.querySelector('[data-chat]');
  if (!root) return;

  var endpoint = root.getAttribute('data-endpoint');
  var siteUrl = root.getAttribute('data-site') || '';
  var launcher = root.querySelector('[data-chat-launcher]');
  var panel = root.querySelector('[data-chat-panel]');
  var log = root.querySelector('[data-chat-log]');
  var startersEl = root.querySelector('[data-chat-starters]');
  var form = root.querySelector('[data-chat-form]');
  var input = root.querySelector('[data-chat-input]');
  var sendBtn = root.querySelector('[data-chat-send]');
  var closeBtn = root.querySelector('[data-chat-close]');
  var KEY = 'ws-chat';
  var MAX_MESSAGES = 8; // last 4 turns
  var TIMEOUT_MS = 30000;
  var BUSY_MSG = 'The assistant is busy right now. Please try again in a minute, or use the contact form.';
  var history = [];
  var starters = [];
  var opener = null;
  var busy = false;

  try { starters = JSON.parse(root.getAttribute('data-starters') || '[]'); } catch (e) { starters = []; }

  function load() {
    try {
      var raw = JSON.parse(sessionStorage.getItem(KEY) || '[]');
      if (Array.isArray(raw)) {
        history = raw.filter(function (m) {
          return m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string';
        }).slice(-MAX_MESSAGES);
      }
    } catch (e) { history = []; }
  }
  function save() {
    try { sessionStorage.setItem(KEY, JSON.stringify(history)); } catch (e) {}
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  // Same-site absolute URLs become relative; only http(s) and relative links are allowed.
  function safeHref(url) {
    if (typeof url !== 'string') return null;
    try {
      var u = new URL(url, location.href);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      var site = siteUrl ? new URL(siteUrl) : null;
      if (u.origin === location.origin || (site && u.origin === site.origin)) return u.pathname + u.search + u.hash;
      return u.href;
    } catch (e) { return null; }
  }

  function addMessage(role, text, sources) {
    var box = el('div', 'ws-chat-msg');
    box.setAttribute('data-role', role);
    if (role === 'assistant' && sources && sources.length) {
      var wrap = el('div', 'ws-chat-answer');
      wrap.appendChild(el('span', '', text));
      var list = el('ol', 'ws-chat-sources');
      sources.forEach(function (s) {
        var href = safeHref(s && s.url);
        if (!href) return;
        var li = el('li');
        // Number the item by its citation id so it matches the [n] markers in the answer.
        var n = Number(s && s.id);
        if (n > 0 && Math.floor(n) === n) li.value = n;
        var a = el('a', '', String((s && s.title) || href));
        a.setAttribute('href', href);
        a.setAttribute('rel', 'noopener');
        li.appendChild(a);
        list.appendChild(li);
      });
      if (list.children.length) wrap.appendChild(list);
      box.appendChild(wrap);
    } else {
      box.textContent = text;
    }
    log.appendChild(box);
    log.scrollTop = log.scrollHeight;
    return box;
  }

  function renderStarters() {
    startersEl.textContent = '';
    if (history.length) return;
    starters.forEach(function (q) {
      var b = el('button', 'ws-btn ws-btn-quiet', q);
      b.type = 'button';
      b.addEventListener('click', function () { ask(q); });
      startersEl.appendChild(b);
    });
  }

  function setStarters(list) {
    if (!Array.isArray(list)) return;
    starters = list.filter(function (s) { return typeof s === 'string' && s.trim(); }).slice(0, 6);
    renderStarters();
  }

  function focusables() {
    return Array.prototype.filter.call(
      panel.querySelectorAll('a[href], button, input, textarea, select, [tabindex]'),
      function (n) { return !n.disabled && n.tabIndex >= 0 && n.getClientRects().length > 0; }
    );
  }

  function open(from) {
    opener = from || (document.activeElement && document.activeElement !== document.body ? document.activeElement : launcher);
    panel.hidden = false;
    launcher.setAttribute('aria-expanded', 'true');
    input.focus();
  }

  function close() {
    if (panel.hidden) return;
    panel.hidden = true;
    launcher.setAttribute('aria-expanded', 'false');
    var back = opener && document.contains(opener) && opener.getClientRects().length ? opener : launcher;
    back.focus();
  }

  // Busy state keeps focus where it is: readOnly + aria-disabled instead of disabled,
  // and aria-busy holds back live-region announcements until the answer is in.
  function setBusy(on) {
    busy = on;
    input.readOnly = on;
    input.setAttribute('aria-disabled', String(on));
    sendBtn.setAttribute('aria-disabled', String(on));
    form.setAttribute('aria-busy', String(on));
    log.setAttribute('aria-busy', String(on));
  }

  function ask(question) {
    question = (question || '').trim().slice(0, 500);
    if (!question || busy) return;
    if (panel.hidden) open(opener);
    setBusy(true);
    startersEl.textContent = '';
    input.focus(); // a clicked starter chip was just removed; keep focus in the dialog
    addMessage('user', question);
    var pending = addMessage('pending', 'Thinking…');
    var turnHistory = history.slice(-MAX_MESSAGES);
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var done = false;

    function fail(msg) {
      pending.remove();
      addMessage('error', msg);
      input.value = question;
    }

    // Runs at most once per question; always clears the busy state, even if `fn` throws.
    function settle(fn) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { fn(); } catch (e) { fail('Something went wrong. Please try again.'); }
      finally {
        setBusy(false);
        if (!panel.hidden) input.focus();
      }
    }

    var timer = setTimeout(function () {
      settle(function () { fail(BUSY_MSG); });
      if (controller) controller.abort();
    }, TIMEOUT_MS);

    fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({ question: question, history: turnHistory }),
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) { return { ok: res.ok, data: data }; });
    }).then(function (r) {
      settle(function () {
        if (r.ok && r.data && typeof r.data.answer === 'string') {
          pending.remove();
          addMessage('assistant', r.data.answer, Array.isArray(r.data.sources) ? r.data.sources : []);
          history.push({ role: 'user', content: question }, { role: 'assistant', content: r.data.answer });
          history = history.slice(-MAX_MESSAGES);
          save();
          input.value = '';
        } else {
          fail((r.data && typeof r.data.error === 'string' && r.data.error) || 'Something went wrong. Please try again.');
        }
      });
    }, function () {
      settle(function () { fail('Could not reach the chat service. Please try again.'); });
    });
  }

  setBusy(false);
  // Restore the earlier conversation in this tab.
  load();
  history.forEach(function (m) { addMessage(m.role, m.content); });
  renderStarters();

  launcher.addEventListener('click', function () { if (panel.hidden) open(launcher); else close(); });
  closeBtn.addEventListener('click', close);
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    ask(input.value);
  });

  panel.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    var f = focusables();
    if (!f.length) return;
    var first = f[0];
    var last = f[f.length - 1];
    if (!panel.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  // Escape also closes the panel when focus is outside it.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !panel.hidden && !panel.contains(document.activeElement)) close();
  });
  // Keep Tab inside the panel even if focus drifted outside (for example a click on the page).
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || panel.hidden || panel.contains(document.activeElement)) return;
    var f = focusables();
    if (!f.length) return;
    e.preventDefault();
    (e.shiftKey ? f[f.length - 1] : f[0]).focus();
  });

  // Hero Ask button(s) and inline form(s), present only when the widget is.
  Array.prototype.forEach.call(document.querySelectorAll('[data-chat-open]'), function (b) {
    b.hidden = false;
    b.addEventListener('click', function () { open(b); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('form[data-chat-inline]'), function (f) {
    f.hidden = false;
    var field = f.querySelector('input');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var q = field.value;
      if (!q.trim()) return;
      field.value = '';
      opener = field;
      ask(q);
    });
  });

  launcher.hidden = false;

  document.addEventListener('ws:role', function (e) {
    if (e.detail && Array.isArray(e.detail.starters) && e.detail.starters.length) setStarters(e.detail.starters);
  });

  window.StephenChat = { open: function () { open(); }, ask: ask, setStarters: setStarters };
})();
