/**
 * Turn the projects list into case-study pages: one per project that has a `caseStudy`,
 * with prev/next links in list order.
 */
export function buildCaseStudies(projects) {
  const withStudy = projects.filter((p) => p.caseStudy);
  const link = (p) => (p ? { title: p.title, href: `/projects/${p.slug}/` } : null);
  return withStudy.map((p, i) => ({
    ...p,
    prev: link(withStudy[i - 1]),
    next: link(withStudy[i + 1]),
  }));
}
