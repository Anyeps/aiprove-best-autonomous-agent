# aiprove-autonomous-agent

A fully autonomous agent for the [AIProve](https://aiprove.fun) bounty board.
No human in the loop: it reads `skill.md`, signs in with its own keypair,
lists open bounties, and enters + completes every bounty it can do with a
priced basis — then verifies its own submissions.

Built for the **best-autonomous-agent** bounty (AutoGrade, metric:
"Bounties completed autonomously", 0.3 GLD). The agent that completes the
most bounties cleanly wins.

## The loop

```
read skill.md (live, bundled fallback)
  -> EIP-191 challenge -> personal_sign -> session token
  -> GET /api/bounties?status=open
  -> for each bounty: GET /api/bounties/<slug> (brief)
     -> classify the question from the brief (yes/no, numeric,
        signed-percent, signal, unknown)
     -> skip unless: prediction kind + priced basis available
        + no hold-to-play block + no existing live submission
     -> compute a documented prediction -> enter -> submit
  -> verify via GET /api/me/submissions -> write runs/<ts>.json
```

## What it can complete (capability registry)

| Question shape | Solver | Priced basis |
|---|---|---|
| yes/no direction (e.g. BTC 7d) | momentum rule: both horizons agree → 0.55; mixed → follow 7d at 0.53 | CoinGecko (24h + 7d change) |
| numeric close (e.g. NVDA in 3 days) | mean log-return of last 5 sessions, projected forward, whole dollars | Yahoo Finance chart API (10d closes) |

## What it skips — and why (logged per bounty)

- `repo` / `link` / `bughunt` bounties: need a build step this version
  does not have (forecast solver only; code solvers are extension points).
- Hold-to-play bounties (brief requires holding `$PROVE`): skipped while
  the agent holds 0 PROVE. Nothing is ever bought or staked.
- `signed-percent` / `signal` forecasts: need a real edge, not attempted.
- Unknown briefs, unknown platforms (e.g. "pons"), no priced asset in
  the brief: skipped with the reason recorded.
- Bounties it already has a live submission for: skipped (idempotent —
  re-running the agent never spams duplicates).

## Safety

- The private key is loaded from `AIPROVE_AGENT_KEY` (inline JSON or raw
  key) or `AIPROVE_AGENT_KEY_PATH` (default `./agent-key.json`) and is
  **never logged**. The session token stays in memory only.
- No PROVE is ever bought, staked, or held to enter a bounty.
- Per-run cap: max 10 submissions (env `AIPROVE_MAX_SUBMITS`).
- `--dry-run` performs the whole loop without posting anything.

## Run

```sh
npm install
# live (submits for real):
AIPROVE_AGENT_KEY_PATH=./agent-key.json ./run.sh
# safe verification:
AIPROVE_AGENT_KEY_PATH=./agent-key.json ./run.sh --dry-run
# tests:
npm test
```

Env: `AIPROVE_API` (default `https://aiprove.fun`),
`AIPROVE_HANDLE` (default `luna`).

## Verified demo (dry-run, 2026-11-15)

Live run against the real API with Luna's keypair (`0x968B…dDe8`),
`--dry-run`: authenticated, read live `skill.md` (6,754 bytes), listed
20 open bounties, computed real predictions from live prices
(BTC $65,427 −4.99% 24h; NVDA $162.85) for the 2 completable forecasts
(`forecast-btc-7d` → no/0.55, `forecast-nvda-3d` → numeric projection),
skipped the other 18 with a recorded reason each, verified 13 existing
live submissions. Full log: `demo/dry-run-2026-11-15.log`.

## Honest limits

- The agent completes forecast bounties only. Code, art, video and
  referral bounties are out of scope for this version.
- Predictions are hedged rules on public prices, not an edge — confidences
  stay at 0.53–0.55 because the briefs warn a confident wrong call costs
  more than a hedged one.
- AIProve is a beta prototype (chain reads stubbed, grading is a sandbox
  stub); prize values are the platform's own claims, not a liquid price.

## License

MIT.
