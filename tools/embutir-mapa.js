// Mantém dentro do index.html uma cópia exata de lib/mapa.js (o app é um arquivo único e não importa módulos).
// Uso: node tools/embutir-mapa.js          grava a cópia entre /*MAPA:INI*/ e /*MAPA:FIM*/
//      node tools/embutir-mapa.js --check  só confere (sai com 1 se a cópia estiver velha; usado por tools/verificar.sh)
const fs = require('fs'), path = require('path');
const f = path.join(__dirname, '..', 'index.html'), src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'mapa.js'), 'utf8').replace(/\s+$/, '');
const html = fs.readFileSync(f, 'utf8'), a = html.indexOf('/*MAPA:INI*/'), b = html.indexOf('/*MAPA:FIM*/');
if (a < 0 || b < a) { console.log('ERRO: marcadores /*MAPA:INI*/ e /*MAPA:FIM*/ não encontrados no index.html'); process.exit(1); }
const novo = html.slice(0, a) + '/*MAPA:INI*/\n' + src + '\n' + html.slice(b);
if (process.argv.includes('--check')) { if (novo !== html) { console.log('ERRO: cópia de lib/mapa.js no index.html está velha (rode: node tools/embutir-mapa.js)'); process.exit(1) } console.log('ok: mapa.js embutido em dia'); process.exit(0) }
fs.writeFileSync(f, novo); console.log('mapa.js embutido (' + src.length + ' bytes)');
