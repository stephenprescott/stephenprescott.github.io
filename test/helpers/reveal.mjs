// Make axe deterministic against reveal motion: scroll every [data-reveal] section into view,
// wait for it to be revealed and fully opaque, let finite transitions finish, then return to top.
export async function settleReveals(page) {
  await page.evaluate(async () => {
    for (const el of document.querySelectorAll('[data-reveal]')) {
      el.scrollIntoView({ block: 'center' });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
  });
  await page.waitForFunction(() => [...document.querySelectorAll('[data-reveal]')]
    .every((el) => el.classList.contains('is-in') && getComputedStyle(el).opacity === '1'
      && el.getAnimations({ subtree: true }).every((a) => !Number.isFinite(a.effect.getComputedTiming().endTime) || a.playState === 'finished')), null, { timeout: 10000 });
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime))
    .map((a) => a.finished.catch(() => {}))));
  await page.evaluate(() => window.scrollTo(0, 0));
}
