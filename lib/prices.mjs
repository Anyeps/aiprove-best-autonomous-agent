// Live price feeds. No API keys anywhere.
// - Crypto (BTC/ETH): CoinGecko public API (simple price + 7d market chart).
// - US equities (NVDA/SPY/GLD): Yahoo Finance chart API (public, no key).
// CoinGecko has a token called "nvidia" that is NOT the stock — never use it
// for NVDA. Stooq is JS-challenge blocked from this environment — not used.

const CG = 'https://api.coingecko.com/api/v3';
const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart';

async function getJson(url, label) {
  const res = await fetch(url, { headers: { 'user-agent': 'aiprove-autonomous-agent/1.0' } });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  return res.json();
}

/** BTC + ETH: current price, 24h change, 7d change (from market chart). */
export async function getCryptoMomentum() {
  const [simple, btcChart, ethChart] = await Promise.all([
    getJson(`${CG}/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true`, 'coingecko-simple'),
    getJson(`${CG}/coins/bitcoin/market_chart?vs_currency=usd&days=7`, 'coingecko-btc-chart'),
    getJson(`${CG}/coins/ethereum/market_chart?vs_currency=usd&days=7`, 'coingecko-eth-chart'),
  ]);
  const change7d = (chart) => {
    const p = chart.prices;
    if (!Array.isArray(p) || p.length < 2) return null;
    return p[p.length - 1][1] / p[0][1] - 1;
  };
  return {
    BTC: {
      price: simple.bitcoin.usd,
      change24h: simple.bitcoin.usd_24h_change / 100,
      change7d: change7d(btcChart),
    },
    ETH: {
      price: simple.ethereum.usd,
      change24h: simple.ethereum.usd_24h_change / 100,
      change7d: change7d(ethChart),
    },
  };
}

/** Daily closes for a US equity symbol via Yahoo Finance (last `range`). */
export async function getEquityCloses(symbol, range = '10d') {
  const data = await getJson(
    `${YAHOO}/${encodeURIComponent(symbol)}?range=${range}&interval=1d`,
    `yahoo-${symbol}`,
  );
  const result = data?.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close;
  const timestamps = result?.timestamp;
  if (!Array.isArray(closes) || closes.length < 2) {
    throw new Error(`yahoo-${symbol}: no usable close series`);
  }
  const series = closes
    .map((c, i) => ({ date: timestamps?.[i] ? new Date(timestamps[i] * 1000).toISOString().slice(0, 10) : null, close: c }))
    .filter((p) => typeof p.close === 'number' && Number.isFinite(p.close));
  if (series.length < 2) throw new Error(`yahoo-${symbol}: too few closes`);
  return { symbol, closes: series.map((p) => p.close), lastClose: series[series.length - 1].close, lastDate: series[series.length - 1].date };
}
