// Optional role tailoring on the landing page: reorders the work grid and swaps chat starters.
(function () {
  var picker = document.querySelector('[data-role-picker]');
  var row = document.querySelector('#work .ws-grid-wrap > .ws-row');
  if (!picker || !row) return;
  var roles = [];
  try { roles = JSON.parse(picker.getAttribute('data-roles') || '[]'); } catch (e) { return; }
  var cards = Array.prototype.slice.call(row.querySelectorAll('article.ws-project'));
  var defaults = [];
  try { defaults = JSON.parse(picker.getAttribute('data-default-starters') || '[]'); } catch (e) { defaults = []; }
  var resetBtn = picker.querySelector('[data-role-reset]');
  var radios = Array.prototype.slice.call(picker.querySelectorAll('input[type=radio]'));

  function find(id) {
    for (var i = 0; i < roles.length; i++) if (roles[i].id === id) return roles[i];
    return null;
  }

  function apply(role, announce) {
    cards.forEach(function (card) {
      if (role && card.getAttribute('data-slug') === role.featured) row.insertBefore(card, row.firstChild);
    });
    if (announce && role && role.starters) {
      document.dispatchEvent(new CustomEvent('ws:role', { detail: { starters: role.starters } }));
    }
  }

  var saved = null;
  try { saved = sessionStorage.getItem('ws-role'); } catch (e) { saved = null; }
  var current = find(saved);
  if (current) {
    radios.forEach(function (r) { r.checked = r.value === current.id; });
    apply(current, false);
    if (resetBtn) resetBtn.hidden = false;
    // chat.js may load after this script; deferred scripts all run before DOMContentLoaded.
    document.addEventListener('DOMContentLoaded', function () {
      document.dispatchEvent(new CustomEvent('ws:role', { detail: { starters: current.starters } }));
    });
  }

  picker.addEventListener('change', function (e) {
    var role = find(e.target.value);
    if (!role) return;
    try { sessionStorage.setItem('ws-role', role.id); } catch (err) { /* storage unavailable */ }
    // Restore original order first so the move is always relative to the base layout.
    cards.forEach(function (card) { row.appendChild(card); });
    apply(role, true);
    if (resetBtn) resetBtn.hidden = false;
  });

  if (resetBtn) resetBtn.addEventListener('click', function () {
    try { sessionStorage.removeItem('ws-role'); } catch (err) { /* storage unavailable */ }
    radios.forEach(function (r) { r.checked = false; });
    cards.forEach(function (card) { row.appendChild(card); });
    if (defaults.length) document.dispatchEvent(new CustomEvent('ws:role', { detail: { starters: defaults } }));
    resetBtn.hidden = true;
    if (radios[0]) radios[0].focus();
  });

  picker.hidden = false;
})();
