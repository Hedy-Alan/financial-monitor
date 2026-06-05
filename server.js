/**
 * 📈 Financial Monitor — Server
 * Real-time A-shares / HK / US / Forex / Commodities / Crypto
 * HTTP + WebSocket, open in Edge --app mode for frameless desktop window.
 */
'use strict';

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { WebSocketServer } = require('ws');
const iconv  = require('iconv-lite');

// ── Config ──────────────────────────────────────────────────────────────────
const PORT       = 9877;
const POLL_MS    = 1000; // tick every 1s, internal scheduler decides what to fetch
const DATA_DIR   = path.join(__dirname, 'data');
const STOCKS_FILE = path.join(DATA_DIR, 'stocks.json');
const ALERTS_FILE = path.join(DATA_DIR, 'alerts.json');
const PREFS_FILE  = path.join(DATA_DIR, 'prefs.json');

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

// ── Default stocks ──────────────────────────────────────────────────────────
const DEFAULTS = [
  { id:'sh600519', code:'sh600519', market:'a', name:'贵州茅台',   displayName:'茅台',   sort:0, enabled:true },
  { id:'sz000858', code:'sz000858', market:'a', name:'五粮液',     displayName:'五粮液', sort:1, enabled:true },
  { id:'sz300750', code:'sz300750', market:'a', name:'宁德时代',   displayName:'宁德',   sort:2, enabled:true },
  { id:'sh600036', code:'sh600036', market:'a', name:'招商银行',   displayName:'招行',   sort:3, enabled:true },
  { id:'sh000001', code:'s_sh000001',market:'index_a',name:'上证指数',displayName:'上证',sort:4, enabled:true },
  { id:'sz399001', code:'s_sz399001',market:'index_a',name:'深证成指',displayName:'深证',sort:5, enabled:true },
  { id:'hk00700',  code:'hk00700',  market:'hk', name:'腾讯控股',  displayName:'腾讯',   sort:10,enabled:true },
  { id:'hk09988',  code:'hk09988',  market:'hk', name:'阿里巴巴',  displayName:'阿里',   sort:11,enabled:true },
  { id:'hk03690',  code:'hk03690',  market:'hk', name:'美团',      displayName:'美团',   sort:12,enabled:true },
  { id:'us_aapl',  code:'gb_aapl',  market:'us', name:'Apple',     displayName:'AAPL',  sort:20,enabled:true },
  { id:'us_tsla',  code:'gb_tsla',  market:'us', name:'Tesla',     displayName:'TSLA',  sort:21,enabled:true },
  { id:'us_nvda',  code:'gb_nvda',  market:'us', name:'NVIDIA',    displayName:'NVDA',  sort:22,enabled:true },
  { id:'fx_usdcny',code:'fx_susdcny',market:'forex',name:'美元/人民币',displayName:'USDCNY',sort:30,enabled:true },
  { id:'fx_eurusd',code:'fx_seurusd',market:'forex',name:'欧元/美元',displayName:'EURUSD',sort:31,enabled:true },
  { id:'cc_btc',   code:'btc_usdt', market:'crypto',name:'BTC/USDT',displayName:'BTC',   sort:40,enabled:true },
  { id:'cc_eth',   code:'eth_usdt', market:'crypto',name:'ETH/USDT',displayName:'ETH',   sort:41,enabled:true },
  { id:'cc_sol',   code:'sol_usdt', market:'crypto',name:'SOL/USDT',displayName:'SOL',   sort:42,enabled:true },
  { id:'cm_gold',  code:'nf_AU0',   market:'commodity',name:'沪金主力',displayName:'黄金',  sort:50,enabled:true },
  { id:'cm_oil',   code:'nf_SC0',   market:'commodity',name:'原油主力',displayName:'原油',  sort:51,enabled:true },
];

// ── Store ───────────────────────────────────────────────────────────────────
let stocks   = load(STOCKS_FILE, DEFAULTS);
let alerts   = load(ALERTS_FILE, []);
let prefs    = load(PREFS_FILE, { windowSize:'standard' });
let pollState = { lastPrices:{}, lastFetch:{} };

function load(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch { return fallback; }
}
function save(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); } catch {}
}

