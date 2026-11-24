// Scroll reveals, hero-visual pause and stat count-up. No libraries. Exits under reduced motion.
(function () {
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) { window.wsMotionReady = true; return; }
  // Too late: the head script already showed everything. Leave the reveal state alone.
  if (document.documentElement.classList.contains('motion-failed')) return;
  var ease = function (t) { return 1 - Math.pow(1 - t, 3); };

  function count(el) {
    var end = parseInt(el.getAttribute('data-count'), 10);
    var text = el.textContent;
    if (isNaN(end)) return;
    var suffix = text.replace(/^\s*\d+/, '');
    var start = null;
    function step(now) {
      if (start === null) start = now;
      var t = Math.min((now - start) / 900, 1);
      el.textContent = Math.round(end * ease(t)) + suffix;
      if (t < 1) requestAnimationFrame(step);
      else el.textContent = text;
    }
    requestAnimationFrame(step);
  }
  window.wsMotion = { count: count };

  if (!('IntersectionObserver' in window)) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-reveal]'), function (el) { el.classList.add('is-in'); });
    window.wsMotionReady = true;
    return;
  }

  // Reveal each section once, when a slice of it is visible.
  var reveal = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('is-in');
      reveal.unobserve(e.target);
      Array.prototype.forEach.call(e.target.querySelectorAll('[data-count]'), count);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
  Array.prototype.forEach.call(document.querySelectorAll('[data-reveal]'), function (el) { reveal.observe(el); });

  // Stats outside any reveal section count when they appear.
  var counter = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      counter.unobserve(e.target);
      count(e.target);
    });
  }, { threshold: 0.6 });
  Array.prototype.forEach.call(document.querySelectorAll('[data-count]'), function (el) {
    if (!el.closest('[data-reveal]')) counter.observe(el);
  });

  window.wsMotionReady = true;

  // Pause the hero flow when it is off screen.
  var hv = document.querySelector('.hero-visual');
  if (hv) {
    new IntersectionObserver(function (entries) {
      hv.classList.toggle('is-off', !entries[0].isIntersecting);
    }).observe(hv);
  }
})();
