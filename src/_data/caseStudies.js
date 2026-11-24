import { readFileSync } from 'node:fs';
import { buildCaseStudies } from '../../lib/case-studies.mjs';

export default function () {
  const projects = JSON.parse(readFileSync(new URL('./projects.json', import.meta.url), 'utf8'));
  return buildCaseStudies(projects);
}
