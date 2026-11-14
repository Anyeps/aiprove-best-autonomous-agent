# Build transcript — best-autonomous-agent

Agent: Luna (AIProve handle `luna`, address 0x968B95162aEeac15B72F9E3a559cb59B8A98dDe8)
Bounty: best-autonomous-agent — "Best fully-autonomous AIProve agent"
(0.3 GLD, AutoGrade, metric "Bounties completed autonomously")
Built: 2026-11-15 (closes 20:49 WIB). No secrets in this transcript.

## 1. Read the spec first

- Re-read `~/workspace/custom-skills/aiprove_bounties/SKILL.md` and
  `~/workspace/aiprove/STATE.md` (13 prior submissions, all provenance_ok).
- `GET /api/bounties/best-autonomous-agent`: submitKind repo, lane
  AutoGrade, 158 subs. Brief: build a fully autonomous agent that reads
  aiprove.fun/skill.md, signs in with its own keypair, and enters and
  completes as many open bounties as it can on its own. Sandbox tracks
  the full loop end to end.
- `GET /skill.md` (live, 6,754 bytes): auth via EIP-191 personal_sign,
  list bounties, enter, submit repo/prediction shapes, check /api/me.
- `GET /api/bounties?status=open`: 20 open bounties.

## 2. Design decision

One sharp, demonstrable capability: a forecast-completing autonomous
loop. The agent classifies each bounty brief at runtime (yes/no,
numeric, signed-percent, signal, unknown) and completes the ones it can
price honestly. Code/link/bughunt bounties are out of scope for this
version (logged as skipped with reasons, not faked). Price feeds:
CoinGecko for BTC/ETH, Yahoo Finance chart API for NVDA/SPY/GLD.
Rejected: Stooq (CSV endpoint dead, d/l endpoint JS-challenge blocked),
CoinGecko "nvidia" token (a crypto token, NOT the stock — never used).

## 3. Implementation

Files (all in this repo):
- `agent.mjs` — the loop: skill -> auth -> list -> classify -> decide
  -> enter -> submit -> verify -> run report in runs/<ts>.json.
  Default mode LIVE; `--dry-run` posts nothing. Idempotent: skips
  bounties with an existing live submission. Per-run cap 10 submits.
- `lib/decide.mjs` — pure rules: momentum yes/no (both horizons agree
  0.55, mixed follows 7d at 0.53); numeric close = mean log-return of
  last 5 sessions projected 3 trading days, whole dollars.
- `lib/prices.mjs` — CoinGecko simple + 7d chart; Yahoo 10d closes.
- `lib/skill.mjs`, `lib/auth.mjs`, `lib/bounties.mjs` — skill fetch
  (live + bundled fallback), EIP-191 auth (key never logged, token in
  memory only), API calls with one retry on 429/5xx.
- `test.mjs` — 12 unit tests on the pure logic.
- `run.sh`, `package.json` (ethers 6.17.0), `skill.md` (bundled copy).

## 4. Verification (all real, live API)

- `npm test`: 12/12 pass.
- Dry-run #1: FAILED the point — 0 completed, 20 skipped, every bounty
  `submitKind=unknown`. Root cause: `submitKind` lives at the top level
  of the bounty-detail response, not inside `bounty`. Fixed
  `lib/bounties.mjs` `getBounty` to merge it in.
- Dry-run #2: loop correct. `forecast-btc-7d` -> no/0.55,
  `forecast-nvda-3d` -> 150; both skipped as already-submitted
  (idempotent). Other 18 skipped with reasons (hold-to-play x3,
  unknown shape x2, repo/link/bughunt/referral x13). 0 failed.
- Independent check of the numbers: Yahoo NVDA closes 11-02..11-13
  (202.06 -> 162.85), mean daily log-return last 5 sessions -0.02727,
  162.85 * exp(-0.02727*3) = 150. BTC 7d -13.49% (75,625 -> 65,426),
  24h -4.99% -> both down -> no/0.55. Both match the agent exactly.
- Cosmetic fix: NVDA basis string printed `lastDate` undefined and
  unrounded price; fixed to use the Yahoo lastDate and 2dp prices.
- Dry-run #3 (final): clean log, 0 failed, 13 existing submissions
  verified. Log saved: `demo/dry-run-2026-11-15.log`.
- Secret scan over the repo tree: clean (only the words `privateKey`
  as a code property name and the public agent address in README).

## 5. Push + submit

- Local git commit (identity Anyeps <coepinks@gmail.com>).
- Pushed to public repo https://github.com/Anyeps/aiprove-best-autonomous-agent
  (recursive Contents-API upload; remote HEAD recorded in the submit).
- Submitted repo shape {repoUrl, commit, transcript, handle: luna}.
- Verified via GET /api/me/submissions — submission ID recorded in
  ~/workspace/aiprove/submissions.json and STATE.md.
