// Teste de regressão automático: carrega dados fictícios em volume, RECARREGA o app com eles (pega erro de ordem de
// carregamento) e roda os testes de tools/regressao-testes.js. Roteiro e motivo de cada teste: TESTES.md.
// Uso: node tools/regressao.js [saida.png]     (precisa de Node 22+ e Chrome; variável CHROME aponta o executável)
// Sai com código 1 se algum teste falhar. Não toca em dado real: usa um perfil temporário do Chrome, sem login.
const { spawn, spawnSync } = require('child_process'), fs = require('fs'), path = require('path'), http = require('http'), os = require('os');
const png = process.argv[2];
const exe = process.env.CHROME || ['google-chrome', 'chromium', 'chromium-browser', 'chrome'].find(c => { try { return spawnSync(c, ['--version']).status === 0 } catch (e) { return false } }) || 'google-chrome';
const port = 9300 + Math.floor(Math.random() * 500), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-'));
const url = 'file://' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const ch = spawn(exe, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=' + port, '--user-data-dir=' + dir, url], { stdio: 'ignore' });
const get = u => new Promise((r, j) => http.get(u, s => { let d = ''; s.on('data', c => d += c); s.on('end', () => r(JSON.parse(d))) }).on('error', j));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rd = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
(async () => {
  let tab; for (let i = 0; i < 40 && !tab; i++) { try { tab = (await get(`http://127.0.0.1:${port}/json`)).find(t => t.type === 'page') } catch (e) { await sleep(500) } }
  if (!tab) { console.log('Chrome não abriu (defina CHROME)'); ch.kill(); process.exit(1); }
  const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const wait = {}, errs = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait[m.id]) { wait[m.id](m.result); delete wait[m.id] } if (m.method === 'Runtime.exceptionThrown') { const t = (m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text; if (!/module is not defined/.test(t)) errs.push(t.split('\n')[0]) } };
  const send = (method, params = {}) => new Promise(r => { wait[++id] = r; ws.send(JSON.stringify({ id, method, params })) });
  const ev = async (code) => { const r = await send('Runtime.evaluate', { expression: code, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text); return r.result.value };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 2, mobile: true });
  await sleep(1500);
  let res = [], fatal = '';
  try {
    const seed = await ev(rd('regressao-dados.js'));            // 1) dados fictícios gravados no navegador
    await send('Page.reload'); await sleep(2500);               // 2) recarrega: o app sobe já com tudo isso
    const boot = errs.splice(0);
    res = await ev(rd('regressao-testes.js'));                  // 3) testes
    res.unshift({ id: 'R01', n: 'Carregar com dados completos sem erro na página', ok: !boot.length, d: boot.join(' | ') || seed });
    if (png) { await ev("document.querySelector('nav [data-t=plan]').click()"); await sleep(500); fs.writeFileSync(png, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64')) }
    if (errs.length) res.push({ id: 'R99', n: 'Nenhum erro de JavaScript durante os testes', ok: false, d: [...new Set(errs)].join(' | ') });
  } catch (e) { fatal = String(e.message || e) }
  ch.kill();
  // 4) servidor (lib/plan.js) tem de dar o mesmo resultado do app para atrasadas e vence hoje
  const srv = res.find(x => x.id === 'R40');
  if (srv && srv.S) { try { const { compute } = require('../lib/plan'); const r = compute(JSON.parse(srv.S), srv.t); const a = r.late.map(x => x.id).sort().join(','), b = srv.late.slice().sort().join(','); srv.ok = a === b && r.due.length === srv.due; srv.d = 'servidor ' + r.late.length + ' atrasadas/' + r.due.length + ' hoje; app ' + srv.late.length + '/' + srv.due + (a === b ? '' : ' (listas diferentes)') } catch (e) { srv.ok = false; srv.d = String(e.message) } delete srv.S }
  let bad = 0;
  res.forEach(x => { if (!x.ok) bad++; console.log((x.ok ? 'ok   ' : 'FALHA') + ' ' + x.id + ' ' + x.n + (x.d ? '  [' + String(x.d).slice(0, 300) + ']' : '')) });
  if (fatal) { console.log('ERRO NO ROTEIRO: ' + fatal); bad++ }
  console.log(bad ? '\n' + bad + ' falha(s) de ' + res.length : '\nTudo certo: ' + res.length + ' testes');
  process.exit(bad ? 1 : 0);
})();
