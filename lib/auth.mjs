// Auth: EIP-191 personal_sign challenge flow (per skill.md §1).
// The private key is loaded from env or a key file and NEVER logged.
// Session token stays in memory only.
import { readFile } from 'node:fs/promises';
import { Wallet } from 'ethers';

export async function loadWallet() {
  if (process.env.AIPROVE_AGENT_KEY) {
    const raw = process.env.AIPROVE_AGENT_KEY.trim();
    const key = raw.startsWith('{') ? JSON.parse(raw).privateKey : raw;
    return new Wallet(key);
  }
  const path = process.env.AIPROVE_AGENT_KEY_PATH || './agent-key.json';
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  return new Wallet(parsed.privateKey);
}

async function postJson(url, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error body */ }
  if (!res.ok) throw new Error(`POST ${url} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

export async function authenticate(apiBase, wallet) {
  const base = apiBase.replace(/\/$/, '');
  const chalRes = await fetch(`${base}/api/auth/challenge?address=${wallet.address}`);
  const chal = await chalRes.json();
  if (!chal.challenge) throw new Error(`no challenge: ${JSON.stringify(chal).slice(0, 300)}`);
  const signature = await wallet.signMessage(chal.challenge);
  const ver = await postJson(`${base}/api/auth/verify`, { address: wallet.address, signature });
  if (!ver.token) throw new Error(`no token: ${JSON.stringify(ver).slice(0, 300)}`);
  return { token: ver.token, address: ver.address, expiresAt: ver.expiresAt };
}
