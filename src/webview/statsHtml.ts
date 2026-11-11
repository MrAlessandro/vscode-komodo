/** HTML of the server stats webview. Self-contained (no external resources), themed with VS Code CSS variables. */
export function statsHtml(cspSource: string, nonce: string): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Komodo Stats</title>
<style>
  :root {
    --ok: var(--vscode-charts-green, #4caf50);
    --warn: var(--vscode-charts-yellow, #e2b93d);
    --crit: var(--vscode-charts-red, #f14c4c);
    --info: var(--vscode-charts-blue, #3794ff);
    --muted: var(--vscode-descriptionForeground, #8b8b8b);
    --border: var(--vscode-panel-border, rgba(128,128,128,.35));
    --card: var(--vscode-sideBar-background, rgba(128,128,128,.06));
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 16px 20px 32px;
    font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    color: var(--vscode-foreground); background: var(--vscode-editor-background);
  }
  header { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: flex-start; justify-content: space-between; margin-bottom: 16px; }
  h1 { font-size: 1.45em; font-weight: 600; margin: 0 0 4px; display: flex; align-items: center; gap: 10px; }
  .meta { color: var(--muted); line-height: 1.5; }
  .badge { font-size: .62em; font-weight: 600; padding: 2px 8px; border-radius: 10px; letter-spacing: .02em; border: 1px solid currentColor; }
  .badge.ok { color: var(--ok); } .badge.warn { color: var(--warn); } .badge.crit { color: var(--crit); } .badge.muted { color: var(--muted); }
  .actions { display: flex; gap: 6px; align-items: center; }
  button {
    font: inherit; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground);
    border: 1px solid var(--vscode-button-border, transparent); padding: 4px 10px; border-radius: 2px; cursor: pointer;
  }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  .updated { color: var(--muted); font-size: .9em; margin-right: 4px; }
  .errors { color: var(--vscode-errorForeground); margin: 0 0 12px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 6px; padding: 12px 14px; min-height: 96px; }
  .card h2 { margin: 0 0 6px; font-size: .78em; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
  .big { font-size: 1.8em; font-weight: 600; font-variant-numeric: tabular-nums; }
  .big small { font-size: .5em; font-weight: 400; color: var(--muted); margin-left: 4px; }
  .bar { height: 6px; border-radius: 3px; background: rgba(128,128,128,.22); overflow: hidden; margin: 8px 0 6px; }
  .bar > span { display: block; height: 100%; border-radius: 3px; background: var(--ok); transition: width .4s ease; }
  .bar.warn > span { background: var(--warn); } .bar.crit > span { background: var(--crit); }
  .sub { color: var(--muted); font-size: .92em; line-height: 1.45; font-variant-numeric: tabular-nums; }
  .disks { margin-top: 4px; }
  .disk { display: grid; grid-template-columns: minmax(60px, 1fr) 70px 42px; gap: 6px; align-items: center; font-size: .9em; color: var(--muted); }
  .disk .bar { margin: 0; height: 4px; }
  section { margin-bottom: 24px; }
  .section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
  .section-head h3 { margin: 0; font-size: 1em; font-weight: 600; }
  .seg { display: inline-flex; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; }
  .seg button { border: 0; border-radius: 0; background: transparent; color: var(--vscode-foreground); padding: 3px 10px; }
  .seg button + button { border-left: 1px solid var(--border); }
  .seg button.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .legend { display: flex; gap: 14px; color: var(--muted); font-size: .9em; margin: 2px 0 4px; }
  .sw { display: inline-block; width: 10px; height: 3px; border-radius: 2px; margin-right: 5px; vertical-align: middle; }
  .chart { position: relative; width: 100%; height: 170px; margin-bottom: 10px; }
  .chart.small { height: 130px; }
  .chart svg { display: block; overflow: visible; }
  .chart .grid { stroke: rgba(128,128,128,.18); stroke-width: 1; }
  .chart .axis { fill: var(--muted); font-size: 10px; font-family: var(--vscode-font-family); }
  .chart .cursor { stroke: var(--muted); stroke-dasharray: 3 3; }
  .chart .empty, .empty { color: var(--muted); padding: 24px 0; text-align: center; }
  .tip {
    position: absolute; pointer-events: none; z-index: 2; min-width: 140px;
    background: var(--vscode-editorHoverWidget-background); color: var(--vscode-editorHoverWidget-foreground);
    border: 1px solid var(--vscode-editorHoverWidget-border); border-radius: 3px; padding: 6px 8px; font-size: .88em; line-height: 1.5;
    font-variant-numeric: tabular-nums;
  }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { font-size: .78em; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); font-weight: 600; cursor: pointer; user-select: none; white-space: nowrap; position: sticky; top: 0; background: var(--vscode-editor-background); }
  th.sorted::after { content: attr(data-dir); margin-left: 4px; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  tr:hover td { background: var(--vscode-list-hoverBackground); }
  td .sub { font-size: .85em; }
  a.link { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: none; font-weight: 500; }
  a.link:hover { text-decoration: underline; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 7px; background: var(--muted); vertical-align: 1px; }
  .dot.running { background: var(--ok); } .dot.unhealthy, .dot.restarting, .dot.paused { background: var(--warn); }
  .dot.dead, .dot.failed { background: var(--crit); } .dot.created { background: var(--info); }
  .status { color: var(--muted); white-space: nowrap; }
  .hidden { display: none !important; }
</style>
</head>
<body>
  <header>
    <div>
      <h1><span id="title">Loading…</span><span id="state" class="badge muted"></span></h1>
      <div class="meta" id="meta"></div>
    </div>
    <div class="actions">
      <span class="updated" id="updated"></span>
      <button data-act="refresh" title="Refresh now">Refresh</button>
      <button class="primary" data-act="open" title="Open this server in the Komodo web UI">Open in Komodo</button>
    </div>
  </header>
  <div class="errors hidden" id="errors"></div>
  <div class="cards" id="cards"><div class="empty">Loading stats…</div></div>

  <section>
    <div class="section-head">
      <h3>History</h3>
      <div class="seg" id="ranges">
        <button data-act="range" data-range="1h">1h</button>
        <button data-act="range" data-range="6h">6h</button>
        <button data-act="range" data-range="24h">24h</button>
        <button data-act="range" data-range="7d">7d</button>
      </div>
    </div>
    <div class="legend"><span><span class="sw" style="background:var(--info)"></span>CPU</span><span><span class="sw" style="background:var(--vscode-charts-purple, #b180d7)"></span>Memory</span><span><span class="sw" style="background:var(--vscode-charts-orange, #d18616)"></span>Disk</span></div>
    <div class="chart" id="chart-usage"><div class="empty">Loading history…</div></div>
    <div class="legend"><span><span class="sw" style="background:var(--ok)"></span>Network in</span><span><span class="sw" style="background:var(--warn)"></span>Network out</span></div>
    <div class="chart small" id="chart-net"></div>
  </section>

  <section>
    <div class="section-head"><h3 id="containers-title">Containers</h3></div>
    <div id="containers"><div class="empty">Loading containers…</div></div>
  </section>

<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  const saved = vscode.getState() || {};
  const state = { range: saved.range || '6h', sort: saved.sort || { key: 'cpu', desc: true } };
  let data = null;
  let history = null;
  const DEFAULT_TH = { cpu_warning: 90, cpu_critical: 99, mem_warning: 75, mem_critical: 95, disk_warning: 75, disk_critical: 95 };
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const save = () => vscode.setState({ range: state.range, sort: state.sort });

  function pct(v) { return v == null || !isFinite(v) ? '–' : (v > 0 && v < 9.95 ? v.toFixed(1) : Math.round(v)) + '%'; }
  function gb(v) { if (v == null || !isFinite(v)) return '–'; if (v >= 1024) return (v / 1024).toFixed(1) + ' TB'; if (v >= 100) return Math.round(v) + ' GB'; if (v >= 1) return v.toFixed(1) + ' GB'; return Math.round(v * 1024) + ' MB'; }
  function bytes(v) { if (v == null || !isFinite(v)) return '–'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; } return i === 0 ? Math.round(v) + ' B' : v.toFixed(v >= 100 ? 0 : 1) + ' ' + u[i]; }
  function level(v, w, c) { return v == null ? '' : v >= c ? 'crit' : v >= w ? 'warn' : ''; }
  function time(ts, span) { const d = new Date(ts); const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); return span > 36 * 3600e3 ? d.toLocaleDateString([], { day: '2-digit', month: 'short' }) + ' ' + hm : hm; }
  function full(ts) { return new Date(ts).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }); }

  function card(title, big, barValue, barLevel, sub) {
    return '<div class="card"><h2>' + esc(title) + '</h2><div class="big">' + big + '</div>' +
      (barValue == null ? '' : '<div class="bar ' + barLevel + '"><span style="width:' + Math.max(0, Math.min(100, barValue)).toFixed(1) + '%"></span></div>') +
      '<div class="sub">' + sub + '</div></div>';
  }

  function renderHeader() {
    const s = data.server, info = data.info || {};
    $('#title').textContent = s.name;
    const st = $('#state');
    st.textContent = s.state === 'Ok' ? 'OK' : s.state === 'NotOk' ? 'UNREACHABLE' : String(s.state).toUpperCase();
    st.className = 'badge ' + (s.state === 'Ok' ? 'ok' : s.state === 'NotOk' ? 'crit' : 'muted');
    const cores = info.logical_core_count ? info.logical_core_count + ' vCPU' : '';
    const meta = [info.os, info.kernel && 'kernel ' + info.kernel, [cores, info.cpu_brand].filter(Boolean).join(' · '), info.cpu_arch,
      s.version && 'Periphery v' + s.version, s.region, s.tags && s.tags.length ? 'tags: ' + s.tags.join(', ') : ''].filter(Boolean);
    $('#meta').innerHTML = meta.map(esc).join(' · ');
    $('#updated').textContent = 'Updated ' + new Date(data.updatedAt).toLocaleTimeString() + ' · auto 15s';
    const errors = $('#errors');
    errors.classList.toggle('hidden', !data.errors.length);
    errors.innerHTML = data.errors.map((e) => '⚠ ' + esc(e)).join('<br>');
  }

  function renderCards() {
    const s = data.stats;
    if (!s) { $('#cards').innerHTML = '<div class="empty">No stats available (server unreachable?)</div>'; return; }
    const th = data.server.thresholds || DEFAULT_TH;
    const memP = s.mem_total_gb ? s.mem_used_gb / s.mem_total_gb * 100 : null;
    const disks = (s.disks || []).filter((d) => d.total_gb > 0.5);
    const dUsed = disks.reduce((a, d) => a + d.used_gb, 0), dTotal = disks.reduce((a, d) => a + d.total_gb, 0);
    const diskP = dTotal ? dUsed / dTotal * 100 : null;
    const la = s.load_average;
    const cpuSub = la ? 'load ' + la.one.toFixed(2) + ' · ' + la.five.toFixed(2) + ' · ' + la.fifteen.toFixed(2) : '';
    let memSub = gb(s.mem_used_gb) + ' / ' + gb(s.mem_total_gb);
    if (s.mem_buff_cache_gb) memSub += ' · cache ' + gb(s.mem_buff_cache_gb);
    if (s.swap_total_gb) memSub += '<br>swap ' + gb(s.swap_used_gb) + ' / ' + gb(s.swap_total_gb);
    const diskSub = gb(dUsed) + ' / ' + gb(dTotal) + '<div class="disks">' + disks.slice(0, 5).map((d) => {
      const p = d.used_gb / d.total_gb * 100;
      return '<div class="disk"><span title="' + esc(d.file_system || '') + '">' + esc(d.mount) + '</span><div class="bar ' + level(p, th.disk_warning, th.disk_critical) + '"><span style="width:' + p.toFixed(1) + '%"></span></div><span>' + pct(p) + '</span></div>';
    }).join('') + '</div>';
    $('#cards').innerHTML =
      card('CPU', pct(s.cpu_perc), s.cpu_perc, level(s.cpu_perc, th.cpu_warning, th.cpu_critical), cpuSub) +
      card('Memory', pct(memP), memP, level(memP, th.mem_warning, th.mem_critical), memSub) +
      card('Disk', pct(diskP), diskP, level(diskP, th.disk_warning, th.disk_critical), diskSub) +
      card('Network', '↓ ' + bytes(s.network_ingress_bytes) + '<small>/s</small>', null, '', '↑ ' + bytes(s.network_egress_bytes) + '/s');
  }

  function nearest(values, ts) {
    let lo = 0, hi = values.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (values[mid][0] < ts) lo = mid; else hi = mid; }
    return Math.abs(values[lo][0] - ts) <= Math.abs(values[hi][0] - ts) ? lo : hi;
  }

  function niceMax(v) {
    if (!(v > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }

  function chart(el, series, opts) {
    const values = series[0] && series[0].values;
    if (!values || values.length < 2) { el.innerHTML = '<div class="empty">No history for this range</div>'; return; }
    const W = Math.max(280, el.clientWidth), H = el.clientHeight || 160;
    const pad = { l: 52, r: 12, t: 8, b: 22 };
    const x0 = values[0][0], x1 = values[values.length - 1][0];
    const yMax = opts.yMax || niceMax(Math.max.apply(null, series.flatMap((s) => s.values.map((v) => v[1]))) * 1.1);
    const sx = (t) => pad.l + (t - x0) / ((x1 - x0) || 1) * (W - pad.l - pad.r);
    const sy = (v) => pad.t + (1 - Math.min(v, yMax) / yMax) * (H - pad.t - pad.b);
    let svg = '<svg width="' + W + '" height="' + H + '">';
    for (let i = 0; i <= 4; i++) {
      const v = yMax * i / 4, y = sy(v).toFixed(1);
      svg += '<line class="grid" x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + y + '" y2="' + y + '"/>' +
        '<text class="axis" x="' + (pad.l - 6) + '" y="' + (Number(y) + 3) + '" text-anchor="end">' + esc(opts.format(v)) + '</text>';
    }
    for (let i = 0; i <= 4; i++) {
      const t = x0 + (x1 - x0) * i / 4;
      svg += '<text class="axis" x="' + sx(t).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="' + (i === 0 ? 'start' : i === 4 ? 'end' : 'middle') + '">' + esc(time(t, x1 - x0)) + '</text>';
    }
    for (const s of series) {
      const pts = s.values.map((v) => sx(v[0]).toFixed(1) + ',' + sy(v[1]).toFixed(1)).join(' ');
      svg += '<polyline fill="none" style="stroke:' + s.color + '" stroke-width="1.6" stroke-linejoin="round" points="' + pts + '"/>';
    }
    svg += '<line class="cursor" y1="' + pad.t + '" y2="' + (H - pad.b) + '" x1="0" x2="0" style="display:none"/>';
    svg += '<rect class="overlay" x="' + pad.l + '" y="' + pad.t + '" width="' + (W - pad.l - pad.r) + '" height="' + (H - pad.t - pad.b) + '" fill="transparent"/></svg>';
    el.innerHTML = svg + '<div class="tip" style="display:none"></div>';
    const overlay = el.querySelector('.overlay'), cursor = el.querySelector('.cursor'), tip = el.querySelector('.tip');
    overlay.addEventListener('mousemove', (ev) => {
      const rect = el.getBoundingClientRect();
      const t = x0 + (ev.clientX - rect.left - pad.l) / (W - pad.l - pad.r) * (x1 - x0);
      const i = nearest(values, t);
      const cx = sx(values[i][0]);
      cursor.setAttribute('x1', cx); cursor.setAttribute('x2', cx); cursor.style.display = '';
      tip.innerHTML = '<b>' + esc(full(values[i][0])) + '</b>' + series.map((s) => '<div><span class="sw" style="background:' + s.color + '"></span>' + esc(s.name) + ': ' + esc(opts.format(s.values[i] ? s.values[i][1] : 0)) + '</div>').join('');
      tip.style.display = '';
      tip.style.left = Math.min(cx + 10, W - 170) + 'px';
      tip.style.top = (pad.t + 4) + 'px';
    });
    overlay.addEventListener('mouseleave', () => { cursor.style.display = 'none'; tip.style.display = 'none'; });
  }

  function renderHistory() {
    for (const b of document.querySelectorAll('#ranges button')) b.classList.toggle('active', b.dataset.range === state.range);
    if (!history) return;
    const p = history.points;
    chart($('#chart-usage'), [
      { name: 'CPU', color: 'var(--info)', values: p.map((x) => [x.ts, x.cpu]) },
      { name: 'Memory', color: 'var(--vscode-charts-purple, #b180d7)', values: p.map((x) => [x.ts, x.mem]) },
      { name: 'Disk', color: 'var(--vscode-charts-orange, #d18616)', values: p.map((x) => [x.ts, x.disk]) },
    ], { yMax: 100, format: (v) => Math.round(v) + '%' });
    chart($('#chart-net'), [
      { name: 'In', color: 'var(--ok)', values: p.map((x) => [x.ts, x.rx]) },
      { name: 'Out', color: 'var(--warn)', values: p.map((x) => [x.ts, x.tx]) },
    ], { format: (v) => bytes(v) + '/s' });
  }

  const COLUMNS = [
    { key: 'name', label: 'Container' },
    { key: 'status', label: 'Status' },
    { key: 'cpu', label: 'CPU', num: true },
    { key: 'mem', label: 'Memory', num: true },
    { key: 'net', label: 'Net I/O', num: true },
    { key: 'block', label: 'Block I/O', num: true },
    { key: 'pids', label: 'PIDs', num: true },
  ];

  function dotClass(c) {
    if (c.state === 'running') return /\\(unhealthy\\)/.test(c.status || '') ? 'unhealthy' : 'running';
    if (c.state === 'exited') { const m = /^Exited \\((-?\\d+)\\)/.exec(c.status || ''); return m && m[1] !== '0' ? 'failed' : 'exited'; }
    return c.state;
  }

  function sortValue(c, key) {
    switch (key) {
      case 'cpu': return c.cpu == null ? -1 : c.cpu;
      case 'mem': return c.memPerc == null ? -1 : c.memPerc;
      case 'pids': return Number(c.pids) || 0;
      case 'status': return c.state + (c.status || '');
      default: return String(c[key] || '').toLowerCase();
    }
  }

  function renderContainers() {
    const list = (data.containers || []).slice();
    const running = list.filter((c) => c.state === 'running').length;
    $('#containers-title').textContent = 'Containers (' + running + '/' + list.length + ' running)';
    if (!data.containers) { $('#containers').innerHTML = '<div class="empty">Containers unavailable</div>'; return; }
    if (!list.length) { $('#containers').innerHTML = '<div class="empty">No containers on this server</div>'; return; }
    const { key, desc } = state.sort;
    list.sort((a, b) => { const va = sortValue(a, key), vb = sortValue(b, key); return (va < vb ? -1 : va > vb ? 1 : 0) * (desc ? -1 : 1); });
    let html = '<table><thead><tr>' + COLUMNS.map((c) =>
      '<th data-act="sort" data-key="' + c.key + '" class="' + (c.num ? 'num ' : '') + (c.key === key ? 'sorted' : '') + '" data-dir="' + (desc ? '↓' : '↑') + '">' + c.label + '</th>').join('') + '</tr></thead><tbody>';
    for (const c of list) {
      html += '<tr><td><span class="dot ' + esc(dotClass(c)) + '"></span><a class="link" data-act="logs" data-name="' + esc(c.name) + '" title="Show logs">' + esc(c.name) + '</a>' +
        '<div class="sub">' + esc(c.owner ? 'stack ' + c.owner : (c.image || '')) + '</div></td>' +
        '<td class="status">' + esc(c.status || c.state) + '</td>' +
        '<td class="num">' + esc(c.cpuText) + '</td>' +
        '<td class="num">' + esc(c.memText) + (c.memPerc != null ? '<div class="sub">' + esc(c.memPerc.toFixed(1)) + '%</div>' : '') + '</td>' +
        '<td class="num">' + esc(c.net) + '</td><td class="num">' + esc(c.block) + '</td><td class="num">' + esc(c.pids) + '</td></tr>';
    }
    $('#containers').innerHTML = html + '</tbody></table>';
  }

  function render() {
    if (!data) return;
    renderHeader();
    renderCards();
    renderHistory();
    renderContainers();
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg && msg.type === 'data') {
      data = msg.payload;
      if (msg.payload.history && msg.payload.history.range === state.range) history = msg.payload.history;
      render();
    }
  });

  document.addEventListener('click', (event) => {
    const el = event.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (act === 'range') {
      state.range = el.dataset.range; save(); history = null;
      $('#chart-usage').innerHTML = '<div class="empty">Loading history…</div>'; $('#chart-net').innerHTML = '';
      renderHistory();
      vscode.postMessage({ type: 'range', range: state.range });
    } else if (act === 'refresh') {
      vscode.postMessage({ type: 'refresh' });
    } else if (act === 'open') {
      vscode.postMessage({ type: 'open' });
    } else if (act === 'logs') {
      vscode.postMessage({ type: 'logs', container: el.dataset.name });
    } else if (act === 'sort') {
      const key = el.dataset.key;
      state.sort = { key, desc: state.sort.key === key ? !state.sort.desc : key !== 'name' };
      save(); if (data) renderContainers();
    }
  });

  let resizeTimer;
  new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderHistory, 120); }).observe(document.body);
  renderHistory();
  vscode.postMessage({ type: 'range', range: state.range });
})();
</script>
</body>
</html>`;
}
