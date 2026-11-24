import { buildKnowledgePack } from '../../lib/knowledge.mjs';

export const data = {
  permalink: '/chat/knowledge.json',
  eleventyExcludeFromCollections: true,
};

export default function render({ site, home, experience, resume, projects }) {
  return JSON.stringify(buildKnowledgePack({ site, home, experience, resume, projects }));
}
