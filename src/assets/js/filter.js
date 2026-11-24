// Progressive enhancement for the project grid: reveal the filter row and wire it up.
(function () {
  var rows = document.querySelectorAll('.ws-filter');
  rows.forEach(function (filterRow) {
    var wrap = filterRow.closest('.ws-grid-wrap');
    if (!wrap) return;
    var cards = Array.prototype.slice.call(wrap.querySelectorAll('article.ws-project'));
    var buttons = Array.prototype.slice.call(filterRow.querySelectorAll('button'));
    filterRow.hidden = false;

    function tagsOf(card) {
      return Array.prototype.map.call(card.querySelectorAll('.ws-tags .ws-tag'), function (t) {
        return t.textContent.trim();
      });
    }

    filterRow.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      var isAll = btn === buttons[0];
      var tag = btn.textContent.trim();
      buttons.forEach(function (b) {
        var on = b === btn;
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.classList.toggle('ws-tag-active', on);
      });
      cards.forEach(function (card) {
        card.hidden = !isAll && tagsOf(card).indexOf(tag) === -1;
      });
    });
  });
})();
