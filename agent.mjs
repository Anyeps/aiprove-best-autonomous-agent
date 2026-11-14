// aiprove-autonomous-agent — fully autonomous AIProve agent.
// Loop, no human in the loop:
//   1. read skill.md live (bundled fallback)
//   2. sign in with its own keypair (EIP-191 challenge)
//   3. list open bounties, fetch each brief, classify the question
//   4. for every bounty it CAN complete with a priced basis, compute a
//      documented prediction and enter + submit it
//   5. verify via /api/me/submissions and write a run report
//
// Safety: private key is never logged; no PROVE is ever bought or staked;
// hold-to-play bounties are skipped when the agent holds 0 PROVE;
// bounties it already has a live submission for are skipped (idempotent);
// --dry-run performs the whole loop without posting any submission.
// Default mode is LIVE (that is the point of the agent); pass --dry-run
// to verify safely.
import { writeFile, mkdir } from 'node:fs/promises';
import { loadWallet, authenticate } from './lib/auth.mjs';
import { readSkill } from './lib/skill.mjs';
import {
  listOpenBounties,
  getBounty,
  getMe,
  getMySubmissions,
  enterBounty,
  submitPrediction,
} from './lib/bounties.mjs';
import { getCryptoMomentum, getEquityCloses } from './lib/prices.mjs';
import { classifyForecast, decideYesNo, projectClose } from './lib/decide.mjs';

const API = process.env.AIPROVE_API || 'https://aiprove.fun';
const HANDLE = process.env.AIPROVE_HANDLE || 'luna';
const MAX_SUBMITS = Number(process.env.AIPROVE_MAX_SUBMITS || 10);

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const LIVE = !DRY_RUN;

