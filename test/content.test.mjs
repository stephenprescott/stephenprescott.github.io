import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMacro, assertMatchesGolden } from './helpers/render.mjs';

const C = 'components/';
const links = [{ label: 'Work', href: '#work' }];

test('Highlight and Tag match golden', () => {
  assertMatchesGolden('Highlight', renderMacro(C + 'highlight.njk', 'highlight', { text: 'what I do' }));
  assertMatchesGolden('Tag', renderMacro(C + 'tag.njk', 'tag', { label: 'SQL' }));
});

test('Hero matches golden', () => {
  assertMatchesGolden('Hero', renderMacro(C + 'hero.njk', 'hero', {
    eyebrow: 'Role · City',
    title: 'Headline about <em class="ws-highlight">what I do</em>.',
    body: 'Intro sentence.',
    actions: '<a class="ws-btn ws-btn-primary" href="#work">See my work</a>',
  }));
});

test('SocialLinks matches golden', () => {
  assertMatchesGolden('SocialLinks', renderMacro(C + 'social-links.njk', 'socialLinks', {
    links: [
      { label: 'GitHub', href: 'https://github.com/x', icon: 'github-logo' },
      { label: 'LinkedIn', href: 'https://linkedin.com/in/x', icon: 'linkedin-logo' },
      { label: 'Email', href: 'mailto:x@example.org', icon: 'envelope-simple' },
    ],
  }));
});

test('Stat, FeatureCard and SectionHeading match golden', () => {
  assertMatchesGolden('Stat', renderMacro(C + 'stat.njk', 'stat', { value: '12', label: 'Metric label', note: 'A note' }));
  assertMatchesGolden('FeatureCard', renderMacro(C + 'feature-card.njk', 'featureCard', { eyebrow: '01', title: 'Feature title', body: 'Feature body text.' }));
  assertMatchesGolden('SectionHeading', renderMacro(C + 'section-heading.njk', 'sectionHeading', { eyebrow: 'Selected work', title: 'Projects' }));
});

test('Avatar image and initials variants match golden', () => {
  assertMatchesGolden('Avatar', renderMacro(C + 'avatar.njk', 'avatar', { src: '/img/me.png', alt: 'Portrait', size: 120 }));
  assertMatchesGolden('Avatar.initials', renderMacro(C + 'avatar.njk', 'avatar', { name: 'Stephen Groff', size: 120 }));
});

test('Timeline, SkillGroup and ArticleList match golden', () => {
  assertMatchesGolden('Timeline', renderMacro(C + 'timeline.njk', 'timeline', {
    items: [
      { period: '2020 – Present', title: 'Job title', org: 'Company', body: 'What I did.' },
      { period: '2016 – 2020', title: 'Earlier title', org: 'Earlier company' },
    ],
  }));
  assertMatchesGolden('SkillGroup', renderMacro(C + 'skill-group.njk', 'skillGroup', { title: 'Tools', skills: ['Power BI', 'SQL'] }));
  assertMatchesGolden('ArticleList', renderMacro(C + 'article-list.njk', 'articleList', {
    items: [
      { title: 'Article one', href: '/a/', meta: 'Nov 2026 · Site' },
      { title: 'Article two', meta: 'Oct 2026', external: true, href: 'https://example.org' },
    ],
  }));
});

test('Field and ContactForm match golden', () => {
  assertMatchesGolden('Field', renderMacro(C + 'field.njk', 'field', { label: 'Email', name: 'email', type: 'email', required: true, hint: 'We reply within a day.' }));
  assertMatchesGolden('ContactForm', renderMacro(C + 'contact-form.njk', 'contactForm', { action: '#', method: 'post', submitLabel: 'Send message' }));
});

test('ContactForm shipped state: submit disabled until a form service is set, mailto fallback shown', () => {
  const html = renderMacro(C + 'contact-form.njk', 'contactForm', { action: '#', email: 'me@example.org', disabled: true });
  assert.match(html, /<button[^>]*type="submit"[^>]*disabled/);
  assert.match(html, /href="mailto:me@example\.org"/);
  const noEmail = renderMacro(C + 'contact-form.njk', 'contactForm', { action: '#', disabled: true });
  assert.doesNotMatch(noEmail, /mailto:/);
});

test('Avatar without src renders initials; image alt="" stays empty', () => {
  assert.match(renderMacro(C + 'avatar.njk', 'avatar', { name: 'Ada Lovelace', size: 40 }), /ws-avatar-initials[^>]*>AL</);
  assert.match(renderMacro(C + 'avatar.njk', 'avatar', { src: '/x.png', alt: '', size: 40 }), /alt=""/);
});

test('macros escape HTML in text arguments', () => {
  const html = renderMacro(C + 'stat.njk', 'stat', { value: 'A & B', label: '<script>x</script>' });
  assert.match(html, /A &amp; B/);
  assert.doesNotMatch(html, /<script>/);
  assert.ok(links.length);
});

test('ContactForm with an access key posts to Web3Forms with honeypot and enabled button', () => {
  const html = renderMacro(C + 'contact-form.njk', 'contactForm', { accessKey: 'test-key-123', email: 'me@example.org' });
  assert.match(html, /action="https:\/\/api\.web3forms\.com\/submit"/);
  assert.match(html, /method="post"/);
  assert.match(html, /<input type="hidden" name="access_key" value="test-key-123">/);
  assert.match(html, /<input type="hidden" name="subject" value="New message from stephenprescott\.github\.io">/);
  assert.match(html, /<div hidden aria-hidden="true"><input type="checkbox" name="botcheck" tabindex="-1" autocomplete="off"><\/div>/);
  for (const n of ['name', 'email', 'message']) assert.match(html, new RegExp(`name="${n}"`));
  assert.doesNotMatch(html, /<button[^>]*disabled/);
  assert.doesNotMatch(html, /not connected/);
  assert.doesNotMatch(html, /mailto:/);
});

test('ContactForm without an access key stays disabled with the mailto hint', () => {
  const html = renderMacro(C + 'contact-form.njk', 'contactForm', { disabled: true, email: 'me@example.org' });
  assert.match(html, /<button[^>]*disabled/);
  assert.match(html, /not connected/);
  assert.doesNotMatch(html, /access_key|botcheck/);
});
