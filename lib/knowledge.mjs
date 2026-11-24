/**
 * Build the chatbot knowledge pack from the published data files.
 * Plain text only; `placeholder` flags are data hygiene and never emitted.
 */
const strip = (s) => String(s).replace(/<[^>]*>/g, '').replace(/[ \t]+/g, ' ').trim();

/** Render a string, array or object as plain lines, skipping `placeholder` keys. */
function lines(value) {
  if (value == null || value === '') return [];
  if (typeof value === 'string' || typeof value === 'number') return [strip(value)];
  if (Array.isArray(value)) return value.flatMap(lines);
  return Object.entries(value)
    .filter(([k]) => k !== 'placeholder')
    .flatMap(([, v]) => lines(v));
}

const skillLines = (groups = []) => groups.map((g) => `${g.title}: ${g.skills.join(', ')}`);
const roleLines = (r) => [`${r.title}, ${r.org} (${r.period})`, ...(r.bullets || []).map((b) => `- ${strip(b)}`)];

export function buildKnowledgePack({ site, home, experience, resume, projects }, now = new Date()) {
  const abs = (path = '/') => `${site.url}${path}`;
  const sources = [];
  const add = (title, url, parts) => {
    const text = parts.flatMap(lines).join('\n');
    if (text) sources.push({ id: sources.length + 1, title, url, text });
  };

  const hero = home.hero || {};
  add('Profile', abs('/'), [
    `Name: ${site.name}`, `Title: ${site.title}`, site.description,
    [hero.eyebrow, `${hero.pre || ''}${hero.highlight || ''}${hero.post || ''}`, hero.body].filter(Boolean),
    `Email: ${site.email}`,
    (site.social || []).filter((s) => !/^mailto:/.test(s.href)).map((s) => `${s.label}: ${s.href}`),
  ]);

  const exp = home.expertise || {};
  add(exp.title || 'Expertise', abs('/#expertise'), [(exp.items || []).map((i) => `${i.title}: ${i.body}`)]);

  const about = home.about || {};
  add('About, skills and learning', abs('/#about'), [
    about.bio, skillLines(about.skills),
    (about.learning || []).map((l) => `Learning: ${l.title} (${l.meta})`),
  ]);

  add('Career summary', abs('/#about'), [
    (experience || []).map((e) => `${e.title}, ${e.org} (${e.period}): ${e.body}`),
  ]);

  const c = resume.contact || {};
  add('Resume: contact and summary', abs('/resume/'), [
    `Name: ${c.name}`, `Title: ${c.title}`, `Location: ${c.location}`, `Phone: ${c.phone}`,
    `Email: ${c.email}`, `LinkedIn: ${c.linkedin}`, resume.summary,
  ]);
  for (const r of resume.experience || []) add(`Resume role: ${r.title}, ${r.org}`, abs('/resume/'), [roleLines(r)]);
  add('Resume: earlier roles', abs('/resume/'), [(resume.earlier || []).map(roleLines)]);
  add('Resume: skills, training and education', abs('/resume/'), [
    skillLines(resume.skills),
    (resume.training || []).map((t) => `Training: ${t}`),
    (resume.education || []).map((e) => `Education: ${e.title}, ${e.meta}`),
  ]);

  for (const p of projects) {
    const cs = p.caseStudy || {};
    add(`Project: ${p.title}`, abs(`/projects/${p.slug}/`), [
      `Project: ${p.title}`, p.eyebrow, p.status ? `Status: ${p.status}` : '', p.summary,
      p.tags?.length ? `Tags: ${p.tags.join(', ')}` : '',
      (cs.meta || []).map((m) => `${m.label}: ${m.value}`),
      cs.problem && `Problem: ${cs.problem}`,
      cs.approach && `Approach: ${cs.approach}`,
      cs.result && `Result: ${cs.result}`,
    ]);
  }

  return { builtAt: now.toISOString(), sources };
}
