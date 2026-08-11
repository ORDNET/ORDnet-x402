/**
 * ORDnet x402 Console v1 (F2) — the human-facing dashboard.
 *
 * GET  /console                    — dashboard UI (single-file HTML)
 * GET  /console/api/summary        — totals + daily + per-resource
 * GET  /console/api/settlements    — recent settlements (?limit=&offset=)
 * GET  /console/api/settlement/:id — invoice detail
 *
 * All /console/api/* routes require "Authorization: Bearer <X402_ADMIN_TOKEN>".
 * The UI asks for the token once and keeps it in memory only (no storage).
 */
import { Router, Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { listSettlements, settlementDetail, dailyTotals, perResourceTotals, stats } from './store.js';

export function consoleRouter(): Router {
  const r = Router();
  const adminToken = process.env.X402_ADMIN_TOKEN || '';

  const auth = (req: Request, res: Response, next: NextFunction) => {
    if (!adminToken || adminToken.length < 16) {
      res.status(503).json({ error: 'Console disabled: set X402_ADMIN_TOKEN (min. 16 chars) on the server.' });
      return;
    }
    const h = req.headers.authorization || '';
    const t = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (t.length !== adminToken.length || !timingSafeEqual(Buffer.from(t), Buffer.from(adminToken))) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  };

  r.get('/console/api/summary', auth, (_req, res) => {
    res.json({ stats: stats(), daily: dailyTotals(14), perResource: perResourceTotals() });
  });

  r.get('/console/api/settlements', auth, (req, res) => {
    const limit = parseInt(String(req.query.limit ?? '50'), 10) || 50;
    const offset = parseInt(String(req.query.offset ?? '0'), 10) || 0;
    res.json({ settlements: listSettlements(limit, offset) });
  });

  r.get('/console/api/settlement/:id', auth, (req, res) => {
    const d = settlementDetail(req.params.id);
    if (!d) { res.status(404).json({ error: 'not found' }); return; }
    res.json(d);
  });

  r.get('/console', (_req, res) => {
    res.type('html').send(CONSOLE_HTML);
  });

  return r;
}

const CONSOLE_HTML = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ORD/x402 Console</title>
<link rel="icon" href="https://ord-rtr-bsv.com/740b05f528c6cfbbb9a9bd14087c811e73eb1869d777c4e09f0ded25a2b6cf5e_0">
<style>
:root{--bg:#0a0a0f;--card:rgba(255,255,255,0.04);--border:rgba(255,255,255,0.09);
--text:#fff;--muted:rgba(255,255,255,0.55);--beige:#d9d5cc;--beige-bright:#fcfaf5;--accent:#ff4444;--ok:#7ec87e}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Space Grotesk',-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100vh}
.wrap{max-width:1080px;margin:0 auto;padding:26px 22px 80px}
h1{font-size:1.5rem;display:flex;align-items:center;gap:10px}
h1 img{width:30px;height:30px;border-radius:6px}
h1 span{color:var(--accent)}
.sub{color:var(--muted);margin:6px 0 24px;font-size:0.9rem}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:26px}
.card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px}
.card .k{color:var(--muted);font-size:0.75rem;text-transform:uppercase;letter-spacing:1px}
.card .v{font-size:1.5rem;font-weight:700;margin-top:6px;color:var(--beige-bright)}
h2{font-size:1.05rem;margin:26px 0 10px;color:var(--beige)}
table{width:100%;border-collapse:collapse;font-size:0.86rem}
th{color:var(--muted);text-align:left;font-weight:500;padding:8px 10px;border-bottom:1px solid var(--border)}
td{padding:9px 10px;border-bottom:1px solid var(--border)}
tr.row:hover{background:var(--card);cursor:pointer}
.mono{font-family:ui-monospace,Menlo,monospace;font-size:0.8rem}
a{color:var(--beige)}a:hover{color:var(--beige-bright)}
.bar{display:flex;align-items:flex-end;gap:4px;height:70px;margin:6px 0 2px}
.bar div{background:var(--beige);opacity:0.85;width:100%;border-radius:3px 3px 0 0;min-height:2px}
.bar div:hover{background:var(--beige-bright)}
.gate{max-width:420px;margin:14vh auto;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:28px}
.gate input{width:100%;margin:14px 0;padding:11px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-family:inherit}
.gate button{width:100%;padding:11px;border-radius:8px;border:0;background:var(--beige);color:#0a0a0f;font-weight:700;cursor:pointer;font-family:inherit}
.gate button:hover{background:var(--beige-bright)}
.err{color:var(--accent);font-size:0.85rem;min-height:1.2em;margin-top:8px}
.detail{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:18px;margin-top:10px;display:none}
.detail dt{color:var(--muted);font-size:0.75rem;text-transform:uppercase;letter-spacing:1px;margin-top:10px}
.detail dd{margin:2px 0 0}
.muted{color:var(--muted)}
</style></head><body>
<div id="gate" class="wrap"><div class="gate">
  <h1><img src="https://ord-rtr-bsv.com/740b05f528c6cfbbb9a9bd14087c811e73eb1869d777c4e09f0ded25a2b6cf5e_0" alt="">ORD<span>/</span>x402 Console</h1>
  <p class="sub">Enter the admin token to open the dashboard. The token stays in memory only.</p>
  <input id="tok" type="password" placeholder="Admin token" autocomplete="off">
  <button onclick="login()">Open console</button>
  <div id="gateErr" class="err"></div>
</div></div>
<div id="app" class="wrap" style="display:none">
  <h1><img src="https://ord-rtr-bsv.com/740b05f528c6cfbbb9a9bd14087c811e73eb1869d777c4e09f0ded25a2b6cf5e_0" alt="">ORD<span>/</span>x402 Console</h1>
  <p class="sub">Live administration of the machine economy — every settlement, one click from its proof.</p>
  <div class="cards" id="cards"></div>
  <h2>Last 14 days</h2><div class="bar" id="chart"></div><div class="muted" id="chartLbl" style="font-size:0.75rem"></div>
  <h2>Revenue per endpoint</h2><table id="perres"><thead><tr><th>Resource</th><th>Calls</th><th>Sats</th></tr></thead><tbody></tbody></table>
  <h2>Recent settlements</h2>
  <table id="settle"><thead><tr><th>Time (UTC)</th><th>Resource</th><th>Sats</th><th>Invoice</th><th>Txid</th></tr></thead><tbody></tbody></table>
  <div class="detail" id="detail"></div>
</div>
<script>
let TOKEN = '';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path){
  const r = await fetch(path, { headers: { 'Authorization': 'Bearer ' + TOKEN } });
  if (!r.ok) throw new Error((await r.json().catch(()=>({}))).error || ('HTTP ' + r.status));
  return r.json();
}
async function login(){
  TOKEN = $('tok').value.trim();
  $('gateErr').textContent = '';
  try { await load(); $('gate').style.display='none'; $('app').style.display='block'; }
  catch(e){ $('gateErr').textContent = e.message; }
}
$('tok').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
function fmtTs(t){ return new Date(t*1000).toISOString().replace('T',' ').slice(0,16); }
function card(k,v){ return '<div class=\"card\"><div class=\"k\">'+esc(k)+'</div><div class=\"v\">'+esc(v)+'</div></div>'; }
async function load(){
  const sum = await api('/console/api/summary');
  const st = sum.stats;
  $('cards').innerHTML =
    card('Settlements', st.settlements) + card('Sats settled', st.satsSettled) +
    card('Invoices issued', st.invoices) + card('Avg sats / call', st.settlements ? Math.round(st.satsSettled/st.settlements) : 0);
  const daily = sum.daily, max = Math.max(1, ...daily.map(d=>d.sats||0));
  $('chart').innerHTML = daily.map(d=>'<div style="height:'+Math.max(3, 70*(d.sats||0)/max)+'px" title="'+esc(d.d)+': '+esc(d.sats)+' sats ('+esc(d.n)+' calls)"></div>').join('');
  $('chartLbl').textContent = daily.length ? (daily[0].d + ' → ' + daily[daily.length-1].d) : 'no settlements yet';
  $('perres').querySelector('tbody').innerHTML = sum.perResource.map(r =>
    '<tr><td class="mono">'+esc(r.resource||'?')+'</td><td>'+esc(r.n)+'</td><td>'+esc(r.sats)+'</td></tr>').join('') || '<tr><td colspan="3" class="muted">none yet</td></tr>';
  const s = await api('/console/api/settlements?limit=50');
  $('settle').querySelector('tbody').innerHTML = s.settlements.map(x =>
    '<tr class="row" onclick="showDetail(\\''+esc(x.invoice_id)+'\\')"><td>'+fmtTs(x.settled_at)+'</td><td class="mono">'+esc(x.resource||'?')+'</td><td>'+esc(x.satoshis)+'</td><td class="mono">'+esc(String(x.invoice_id).slice(0,8))+'…</td><td class="mono"><a href="https://whatsonchain.com/tx/'+esc(x.txid)+'" target="_blank" rel="noopener" onclick="event.stopPropagation()">'+esc(String(x.txid).slice(0,12))+'…</a></td></tr>').join('') || '<tr><td colspan="5" class="muted">no settlements yet</td></tr>';
}
async function showDetail(id){
  try{
    const d = await api('/console/api/settlement/' + encodeURIComponent(id));
    $('detail').style.display='block';
    $('detail').innerHTML = '<dl>'
      + '<dt>Invoice</dt><dd class="mono">'+esc(d.invoice_id)+'</dd>'
      + '<dt>Resource</dt><dd class="mono">'+esc(d.resource||'?')+'</dd>'
      + '<dt>Amount</dt><dd>'+esc(d.satoshis)+' sats</dd>'
      + '<dt>Pay-to (per-invoice)</dt><dd class="mono">'+esc(d.pay_to||'?')+'</dd>'
      + '<dt>Settled</dt><dd>'+fmtTs(d.settled_at)+' UTC</dd>'
      + '<dt>Txid — on-chain proof</dt><dd class="mono"><a href="https://whatsonchain.com/tx/'+esc(d.txid)+'" target="_blank" rel="noopener">'+esc(d.txid)+'</a></dd>'
      + '</dl>';
    $('detail').scrollIntoView({behavior:'smooth'});
  }catch(e){ $('detail').style.display='block'; $('detail').innerHTML = '<span class="err">'+esc(e.message)+'</span>'; }
}
</script></body></html>`;
