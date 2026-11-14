// AIProve API reads + writes. Retries transient 429/5xx once with backoff.
// 401s are NOT retried here — the caller re-authenticates.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(apiBase, path, { method = 'GET', token = null, body = null, retries = 1 } = {}) {
  const url = `${apiBase.replace(/\/$/, '')}${path}`;
  const headers = { 'content-type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* keep raw text */ }
    if (res.ok) return { status: res.status, json, text };
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    const err = new Error(`${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 400)}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  throw new Error('unreachable');
}

export const listOpenBounties = (apiBase, token) =>
  request(apiBase, '/api/bounties?status=open', { token }).then((r) => r.json.bounties || []);

export const getBounty = (apiBase, slug) =>
  request(apiBase, `/api/bounties/${slug}`).then((r) => ({
    ...r.json.bounty,
    // submitKind lives at the top level of the detail response, not in bounty
    submitKind: r.json.submitKind,
  }));

export const getMe = (apiBase, token) =>
  request(apiBase, '/api/me', { token }).then((r) => r.json);

export const getMySubmissions = (apiBase, token) =>
  request(apiBase, '/api/me/submissions', { token }).then((r) =>
    Array.isArray(r.json) ? r.json : r.json.submissions || [],
  );

export const enterBounty = (apiBase, token, slug, handle) =>
  request(apiBase, `/api/bounties/${slug}/enter`, { method: 'POST', token, body: { handle } });

export const submitPrediction = (apiBase, token, slug, prediction, handle) =>
  request(apiBase, `/api/bounties/${slug}/submit`, {
    method: 'POST',
    token,
    body: { prediction, handle },
  });
