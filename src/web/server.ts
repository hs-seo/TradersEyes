/**
 * 라이브 트레이딩 웹 대시보드 (내장 http, 포트 3000)
 */
import http from "http";
import { loadState } from "../live/state-store";
import { SYMBOL_CONFIGS } from "../config";
import type { SymbolConfig } from "../config";

// 심볼 설정은 런타임 변경을 위해 참조를 공유
export { SYMBOL_CONFIGS };

const HTML = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TradersEyes Dashboard</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>
  body { background: #0f172a; color: #e2e8f0; font-family: monospace; }
  .card { background: #1e293b; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .green { color: #4ade80; } .red { color: #f87171; } .gray { color: #94a3b8; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 6px 10px; text-align: left; border-bottom: 1px solid #334155; font-size: 13px; }
  th { color: #94a3b8; font-weight: 600; }
  .badge-on  { background: #166534; color: #86efac; padding: 2px 8px; border-radius: 9999px; font-size: 11px; }
  .badge-off { background: #3f3f46; color: #a1a1aa; padding: 2px 8px; border-radius: 9999px; font-size: 11px; }
  .badge-open { background: #1e3a5f; color: #60a5fa; padding: 2px 6px; border-radius: 4px; font-size: 11px; }
</style>
</head>
<body>
<div class="max-w-5xl mx-auto p-6">
  <div class="flex items-center justify-between mb-6">
    <h1 class="text-2xl font-bold text-white">TradersEyes <span class="text-blue-400">Live</span></h1>
    <span id="updated" class="text-xs gray">--</span>
  </div>

  <!-- 심볼 설정 -->
  <div class="card">
    <h2 class="text-sm font-semibold text-slate-400 mb-3">심볼 설정</h2>
    <table>
      <thead><tr><th>심볼</th><th>전략</th><th>리스크</th><th>레버리지</th><th>상태</th><th>토글</th></tr></thead>
      <tbody id="configs"></tbody>
    </table>
  </div>

  <!-- 열린 포지션 -->
  <div class="card">
    <h2 class="text-sm font-semibold text-slate-400 mb-3">열린 포지션</h2>
    <table>
      <thead><tr><th>심볼</th><th>방향</th><th>진입가</th><th>SL</th><th>TP1</th><th>TP2</th><th>상태</th><th>진입시각</th></tr></thead>
      <tbody id="positions"></tbody>
    </table>
  </div>

  <!-- 최근 거래 -->
  <div class="card">
    <h2 class="text-sm font-semibold text-slate-400 mb-3">최근 거래 (최근 20건)</h2>
    <table>
      <thead><tr><th>심볼</th><th>방향</th><th>진입가</th><th>청산가</th><th>사유</th><th>PnL(R)</th><th>PnL($)</th><th>청산시각</th></tr></thead>
      <tbody id="trades"></tbody>
    </table>
  </div>
</div>

<script>
const fmt = (n) => n?.toFixed(2) ?? '--';
const ts = (ms) => ms ? new Date(ms).toLocaleString('ko-KR') : '--';
const dir = (d) => d === 'bullish' ? '<span class="green">LONG</span>' : '<span class="red">SHORT</span>';
const pnlStyle = (v) => v >= 0 ? 'green' : 'red';
const sign = (v) => v >= 0 ? '+' : '';

async function load() {
  const res = await fetch('/api/state').then(r => r.json());
  const cfgs = res.configs;
  const state = res.state;

  document.getElementById('updated').textContent = '갱신: ' + ts(state.updatedAt);

  // configs
  document.getElementById('configs').innerHTML = cfgs.map(c => \`<tr>
    <td class="font-semibold">\${c.symbol}</td>
    <td>\${c.strategy}</td>
    <td>\${c.riskPct}%</td>
    <td>\${c.leverage}x</td>
    <td><span class="\${c.enabled ? 'badge-on' : 'badge-off'}">\${c.enabled ? 'ON' : 'OFF'}</span></td>
    <td><button onclick="toggle('\${c.symbol}',\${!c.enabled})" class="text-xs px-2 py-1 rounded \${c.enabled ? 'bg-red-900 text-red-300' : 'bg-green-900 text-green-300'}">\${c.enabled ? '비활성화' : '활성화'}</button></td>
  </tr>\`).join('');

  // positions
  const opens = state.positions.filter(p => p.status === 'open');
  document.getElementById('positions').innerHTML = opens.length === 0
    ? '<tr><td colspan="8" class="gray text-center py-4">열린 포지션 없음</td></tr>'
    : opens.map(p => \`<tr>
    <td class="font-semibold">\${p.symbol}</td>
    <td>\${dir(p.direction)}</td>
    <td>$\${fmt(p.entryPrice)}</td>
    <td class="red">$\${fmt(p.stop)}</td>
    <td class="green">$\${fmt(p.tp1)}</td>
    <td class="green">$\${fmt(p.tp2)}</td>
    <td>\${p.tp1Hit ? '<span class="badge-open">TP1 도달</span>' : '<span class="badge-open">진행중</span>'}</td>
    <td class="gray text-xs">\${ts(p.openedAt)}</td>
  </tr>\`).join('');

  // trades
  const trades = [...state.trades].reverse().slice(0, 20);
  document.getElementById('trades').innerHTML = trades.length === 0
    ? '<tr><td colspan="8" class="gray text-center py-4">거래 내역 없음</td></tr>'
    : trades.map(t => \`<tr>
    <td class="font-semibold">\${t.symbol}</td>
    <td>\${dir(t.direction)}</td>
    <td>$\${fmt(t.entryPrice)}</td>
    <td>$\${fmt(t.exitPrice)}</td>
    <td class="gray">\${t.exitReason}</td>
    <td class="\${pnlStyle(t.pnlR)}">\${sign(t.pnlR)}\${fmt(t.pnlR)}R</td>
    <td class="\${pnlStyle(t.pnlUsdt)}">\${sign(t.pnlUsdt)}$\${fmt(Math.abs(t.pnlUsdt))}</td>
    <td class="gray text-xs">\${ts(t.closedAt)}</td>
  </tr>\`).join('');
}

async function toggle(symbol, enabled) {
  await fetch('/api/toggle', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({symbol, enabled}) });
  await load();
}

load();
setInterval(load, 30_000);
</script>
</body>
</html>`;

export function startWebServer(port = 3000): void {
  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";

    if (url === "/" || url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(HTML);
      return;
    }

    if (url === "/api/state") {
      const state = loadState();
      const body = JSON.stringify({ state, configs: SYMBOL_CONFIGS });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
      return;
    }

    if (url === "/api/toggle" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const { symbol, enabled } = JSON.parse(body) as { symbol: string; enabled: boolean };
          const cfg = SYMBOL_CONFIGS.find(c => c.symbol === symbol);
          if (cfg) cfg.enabled = enabled;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          console.log(`[Web] ${symbol} → ${enabled ? "ON" : "OFF"}`);
        } catch {
          res.writeHead(400);
          res.end("Bad Request");
        }
      });
      return;
    }

    res.writeHead(404);
    res.end("Not Found");
  });

  server.listen(port, () => {
    console.log(`[Web] 대시보드: http://localhost:${port}`);
  });
}
