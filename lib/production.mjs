// Launch values the production build needs (alongside the placeholder guard).
// Either file can opt out with `"enabled": false`.

/** The chat endpoint the site renders with: CHAT_ENDPOINT wins; `"enabled": false` means no chat. */
export function chatEndpointFor(chat, env = {}) {
  if (chat && chat.enabled === false) return '';
  return env.CHAT_ENDPOINT || (chat && chat.endpoint) || '';
}

/** Throw unless the chat endpoint is https and the Web3Forms key is set (or each is disabled). */
export function assertProductionConfig({ chat, contact } = {}, env = {}) {
  const problems = [];
  if (!(chat && chat.enabled === false) && !/^https:\/\/\S+$/.test(chatEndpointFor(chat, env))) {
    problems.push('chat.json endpoint must be an https URL (or set "enabled": false)');
  }
  const key = contact && contact.web3formsKey;
  if (!(contact && contact.enabled === false) && !(typeof key === 'string' && key.trim())) {
    problems.push('contact.json web3formsKey is empty (or set "enabled": false)');
  }
  if (problems.length) throw new Error(`launch config missing in production: ${problems.join('; ')}`);
}
