import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve(import.meta.dirname, 'golden');

export const ROOT_CLASS = {
  SkipLink: 'ws-skip', Navbar: 'ws-nav', ThemeToggle: 'ws-btn', 'ThemeToggle.light': 'ws-btn', Button: 'ws-btn', 'Button.quiet': 'ws-btn-quiet',
  Highlight: 'ws-highlight', Icon: 'ws-icon', Hero: 'ws-hero', SocialLinks: 'ws-social', Stat: 'ws-stat',
  FeatureCard: 'ws-card', SectionHeading: 'ws-section-head', ProjectCard: 'ws-project', ProjectGrid: 'ws-project',
  Avatar: 'ws-avatar', 'Avatar.initials': 'ws-avatar-initials', Timeline: 'ws-timeline', SkillGroup: 'ws-skill-group', ArticleList: 'ws-articles',
  ContactForm: 'ws-form', Field: 'ws-field', Tag: 'ws-tag', Footer: 'ws-footer', Breadcrumbs: 'ws-crumbs',
  CaseStudyHeader: 'ws-case-head', CaseStudySection: 'ws-case-section', Figure: 'ws-figure',
  ProjectNav: 'ws-pnav', NotFound: 'ws-404',
};

for (const [name, cls] of Object.entries(ROOT_CLASS)) {
  test(`golden markup for ${name} exists and contains ${cls}`, () => {
    const file = join(dir, `${name}.html`);
    assert.ok(existsSync(file), `${name}.html missing`);
    const html = readFileSync(file, 'utf8');
    assert.ok(html.trim().length > 0, 'empty');
    assert.ok(html.includes(cls), `no ${cls}`);
  });
}
