// Teste de tela sem montar navegador do zero: abre o index.html no Chrome headless, roda um cenário e imprime o resultado.
// Uso: node tools/teste-chrome.js cenario.js [saida.png]     (precisa de Node 22+ e Chrome; variável CHROME aponta o executável)
// O cenário é um arquivo com UMA expressão JS (ex.: uma função autoexecutável que devolve texto ou objeto), rodada dentro do app.
// Dentro dele valem as variáveis do app: S (estado), m (mês), $, render(), cxMove(...). Exemplo:
//   (()=>{ m='2026-11'; $('m').value=m; S.tx=[{id:1,type:'out',amount:50,desc:'x',cat:'Mercado',date:'2026-11-10',pay:'Pix'}]; render(); return $('exp').textContent })()
// Com saida.png, tira um print em tela de celular (390 px). O erro inofensivo "module is not defined" (pluggy.js antigo) é ignorado.
const { spawn } = require('child_process'), fs = require('fs'), path = require('path'), http = require('http');
const [, , cen, png] = process.argv;
if (!cen) { console.log('uso: node tools/teste-chrome.js cenario.js [saida.png]'); process.exit(1); }
const exe = process.env.CHROME || ['google-chrome', 'chromium', 'chromium-browser', 'chrome'].find(c => { try { return require('child_process').spawnSync(c, ['--version']).status === 0 } catch (e) { return false } }) || 'google-chrome';
const port = 9300 + Math.floor(Math.random() * 500), dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mc-'));
const url = 'file://' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const ch = spawn(exe, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=' + port, '--user-data-dir=' + dir, url], { stdio: 'ignore' });
const get = u => new Promise((r, j) => http.get(u, s => { let d = ''; s.on('data', c => d += c); s.on('end', () => r(JSON.parse(d))) }).on('error', j));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let tab; for (let i = 0; i < 40 && !tab; i++) { try { tab = (await get(`http://127.0.0.1:${port}/json`)).find(t => t.type === 'page') } catch (e) { await sleep(500) } }
  if (!tab) { console.log('Chrome não abriu (defina CHROME)'); ch.kill(); process.exit(1); }
  const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const wait = {}, errs = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait[m.id]) { wait[m.id](m.result); delete wait[m.id] } if (m.method === 'Runtime.exceptionThrown') { const t = (m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text; if (!/module is not defined/.test(t)) errs.push(t) } };
  const send = (method, params = {}) => new Promise(r => { wait[++id] = r; ws.send(JSON.stringify({ id, method, params })) });
  await send('Runtime.enable'); await sleep(1500);
  if (png) await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 700, deviceScaleFactor: 2, mobile: true });
  const r = await send('Runtime.evaluate', { expression: fs.readFileSync(cen, 'utf8'), returnByValue: true, awaitPromise: true });
  console.log(r.exceptionDetails ? 'ERRO NO CENÁRIO: ' + (r.exceptionDetails.exception || {}).description : typeof r.result.value === 'string' ? r.result.value : JSON.stringify(r.result.value, null, 1));
  if (png) { await sleep(400); fs.writeFileSync(png, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64')); console.log('print: ' + png) }
  if (errs.length) console.log('ERROS NA PÁGINA:', JSON.stringify(errs));
  ch.kill(); process.exit(0);
})();