// ════════════════════════════════════════════════════════════════════════════
//  Fetch
// ════════════════════════════════════════════════════════════════════════════

function rawGet(url, headers = {}, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? require('https') : http;
    const req = mod.get(url, { headers, timeout }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return rawGet(new URL(res.headers.location, url).href, headers, timeout).then(resolve, reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

function apiFor(code, market) {
  switch (market) {
    case 'a':
      return { url:`http://qt.gtimg.cn/q=${code}`, headers:{}, encoding:'gbk', parser:'tencent' };
    case 'hk':
      return { url:`http://hq.sinajs.cn/list=${code}`, headers:{Referer:'https://finance.sina.com.cn'}, encoding:'gbk', parser:'sina' };
    case 'us':
      return { url:`http://hq.sinajs.cn/list=${code}`, headers:{Referer:'https://finance.sina.com.cn'}, encoding:'gbk', parser:'sina' };
    case 'forex':
      return { url:`http://hq.sinajs.cn/list=${code}`, headers:{Referer:'https://finance.sina.com.cn'}, encoding:'gbk', parser:'sina-forex' };
    case 'commodity':
      return { url:`http://hq.sinajs.cn/list=${code}`, headers:{Referer:'https://finance.sina.com.cn'}, encoding:'gbk', parser:'sina-commodity' };
    case 'crypto':
      return { url:`https://data.gateapi.io/api2/1/ticker/${code}`, headers:{}, encoding:'utf8', parser:'gate' };
    case 'index_a':
      return { url:`http://hq.sinajs.cn/list=${code}`, headers:{Referer:'https://finance.sina.com.cn'}, encoding:'gbk', parser:'sina-index' };
    default: return null;
  }
}

// ── Parsers ─────────────────────────────────────────────────────────────────

function parseData(raw, encoding, parser, code, market) {
  try {
    const str = encoding === 'gbk' ? iconv.decode(raw, 'gbk') : raw.toString('utf8');
    const m = str.match(/"([^"]*)"/);
    if (!m) return null;
    const f = m[1].split(parser.includes('gate') ? '' : parser.includes('tencent') ? '~' : ',');

    if (parser === 'tencent') {
      if (f.length < 33) return null;
      return { code:f[2]||code, name:f[1]||code, price:p(f[3]), prevClose:p(f[4]),
        open:p(f[5]), volume:parseInt(f[6])||0, high:p(f[33]), low:p(f[34]),
        change:+(p(f[3])-p(f[4])).toFixed(2), changePercent:p(f[32])||0, time:f[30]||'' };
    }
    if (parser === 'sina') { // HK / US generic
      if (market === 'hk') return { code,name:f[1]||f[0],price:p(f[6]),prevClose:p(f[3]),open:p(f[2]),high:p(f[4]),low:p(f[5]),change:p(f[7]),changePercent:p(f[8]),volume:p(f[10]),time:f[f.length-3]||'' };
      if (market === 'us') return { code,name:f[0],price:p(f[1]),prevClose:p(f[2]),open:p(f[5]),high:p(f[6]),low:p(f[7]),change:p(f[4]),changePercent:parseFloat(f[3])||0,time:f[f.length-2]||'' };
    }
    if (parser === 'sina-forex') return { code,name:code,price:p(f[1]),bid:p(f[2]),ask:p(f[3]),time:f[0]||'' };
    if (parser === 'sina-commodity') return { code,name:f[0]||code,price:p(f[1])||p(f[8]),prevClose:p(f[2])||p(f[9]),open:p(f[3]),high:p(f[4]),low:p(f[5]),time:f[6]||'' };
    if (parser === 'sina-index') return { code,name:f[0]||code,price:p(f[1]),prevClose:p(f[2]),change:p(f[3]),changePercent:p(f[4]),volume:parseInt(f[5])||0,time:'' };
    if (parser === 'gate') {
      try { const d=JSON.parse(raw); if(!d.result)return null; return { code,name:code.replace('_','/').toUpperCase(),price:p(d.last),bid:p(d.highestBid),ask:p(d.lowestAsk),high24h:p(d.high24hr),low24h:p(d.low24hr),changePercent:parseFloat(d.percentChange)||0,volume:p(d.baseVolume),time:'' }; } catch { return null; }
    }
  } catch { return null; }
  return null;
}
function p(v) { const n=parseFloat(v); return isNaN(n)?0:n; }

// ════════════════════════════════════════════════════════════════════════════
//  Polling
// ════════════════════════════════════════════════════════════════════════════

function isTrading(market) {
  const d = new Date(), day = d.getDay(), h = d.getHours(), m = d.getMinutes();
  if (day === 0 || day === 6) return market === 'crypto'; // crypto always on
  switch (market) {
    case 'a': return ((h===9&&m>=30)||h===10||(h===11&&m<=30)||(h>=13&&h<15));
    case 'hk': return ((h===9&&m>=30)||h===10||h===11||(h>=13&&h<16));
    case 'us': return (h>=21||h<4); // simplified
    case 'forex': case 'crypto': return true;
    default: return true;
  }
}

function getInterval(m) {
  if (!isTrading(m)) return 30000;
  if (m === 'a') return 3000; return 10000;
}

async function poll() {
  const active = stocks.filter(s => s.enabled !== false);
  const now = Date.now();
  const due = [];
  for (const s of active) {
    const iv = getInterval(s.market);
    if (now - (pollState.lastFetch[s.code] || 0) >= iv) {
      due.push(s);
      pollState.lastFetch[s.code] = now;
    }
  }
  if (due.length === 0) return;

  const results = [];
  for (const s of due) {
    const info = apiFor(s.code, s.market);
    if (!info) continue;
    try {
      const buf = await rawGet(info.url, info.headers);
      const parsed = parseData(buf, info.encoding, info.parser, s.code, s.market);
      if (parsed) {
        const prev = pollState.lastPrices[s.code];
        parsed.id = s.id; parsed.market = s.market;
        parsed.isUp = prev ? parsed.price > prev : null;
        parsed.prevPrice = prev;
        if (parsed.price > 0) pollState.lastPrices[s.code] = parsed.price;
        results.push(parsed);
        checkAlerts(parsed);
      }
    } catch {}
  }
  if (results.length > 0) broadcast({ type:'update', stocks:results, timestamp:Date.now() });
}

// ── Alerts ──────────────────────────────────────────────────────────────────
function checkAlerts(stock) {
  alerts.filter(a => a.enabled && a.stockCode === stock.code).forEach(a => {
    const hyst = a.price * 0.005;
    if (a.condition === 'above' && stock.price >= a.price && !a.triggered) {
      a.triggered = true; a.triggeredAt = Date.now(); save(ALERTS_FILE, alerts);
      wss.clients.forEach(c => {
        if (c.readyState===1) c.send(JSON.stringify({ type:'alert', stock, alert:a }));
      });
    }
    if (a.condition === 'below' && stock.price <= a.price && !a.triggered) {
      a.triggered = true; a.triggeredAt = Date.now(); save(ALERTS_FILE, alerts);
      wss.clients.forEach(c => {
        if (c.readyState===1) c.send(JSON.stringify({ type:'alert', stock, alert:a }));
      });
    }
    if (a.condition === 'above' && stock.price < a.price - hyst && a.triggered) { a.triggered = false; save(ALERTS_FILE, alerts); }
    if (a.condition === 'below' && stock.price > a.price + hyst && a.triggered) { a.triggered = false; save(ALERTS_FILE, alerts); }
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  System monitor
// ════════════════════════════════════════════════════════════════════════════
const os = require('os');
let lastCPU = { idle:0, total:0 };
function sysInfo() {
  const cpus = os.cpus();
  let idle=0, total=0;
  cpus.forEach(c => {
    const t = Object.values(c.times).reduce((a,b)=>a+b,0);
    idle += c.times.idle; total += t;
  });
  const cpu = lastCPU.total ? +((1-(idle-lastCPU.idle)/(total-lastCPU.total))*100).toFixed(1) : 0;
  lastCPU = { idle, total };
  const tmem = os.totalmem(), fmem = os.freemem();
  return { cpuPercent:cpu, memoryUsedPercent:+((1-fmem/tmem)*100).toFixed(1), memoryTotalGB:+(tmem/1e9).toFixed(1), memoryFreeGB:+(fmem/1e9).toFixed(1) };
}

// ════════════════════════════════════════════════════════════════════════════
//  HTTP + WebSocket
// ════════════════════════════════════════════════════════════════════════════

const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'application/javascript', '.json':'application/json', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.png':'image/png' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/state') {
    return json(res, { stocks, alerts, prefs, system:sysInfo(), timestamp:Date.now() });
  }
  if (url.pathname === '/api/add-stock') {
    const s = Object.fromEntries(url.searchParams);
    if (!s.code || stocks.find(x=>x.code===s.code)) return json(res, {ok:false});
    s.id = s.id || `${s.market}_${s.code}`; s.enabled = true; s.sort = stocks.length;
    stocks.push(s); save(STOCKS_FILE, stocks);
    return json(res, {ok:true});
  }
  if (url.pathname === '/api/remove-stock') {
    const id = url.searchParams.get('id');
    stocks = stocks.filter(s => s.id !== id); save(STOCKS_FILE, stocks);
    return json(res, {ok:true});
  }
  if (url.pathname === '/api/update-stock') {
    const { id, field, value } = Object.fromEntries(url.searchParams);
    const s = stocks.find(s => s.id === id);
    if (s) { s[field] = value === 'true' ? true : value === 'false' ? false : isNaN(value) ? value : parseFloat(value); save(STOCKS_FILE, stocks); }
    return json(res, {ok:true});
  }
  if (url.pathname === '/api/add-alert') {
    const a = Object.fromEntries(url.searchParams);
    a.id = 'a_'+Date.now(); a.price = parseFloat(a.price); a.triggered = false; a.enabled = true;
    alerts.push(a); save(ALERTS_FILE, alerts);
    return json(res, {ok:true});
  }
  if (url.pathname === '/api/remove-alert') {
    alerts = alerts.filter(a => a.id !== url.searchParams.get('id')); save(ALERTS_FILE, alerts);
    return json(res, {ok:true});
  }
  if (url.pathname === '/api/sys') {
    return json(res, sysInfo());
  }

  // Static files
  let fp = url.pathname === '/' ? '/index.html' : url.pathname;
  fp = path.join(__dirname, fp);
  const ext = path.extname(fp);
  if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    return res.end(fs.readFileSync(fp));
  }
  res.writeHead(404); res.end('Not Found');
});

function json(res, obj) {
  res.writeHead(200, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
  res.end(JSON.stringify(obj));
}

const wss = new WebSocketServer({ server });
let updateBuffer = [];

wss.on('connection', ws => {
  console.log(`[fin] client + (${wss.clients.size})`);
  ws.send(JSON.stringify({ type:'full', stocks, alerts, prefs, system:sysInfo(), timestamp:Date.now() }));
  ws.on('close', () => console.log(`[fin] client - (${wss.clients.size})`));
});

function broadcast(data) { wss.clients.forEach(c => { if (c.readyState===1) c.send(JSON.stringify(data)); }); }

// ════════════════════════════════════════════════════════════════════════════
//  Start
// ════════════════════════════════════════════════════════════════════════════

setInterval(poll, POLL_MS);
setInterval(() => broadcast({ type:'system', data:sysInfo() }), 5000);

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║     📈 Financial Monitor                      ║');
  console.log(`  ║     http://localhost:${PORT}                        ║`);
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');

  if (process.argv.includes('--open') || process.argv.includes('-o')) {
    openWindow();
  }
});

function openWindow() {
  const { execSync } = require('child_process');
  const url = `http://localhost:${PORT}`;
  // Try Edge --app mode first (Windows 10+ built-in), fallback to default browser
  try {
    execSync(`start msedge --app="${url}" --window-size=880,560`, { shell:'cmd.exe', windowsHide:true });
    console.log('  🌐 Opened in Edge App Mode');
  } catch {
    try { execSync(`start "" "${url}"`, { shell:'cmd.exe', windowsHide:true }); console.log('  🌐 Opened in browser'); }
    catch { console.log(`  🌐 Open: ${url}`); }
  }
}

// Auto-save periodically
setInterval(() => { save(STOCKS_FILE, stocks); save(ALERTS_FILE, alerts); save(PREFS_FILE, prefs); }, 30000);
