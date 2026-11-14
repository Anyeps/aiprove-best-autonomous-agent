// Unit tests — pure decision logic only (no network, no keys).
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyForecast, detectSymbol, decideYesNo, projectClose } from './lib/decide.mjs';

test('classifyForecast: yes/no BTC', () => {
  const c = classifyForecast('Will BTC close higher seven days from now? Submit yes or no plus a probability from 0 to 1.');
  assert.equal(c.kind, 'yes-no');
  assert.equal(c.symbol, 'BTC');
  assert.equal(c.holdToPlay, false);
});

test('classifyForecast: numeric NVDA', () => {
  const c = classifyForecast("Submit one number: NVDA's close three trading days from now.");
  assert.equal(c.kind, 'numeric');
  assert.equal(c.symbol, 'NVDA');
});

test('classifyForecast: hold-to-play detected', () => {
  const c = classifyForecast('Entry requires holding $PROVE (hold-to-play), held through resolve. Submit a single signed percent.');
  assert.equal(c.kind, 'signed-percent');
  assert.equal(c.holdToPlay, true);
});

test('classifyForecast: signal + unknown', () => {
  assert.equal(classifyForecast('Submit a directional ETH signal (long or short, with size/confidence).').kind, 'signal');
  assert.equal(classifyForecast('Name five tokens freshly launched on pons.').kind, 'unknown');
});

test('detectSymbol: NVDA before ETH, BTC first', () => {
  assert.equal(detectSymbol('NVDA earnings'), 'NVDA');
  assert.equal(detectSymbol('ETH signal'), 'ETH');
  assert.equal(detectSymbol('nothing priced here'), null);
});

test('decideYesNo: both up -> yes 0.55', () => {
  const d = decideYesNo({ change24h: 0.02, change7d: 0.05 });
  assert.deepEqual([d.answer, d.confidence], ['yes', 0.55]);
});

test('decideYesNo: both down -> no 0.55', () => {
  const d = decideYesNo({ change24h: -0.0499, change7d: -0.08 });
  assert.deepEqual([d.answer, d.confidence], ['no', 0.55]);
});

test('decideYesNo: mixed -> follow 7d at 0.53', () => {
  const d = decideYesNo({ change24h: 0.01, change7d: -0.04 });
  assert.deepEqual([d.answer, d.confidence], ['no', 0.53]);
});

test('decideYesNo: flat -> hedged no 0.53', () => {
  const d = decideYesNo({ change24h: 0, change7d: 0 });
  assert.deepEqual([d.answer, d.confidence], ['no', 0.53]);
});

test('projectClose: flat closes -> last close', () => {
  const p = projectClose([100, 100, 100, 100, 100, 100], 3);
  assert.equal(p.prediction, 100);
  assert.equal(p.naive, 100);
});

test('projectClose: steady +1%/day compounds', () => {
  const closes = [100, 101, 102.01, 103.0301, 104.0604, 105.101];
  const p = projectClose(closes, 3);
  // 105.101 * 1.01^3 ≈ 108.3 -> 108
  assert.equal(p.prediction, 108);
});

test('projectClose: needs >= 2 closes', () => {
  assert.throws(() => projectClose([100], 3), /at least 2 closes/);
});
