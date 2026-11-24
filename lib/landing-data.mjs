// Display data for the landing page: figures, expertise areas and projects, with each
// figure and project linked to the expertise areas it proves. Text is resolved from
// home.json by reference so figure bodies stay verbatim.

export function slugId(title) {
  return String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const firstSentence = (text) => {
  const m = /^.*?[.!?](?=\s|$)/s.exec(text);
  return m ? m[0] : text;
};

function buildAreas(home) {
  return ((home.expertise && home.expertise.items) || []).map((i) => ({
    id: i.id || slugId(i.title), title: i.title, body: i.body,
  }));
}

// "hero.body#1" or "expertise:<area id>#1"; "#1" keeps only the first sentence.
function resolveBody(ref, home, areas) {
  const [path, mod] = String(ref).split('#');
  let text;
  if (path.startsWith('expertise:')) {
    const area = areas.find((a) => a.id === path.slice('expertise:'.length));
    if (!area) throw new Error(`bodyFrom "${ref}" matches no expertise id`);
    text = area.body;
  } else {
    text = path.split('.').reduce((o, k) => (o == null ? o : o[k]), home);
    if (typeof text !== 'string') throw new Error(`bodyFrom "${ref}" matches no text in home.json`);
  }
  return mod === '1' ? firstSentence(text) : text;
}

export function assertProofLinks(home, projects) {
  const ids = new Set(buildAreas(home).map((a) => a.id));
  const bad = new Set();
  const check = (list) => { for (const id of list || []) if (!ids.has(id)) bad.add(id); };
  for (const s of home.stats || []) check(s.proves);
  for (const p of projects) check(p.proves);
  if (bad.size) throw new Error(`proves names unknown expertise id(s): ${[...bad].join(', ')}`);
}

export function buildLandingData(home, projects) {
  const areas = buildAreas(home);
  const figures = (home.stats || []).map((s) => ({
    id: s.id, value: s.value, suffix: s.suffix || '', label: s.label,
    body: resolveBody(s.bodyFrom, home, areas), proves: s.proves || [],
  }));
  const list = projects.map((p) => {
    const i = p.title.indexOf(':');
    return {
      slug: p.slug,
      title: p.title,
      shortTitle: p.shortTitle ?? (i < 0 ? p.title : p.title.slice(0, i).trim()),
      subtitle: p.subtitle ?? (i < 0 ? '' : p.title.slice(i + 1).trim()),
      eyebrow: p.eyebrow,
      summary: p.summary,
      status: p.status || '',
      href: p.caseStudy ? `/projects/${p.slug}/` : p.href || '',
      proves: p.proves || [],
      problem: p.caseStudy?.problem || '',
      approach: p.caseStudy?.approach || '',
      result: p.caseStudy?.result || '',
    };
  });
  return { areas, figures, projects: list };
}
