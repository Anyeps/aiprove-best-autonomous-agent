// Pure decision logic for the autonomous agent — no I/O, fully unit-tested.
// Every rule below is documented and deterministic; nothing here is a guess
// dressed up as precision. Confidences stay hedged (0.53–0.55) because the
// briefs themselves warn that a confident wrong call costs more.

export const HOLD_RE = /hold-to-play|holding \$PROVE/i;

/** Detect which priced asset a bounty brief is about, if any. */
export function detectSymbol(brief) {
  const text = brief || '';
  if (/BTC|bitcoin/i.test(text)) return 'BTC';
  if (/NVDA|NVIDIA/i.test(text)) return 'NVDA';
  if (/\bETH\b|ethereum/i.test(text)) return 'ETH';
  if (/\bSPY\b/i.test(text)) return 'SPY';
  if (/\bGLD\b|gold/i.test(text)) return 'GLD';
  return null;
}

/**
 * Classify a forecast bounty from its brief text.
 * Returns { kind, holdToPlay, symbol }.
 * kind: 'yes-no' | 'numeric' | 'signed-percent' | 'signal' | 'unknown'
 */
export function classifyForecast(brief) {
  const text = brief || '';
  const holdToPlay = HOLD_RE.test(text);
  const symbol = detectSymbol(text);
  if (/submit yes or no/i.test(text) || (/yes or no/i.test(text) && /probability/i.test(text))) {
    return { kind: 'yes-no', holdToPlay, symbol };
  }
  if (/submit one number/i.test(text) || /submit a single number/i.test(text)) {
    return { kind: 'numeric', holdToPlay, symbol };
  }
  if (/signed percent/i.test(text)) {
    return { kind: 'signed-percent', holdToPlay, symbol };
  }
  if (/long or short/i.test(text)) {
    return { kind: 'signal', holdToPlay, symbol };
  }
  return { kind: 'unknown', holdToPlay, symbol };
}

/**
 * Yes/no direction call from momentum.
 * Both horizons agreeing -> 0.55; mixed -> follow the 7d trend at 0.53.
 * Zero trend on both -> hedged 'no' at 0.53.
 */
export function decideYesNo({ change24h, change7d }) {
  const s24 = Math.sign(change24h);
  const s7 = Math.sign(change7d);
  if (s24 > 0 && s7 > 0) {
    return { answer: 'yes', confidence: 0.55, basis: `24h ${pct(change24h)} and 7d ${pct(change7d)} both up` };
  }
  if (s24 < 0 && s7 < 0) {
    return { answer: 'no', confidence: 0.55, basis: `24h ${pct(change24h)} and 7d ${pct(change7d)} both down` };
  }
  if (s7 !== 0) {
    return {
      answer: s7 > 0 ? 'yes' : 'no',
      confidence: 0.53,
      basis: `mixed momentum (24h ${pct(change24h)}, 7d ${pct(change7d)}); following the 7d trend`,
    };
  }
  return { answer: 'no', confidence: 0.53, basis: 'no trend on either horizon; hedged no' };
}

/**
 * Project a close N trading days out from recent closes.
 * Mean log-return over the last 5 sessions, projected forward, rounded to
 * whole dollars. Returns the projection plus the naive (last close) baseline.
 */
export function projectClose(closes, daysAhead = 3) {
  if (!Array.isArray(closes) || closes.length < 2) {
    throw new Error('projectClose needs at least 2 closes');
  }
  const rets = [];
  for (let i = Math.max(1, closes.length - 5); i < closes.length; i++) {
    rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const last = closes[closes.length - 1];
  const projected = last * Math.exp(mean * daysAhead);
  return {
    prediction: Math.round(projected),
    lastClose: last,
    meanDailyLogRet: mean,
    naive: last,
    basis: `last close ${last.toFixed(2)}, mean daily log-return over last ${rets.length} sessions ${mean.toFixed(5)}, projected ${daysAhead} trading days`,
  };
}

function pct(x) {
  return `${(x * 100).toFixed(2)}%`;
}