const ts = () => new Date().toISOString();
const log = (msg) => console.log(`[${ts()}] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn, label, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === retries) throw e;
      log(`WARN ${label} failed (${e.message}); retry ${i + 1}/${retries} in 3s`);
      await sleep(3000);
    }
  }
}

/** Fetch a priced basis for a symbol. Returns null when unavailable. */
async function getBasis(symbol, cryptoCache) {
  try {
    if (symbol === 'BTC' || symbol === 'ETH') {
      const m = cryptoCache || (await getCryptoMomentum());
      const s = m[symbol];
      if (s.change7d === null || s.change7d === undefined) return null;
      return { symbol, price: s.price, change24h: s.change24h, change7d: s.change7d, source: 'CoinGecko' };
    }
    if (symbol === 'NVDA' || symbol === 'SPY' || symbol === 'GLD') {
      const eq = await getEquityCloses(symbol);
      return { symbol, closes: eq.closes, lastClose: eq.lastClose, lastDate: eq.lastDate, source: 'Yahoo Finance' };
    }
  } catch (e) {
    log(`WARN price basis for ${symbol} unavailable: ${e.message}`);
  }
  return null;
}

async function main() {
  log(`agent starting — mode=${LIVE ? 'LIVE (will submit for real)' : 'DRY-RUN (no submissions posted)'} handle=${HANDLE}`);
  const wallet = await loadWallet();
  log(`identity: ${wallet.address} (keypair from ${process.env.AIPROVE_AGENT_KEY ? 'env' : process.env.AIPROVE_AGENT_KEY_PATH || './agent-key.json'})`);

  const skill = await readSkill(API);
  log(`skill.md read from ${skill.source} (${skill.text.length} bytes)`);

  const { token, expiresAt } = await withRetry(() => authenticate(API, wallet), 'auth');
  log(`authenticated; session expiresAt=${expiresAt}`);

  const me = await getMe(API, token);
  const heldProve = me?.credit?.held ?? me?.credit?.total ?? 0;
  log(`account: ${me?.handle || HANDLE} | PROVE held=${heldProve} (hold-to-play gate)`);

  const bounties = await listOpenBounties(API, token);
  log(`open bounties: ${bounties.length}`);
  const mine = await getMySubmissions(API, token);
  const submittedSlugs = new Set(mine.map((s) => s.bountySlug));
  log(`my existing live submissions: ${mine.length}`);

  const report = {
    startedAt: ts(),
    mode: LIVE ? 'live' : 'dry-run',
    agent: wallet.address,
    handle: HANDLE,
    skillSource: skill.source,
    openBounties: bounties.length,
    completed: [],
    skipped: [],
    failed: [],
  };
  let cryptoCache = null;
  let submits = 0;

  for (const b of bounties) {
    if (submits >= MAX_SUBMITS) {
      report.skipped.push({ slug: b.slug, reason: `per-run cap (${MAX_SUBMITS} submits) reached` });
      continue;
    }
    const detail = await withRetry(() => getBounty(API, b.slug), `detail ${b.slug}`).catch((e) => {
      report.failed.push({ slug: b.slug, reason: `could not fetch detail: ${e.message}` });
      return null;
    });
    if (!detail) continue;

    const submitKind = detail.submitKind ?? b.submitKind;
    if (submitKind !== 'prediction') {
      report.skipped.push({ slug: b.slug, reason: `submitKind=${submitKind || 'unknown'} — no solver in this version (forecast solver only); needs a build step` });
      continue;
    }
    const cls = classifyForecast(detail.brief || '');
    if (cls.kind === 'unknown') {
      report.skipped.push({ slug: b.slug, reason: 'brief does not match a known forecast shape (yes/no, numeric, signed-percent, signal)' });
      continue;
    }
    if (cls.holdToPlay && heldProve <= 0) {
      report.skipped.push({ slug: b.slug, reason: 'hold-to-play: brief requires holding $PROVE, agent holds 0' });
      continue;
    }
    if (cls.kind === 'signed-percent' || cls.kind === 'signal') {
      report.skipped.push({ slug: b.slug, reason: `${cls.kind} forecast needs a real edge + (usually) a PROVE hold; not attempted by this version` });
      continue;
    }
    if (!cls.symbol) {
      report.skipped.push({ slug: b.slug, reason: 'no priced asset detectable in brief — no priced basis' });
      continue;
    }
    if (submittedSlugs.has(b.slug)) {
      // Still compute the prediction for the log, then skip posting.
      const pred = await computePrediction(cls, () => cryptoCache ?? (cryptoCache = getCryptoMomentum()));
      if (pred) log(`${b.slug}: ${cls.kind} ${cls.symbol} -> ${JSON.stringify(pred.payload)} [${pred.basis}] (already submitted — skipping)`);
      report.skipped.push({ slug: b.slug, reason: 'already has a live submission (idempotent skip)', wouldSubmit: pred?.payload ?? null, basis: pred?.basis ?? null });
      continue;
    }

    const pred = await computePrediction(cls, async () => cryptoCache ?? (cryptoCache = await getCryptoMomentum()));
    if (!pred) {
      report.skipped.push({ slug: b.slug, reason: `no priced basis available for ${cls.symbol}` });
      continue;
    }
    log(`${b.slug}: ${cls.kind} ${cls.symbol} -> ${JSON.stringify(pred.payload)} [${pred.basis}]`);

    if (!LIVE) {
      report.completed.push({ slug: b.slug, dryRun: true, payload: pred.payload, basis: pred.basis });
      submits++;
      continue;
    }
    try {
      await enterBounty(API, token, b.slug, HANDLE);
      const res = await submitPrediction(API, token, b.slug, pred.payload, HANDLE);
      const id = res.json?.id || res.json?.submissionId || null;
      log(`${b.slug}: SUBMITTED id=${id} status=${res.json?.status || '?'}`);
      report.completed.push({ slug: b.slug, submissionId: id, status: res.json?.status, payload: pred.payload, basis: pred.basis });
      submittedSlugs.add(b.slug);
      submits++;
    } catch (e) {
      // Adaptive retry: the API's 400 names the expected shape. Numeric
      // forecasts are submitted without confidence; if the API demands it,
      // retry once with confidence 0.55.
      if (e.status === 400 && /confidence/i.test(e.body || '') && !('confidence' in pred.payload)) {
        log(`${b.slug}: 400 mentions confidence — retrying with confidence 0.55`);
        try {
          const retry = await submitPrediction(API, token, b.slug, { ...pred.payload, confidence: 0.55 }, HANDLE);
          const id = retry.json?.id || retry.json?.submissionId || null;
          log(`${b.slug}: SUBMITTED (retry) id=${id} status=${retry.json?.status || '?'}`);
          report.completed.push({ slug: b.slug, submissionId: id, status: retry.json?.status, payload: { ...pred.payload, confidence: 0.55 }, basis: pred.basis });
          submittedSlugs.add(b.slug);
          submits++;
          continue;
        } catch (e2) {
          report.failed.push({ slug: b.slug, reason: `submit failed after confidence retry: ${e2.message}` });
          continue;
        }
      }
      report.failed.push({ slug: b.slug, reason: `submit failed: ${e.message}` });
    }
  }

  // Verify final state.
  const after = await getMySubmissions(API, token).catch(() => []);
  report.finishedAt = ts();
  report.mySubmissionsAfter = after.length;
  report.verifiedSubmissionIds = after.map((s) => s.id);

  await mkdir('runs', { recursive: true });
  const outPath = `runs/${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  await writeFile(outPath, JSON.stringify(report, null, 2));
  log(`run report: ${outPath}`);
  log(`SUMMARY: ${report.completed.length} completed, ${report.skipped.length} skipped, ${report.failed.length} failed; my submissions now: ${after.length}`);
  if (report.failed.length) {
    for (const f of report.failed) log(`FAILED ${f.slug}: ${f.reason}`);
  }
}

/** Compute the prediction payload for a classified forecast, or null. */
async function computePrediction(cls, getCrypto) {
  if (cls.kind === 'yes-no') {
    if (cls.symbol !== 'BTC' && cls.symbol !== 'ETH') return null;
    const m = await getCrypto();
    const s = m[cls.symbol];
    if (s.change7d === null || s.change7d === undefined) return null;
    const d = decideYesNo({ change24h: s.change24h, change7d: s.change7d });
    return { payload: { answer: d.answer, confidence: d.confidence }, basis: `${cls.symbol} $${s.price} (${d.basis})` };
  }
  if (cls.kind === 'numeric') {
    if (cls.symbol === 'NVDA' || cls.symbol === 'SPY' || cls.symbol === 'GLD') {
      const eq = await getEquityCloses(cls.symbol).catch(() => null);
      if (!eq) return null;
      const p = projectClose(eq.closes, 3);
      return { payload: { answer: p.prediction }, basis: `${cls.symbol} last close $${eq.lastClose.toFixed(2)} (${eq.lastDate}); ${p.basis}` };
    }
    if (cls.symbol === 'BTC' || cls.symbol === 'ETH') {
      const m = await getCrypto();
      const s = m[cls.symbol];
      return { payload: { answer: Math.round(s.price) }, basis: `${cls.symbol} current $${s.price} (no drift model for crypto numeric; naive last price)` };
    }
    return null;
  }
  return null;
}

main().catch((e) => {
  console.error(`[${ts()}] FATAL: ${e.message}`);
  process.exit(1);
});
