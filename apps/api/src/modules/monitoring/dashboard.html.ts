/**
 * The system dashboard: one self-contained page (no external scripts, fonts or images). The page itself carries no data; it asks for an
 * administrator access token, keeps it in sessionStorage (cleared when the tab closes) and reads `/monitoring/overview` with it every
 * 10 seconds. Everything shown is inserted as text, never as HTML.
 */
export const DASHBOARD_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>System dashboard</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--fg:#14181f;--mut:#667085;--line:#e4e7ec;--ok:#12805c;--warn:#b25e09;--bad:#c0262d;--acc:#2457d6}
@media (prefers-color-scheme:dark){:root{--bg:#0e1116;--card:#171b22;--fg:#e8eaee;--mut:#9aa3b2;--line:#2a303a;--ok:#4cc38a;--warn:#f0a43a;--bad:#ff6b6b;--acc:#7aa2ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--line);background:var(--card)}
h1{font-size:17px;margin:0}h2{font-size:13px;margin:0 0 8px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut)}
main{padding:16px;display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));max-width:1400px;margin:0 auto}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;min-width:0}.wide{grid-column:1/-1}
.pill{display:inline-block;padding:2px 10px;border-radius:99px;font-weight:600;font-size:12px;border:1px solid currentColor}
.OK,.ok{color:var(--ok)}.DEGRADED,.warning{color:var(--warn)}.CRITICAL,.DOWN,.critical{color:var(--bad)}.info{color:var(--acc)}
.kv{display:flex;justify-content:space-between;gap:12px;padding:3px 0;border-bottom:1px dashed var(--line)}.kv:last-child{border:0}.kv span:first-child{color:var(--mut)}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;padding:4px 6px;border-bottom:1px solid var(--line);overflow-wrap:anywhere}th{color:var(--mut);font-weight:500}
input,button{font:inherit;padding:6px 10px;border-radius:7px;border:1px solid var(--line);background:var(--card);color:var(--fg)}button{cursor:pointer;background:var(--acc);color:#fff;border-color:var(--acc)}
#login{max-width:520px;margin:60px auto;padding:0 16px}.muted{color:var(--mut)}.alert{padding:6px 0;border-bottom:1px solid var(--line)}
</style></head><body>
<header><h1>System dashboard</h1><div><span id="status" class="pill muted">…</span> <span id="when" class="muted"></span> <button id="out" hidden>Sign out</button></div></header>
<div id="login" hidden><div class="card"><h2>Administrator access</h2><p class="muted">Paste an administrator access token. It is kept only for this browser tab.</p>
<input id="tok" type="password" placeholder="Access token" style="width:100%;margin-bottom:8px" autocomplete="off"><button id="go">Open dashboard</button> <span id="err" class="CRITICAL"></span></div></div>
<main id="main" hidden></main>
<script>
(function(){
var base=location.pathname.replace(/\\/dashboard\\/?$/,''),K='orion-monitoring-token',tok=sessionStorage.getItem(K)||'',timer=null;
function $(i){return document.getElementById(i)}
function el(t,txt,cls){var e=document.createElement(t);if(txt!==undefined&&txt!==null)e.textContent=String(txt);if(cls)e.className=cls;return e}
function kv(box,k,v){var r=el('div',null,'kv');r.appendChild(el('span',k));r.appendChild(el('span',v===null||v===undefined?'n/a':v));box.appendChild(r)}
function card(title,wide){var c=el('div',null,'card'+(wide?' wide':''));c.appendChild(el('h2',title));return c}
function pct(x){return x===null||x===undefined?'n/a':(Math.round(x*1000)/10)+'%'}
function ms(x){return x===null||x===undefined?'n/a':x+' ms'}
function table(head,rows){var t=el('table'),h=el('tr');head.forEach(function(x){h.appendChild(el('th',x))});t.appendChild(h);rows.forEach(function(r){var tr=el('tr');r.forEach(function(c){tr.appendChild(el('td',c))});t.appendChild(tr)});return t}
function show(login){$('login').hidden=!login;$('main').hidden=login;$('out').hidden=login}
function render(d){
 var s=$('status');s.textContent=d.status;s.className='pill '+d.status;$('when').textContent=new Date(d.generatedAt).toLocaleTimeString()+' · '+d.app.name+' '+d.app.version+' · '+d.app.environment;
 var m=$('main');m.textContent='';
 var a=card('Alerts',true);if(!d.alerts.length)a.appendChild(el('div','No active alerts.','ok'));d.alerts.forEach(function(x){var r=el('div',null,'alert');r.appendChild(el('strong',x.severity.toUpperCase()+' · '+x.title,x.severity));r.appendChild(el('div',x.detail,'muted'));a.appendChild(r)});m.appendChild(a);
 var h=card('HTTP');var w=d.http.last5m;kv(h,'Requests / s (5 min)',w.perSecond);kv(h,'In flight',d.http.inFlight);kv(h,'Server errors (5 min)',pct(w.errorRate5xx));kv(h,'Client errors (5 min)',pct(w.clientErrorRate4xx));kv(h,'Latency p50 / p95 / p99',ms(w.p50Ms)+' / '+ms(w.p95Ms)+' / '+ms(w.p99Ms));kv(h,'Requests (1 / 5 / 15 min)',d.http.last1m.requests+' / '+w.requests+' / '+d.http.last15m.requests);m.appendChild(h);
 var p=card('Process');kv(p,'Uptime',Math.round(d.app.uptimeSeconds/60)+' min');kv(p,'Heap',d.process.memory.heapUsedMb+' / '+d.process.memory.heapLimitMb+' MB');kv(p,'RSS',d.process.memory.rssMb+' MB');kv(p,'CPU',d.process.cpu.percent+'% of 1 core');kv(p,'Event loop delay p99',ms(d.process.eventLoop.p99Ms));kv(p,'Node',d.app.node);m.appendChild(p);
 var b=card('Database');var db=d.database;kv(b,'Reachable',db.reachable?'yes':'NO');kv(b,'Ping',ms(db.pingMs));kv(b,'Pool (in use / idle / waiting / max)',[db.pool.total-db.pool.idle,db.pool.idle,db.pool.waiting,db.pool.max].join(' / '));if(db.connections)kv(b,'Server connections',db.connections.total+' / '+db.connections.max);kv(b,'Size',db.sizeBytes==null?null:Math.round(db.sizeBytes/1048576)+' MB');kv(b,'Cache hit ratio',pct(db.cacheHitRatio));kv(b,'Locks waiting',db.locksWaiting);kv(b,'Longest query',db.connections&&db.connections.longestRunningQuerySeconds!=null?db.connections.longestRunningQuerySeconds+' s':null);if(db.migrations)kv(b,'Migrations applied',db.migrations.applied);if(db.note)b.appendChild(el('div',db.note,'muted'));m.appendChild(b);
 var sr=card('Search');var se=d.search;kv(sr,'Provider',se.provider);kv(sr,'Status',se.status);kv(sr,'Published businesses',se.publishedBusinesses);if(se.indexDrift)kv(sr,'Indexed vs published',se.indexDrift.indexed+' / '+se.indexDrift.databasePublished);if(se.version)kv(sr,'Version',se.version);if(se.resources){kv(sr,'Disk used',pct(se.resources.diskUsedRatio));kv(sr,'Memory used',pct(se.resources.memoryUsedRatio))}if(se.note)sr.appendChild(el('div',se.note,'muted'));m.appendChild(sr);
 var q=card('Queues',true);q.appendChild(table(['Queue','Status','Waiting','Active','Failed','Oldest waiting','Stuck','Done 1h','Failed 1h'],d.queues.queues.map(function(x){return [x.name,x.status,x.counts.WAITING,x.counts.ACTIVE,x.counts.FAILED,x.oldestWaitingSeconds==null?'-':x.oldestWaitingSeconds+' s',x.stuckActive,x.completedLastHour,x.failedLastHour]})));if(!d.queues.queues.length)q.appendChild(el('div','No jobs recorded yet.','muted'));
 if(d.queues.recentFailures.length){q.appendChild(el('h2','Recent failures'));q.appendChild(table(['When','Queue','Job','Attempts','Error'],d.queues.recentFailures.map(function(x){return [new Date(x.at).toLocaleString(),x.queue,x.job,x.attempts+'/'+x.maxAttempts,x.error]})))}m.appendChild(q);
 var r=card('Routes (last 15 min)',true);r.appendChild(table(['Route','Requests','5xx','avg','p95'],d.http.slowestRoutes.map(function(x){return [x.route,x.requests,x.errors5xx,ms(x.avgMs),ms(x.p95Ms)]})));m.appendChild(r);
 var e=card('Error tracking');var et=d.errorTracking;kv(e,'Reporting to',et.enabled?et.provider+' ('+et.host+')':'not configured (in-memory only)');kv(e,'Captured / sent / failed',et.captured+' / '+et.sent+' / '+et.failed);kv(e,'Environment',et.environment);kv(e,'Release',et.release);et.recent.forEach(function(x){var row=el('div',null,'alert');row.appendChild(el('div',x.type+': '+x.message));row.appendChild(el('div',x.at.replace('T',' ').slice(0,19)+' · '+x.source+(x.route?' · '+x.route:'')+' · x'+x.occurrences,'muted'));e.appendChild(row)});m.appendChild(e);
 var t=card('Tracing');var tr=d.tracing;kv(t,'Sample rate',tr.sampleRate);kv(t,'Exporter',tr.exporter+(tr.endpointHost?' → '+tr.endpointHost:''));kv(t,'Spans buffered',tr.bufferedSpans);kv(t,'Exported / failed',tr.exported+' / '+tr.exportFailures);m.appendChild(t);
}
function load(){
 fetch(base+'/monitoring/overview',{headers:{authorization:'Bearer '+tok}}).then(function(r){if(r.status===401||r.status===403){throw new Error('auth')}return r.json()}).then(function(j){show(false);render(j.data||j)}).catch(function(e){if(e.message==='auth'){sessionStorage.removeItem(K);tok='';show(true);$('err').textContent='That token was not accepted.';clearInterval(timer)}else{$('when').textContent='Could not reach the API'}})
}
function start(){show(false);load();clearInterval(timer);timer=setInterval(load,10000)}
$('go').onclick=function(){tok=$('tok').value.trim();if(!tok)return;sessionStorage.setItem(K,tok);$('err').textContent='';start()};
$('out').onclick=function(){sessionStorage.removeItem(K);tok='';clearInterval(timer);show(true)};
if(tok)start();else show(true);
})();
</script></body></html>`;
