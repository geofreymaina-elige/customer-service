const fs = require('node:fs');

function loadMobileRequests(collectionPath) {
  const collection = JSON.parse(fs.readFileSync(collectionPath, 'utf8'));
  const mobileFolder = (collection.item || []).find((item) => item.name === 'Mobile App API');
  if (!mobileFolder) throw new Error('Postman collection has no "Mobile App API" folder.');

  const requests = [];
  const visit = (items, folderNames = []) => {
    for (const item of items || []) {
      const nextFolders = item.request ? folderNames : [...folderNames, item.name];
      if (item.request) {
        const url = typeof item.request.url === 'string' ? item.request.url : item.request.url?.raw;
        if (!url) continue;
        requests.push({
          name: item.name,
          folder: nextFolders.join(' / '),
          method: String(item.request.method || 'GET').toUpperCase(),
          url,
          headers: (item.request.header || []).filter((header) => header.disabled !== true),
          auth: item.request.auth || null,
          body: item.request.body?.raw,
        });
      }
      visit(item.item, nextFolders);
    }
  };
  visit(mobileFolder.item, [mobileFolder.name]);
  return requests;
}

function safeGetClass(request) {
  if (request.method === 'POST' && request.url.includes('/api/v2/auth/sessions/device')) return 'device_signin';
  if (request.method === 'POST' && request.url.includes('/api/v2/auth/transaction-tokens')) return 'token_refresh';
  if (request.method !== 'GET') return 'mutation';
  if (request.url.includes('/api/v2/customers/me/balance')) return 'balance';
  if (request.url.includes('/api/v2/customers/onboarding-status')) return 'status';
  if (request.url.includes('/api/v2/customers/me/sessions')) return 'sessions';
  if (request.url.includes('/api/v2/customers/me')) return 'wallet';
  if (request.url.includes('/api/v1/app-config')) return 'app_config';
  return 'read_once';
}

function expandVariables(value, variables) {
  const missing = new Set();
  const expanded = String(value).replace(/\{\{([^}]+)\}\}/g, (_match, key) => {
    const current = variables[key];
    if (current === undefined || current === null || current === '') {
      missing.add(key);
      return '';
    }
    return String(current);
  });
  return { expanded, missing: [...missing] };
}

function buildRequest(request, baseUrl, variables) {
  const urlResult = expandVariables(request.url, { ...variables, baseUrl });
  if (urlResult.missing.length) return { missing: urlResult.missing };
  const url = new URL(urlResult.expanded, baseUrl);
  const headers = {};
  for (const item of request.headers) {
    const result = expandVariables(item.value || '', variables);
    if (result.missing.length) return { missing: result.missing };
    headers[item.key] = result.expanded;
  }

  if (request.auth?.type === 'bearer') {
    const token = (request.auth.bearer || []).find((item) => item.key === 'token')?.value || '';
    const result = expandVariables(token, variables);
    if (result.missing.length) return { missing: result.missing };
    if (result.expanded) headers.Authorization = `Bearer ${result.expanded}`;
  }

  let body;
  if (request.body) {
    const result = expandVariables(request.body, variables);
    if (result.missing.length) return { missing: result.missing };
    body = result.expanded;
  }

  return { url, headers, method: request.method, body };
}

function safeRoute(url) {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search ? '?<query>' : ''}`;
}

module.exports = { buildRequest, expandVariables, loadMobileRequests, safeGetClass, safeRoute };