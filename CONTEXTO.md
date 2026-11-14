# Meu Caixa — contexto técnico
Regras fixas: MEMORIA.md. Procedimento: CLAUDE.md. O que subiu e quando: `git log` (aqui não se registra status de publicação).

## O que é
Sistema de finanças pessoais em página web, arquivo único `index.html`. Uso pessoal; o controle vinha de planilha anual (importado jan–out/2026).
- Código: GitHub `Ita-013/Meu-sistema-financeiro`, branch `main`. Deploy: Vercel (https://meu-sistema-pink.vercel.app), publica sozinho ao atualizar a main.
- Dados: Firebase (login por e-mail + Firestore, documento `users/{uid}` com campo `data` em JSON). Banco: Pluggy (Open Finance).
- Push diário às 9h (Brasília): cron `/api/daily` (`0 12 * * *` UTC) atualiza o Pluggy, calcula atrasadas, vence hoje e movimentações novas e envia FCM, com o app fechado. O app não repete o aviso no mesmo dia.

## Mapa (nomes de função; ache com `grep -n "function nome" index.html`)
- Base: `S`, `persist`, `norm`, `toast`, `askDel`, `fillCats`, `MONEY`/`num` (máscara de valor).
- Resumo: `render` (cálculo do Sobrou em `bal`), `detail`, `renderFat`/`detailFat`, `renderOced`/`ocApply`.
- Lançamentos: `openEt`/`etDel`, `parUI`/`parPrev`; ordenação `lsort` (declarada no topo).
- Compromissos: `occ`/`fatOcc`, `renderComp`, `openForm`, `recvOf`.
- Orçamentos: `renderSheet`, `setPlan`/`setCell`, `bAt`, `renameCat`, `dstart`/`dmove`/`dend`; pop-up do Real da caixinha: `cxrOpen`/`cxrShow` (`#cxrm`; `#cxr` já é do Resumo).
- Caixinhas: `cxMove`, `renderCx`, `cxOced`, `openCxNew`.
- Conciliação/Pluggy: `renderRec`, `recImport`, `cpCands`/`cpSug`, `inst*`, `pgIngest`, `pgSkip`, `pgSync`, `pgAuto`, `pgShow`, `recUndoTx`.
- Importar/exportar: `importText`, `parseCSV`/`parseOFX`. Nuvem/acesso: `startCloud`, `applyCloud`, `reinit`, `lockNow`, `wipeAll`. Tema: `setTema`/`applyTheme`.
- Notificações: bloco "notificações do navegador" (`nf*`), `pushRegister`. Convite: `inviteInit`/`doInvite`.
- Servidor: `api/pluggy.js` (consulta e refresh), `api/daily.js` (cron), `api/push.js`, `api/invite.js`; `lib/google.js` (Firestore, FCM, Auth), `lib/plan.js` (atrasadas/vencimentos, espelha o app), `lib/bank.js` (refresh do Pluggy e contagem). `sw.js` (service worker + push). `pluggy.js` na raiz é antigo (gera o erro inofensivo "module is not defined").
- Ferramentas: `tools/sync-memoria.sh`, `tools/verificar.sh`, `tools/checar-cores.sh`, `tools/teste-chrome.js`, `tools/regressao.js` (roteiro: TESTES.md). Backup: `bkData`; parcela excluída: `parDrop`; ajuda: botões `.inf`.

## Armadilhas
- Cartão: `date` é o vencimento da fatura (define o mês do lançamento) e `pd` a data da compra. Lançamentos mostra e ordena por `pd||date`; o filtro do mês usa `date`. Fatura em aberto entra em A pagar, não em Despesas.
- Caixinha: `cxMove` cria lançamento `out` com categoria `Caixinhas` (retirada = `in`). Eles entram em `inc`/`exp` e no Sobrou; o Resumo só os esconde de Receitas/Despesas na exibição e os mostra no quadro Caixinhas. Orçado x realizado depende de `inc`/`exp`: não mudar essas variáveis.
- Ordem de carregamento: estado usado por `render` (`recF`, `lsort`…) fica no TOPO do script; `occ()`/`cdt` só rodam com `window.compReady` (senão: "Cannot access 'cdt' before initialization").
- Conciliação: origem pelo tipo da conta (`kind`: BANK x CREDIT). "Lançar sugeridas" não inclui as com compromisso sugerido (confirmação individual). "Desfazer lançamento" só em conciliada que o app lançou (sem `lk`). `pgSkip` ignora sozinho rendimento, cofrinho, pagamento de fatura e transferências suas.
- Pluggy: o app só LÊ; item parado = movimentações ausentes. O refresh (`PATCH /items/{id}`, `refresh` em `lib/bank.js`) roda no push das 9h (espera até 35 s) e no botão ⟳ (`pgSync(true,true)`, até 28 s; 3 por 10 min). `vercel.json` dá 60 s às funções. Gasta cota do plano (botão + cron = 2 no dia). `LOGIN_ERROR`/`OUTDATED`/`WAITING_USER_*` vira aviso "Um banco pede atenção".
- Push: `FIREBASE_SERVICE_ACCOUNT` inválida/incompleta dá 500 "config" e nenhum aparelho é cadastrado: conferir primeiro e fazer Redeploy. Último envio em `push/{uid}` (`lastRun`/`lastResult`), mostrado na aba ⚙ ("Servidor"). Uma conta por aparelho (`pushUid`, `cfg.onUid`). Horário fixo, sem seletor.
- Vercel Hobby: cron só 1x/dia, precisão ±1 h, log ~1 h, até 100 crons por projeto.
- Convite: fora do código, `ADMIN_UID` na Vercel (Firebase > Authentication > Usuários > UID) e desligar "Enable create (sign-up)" no Firebase. Se `create` der PERMISSION_DENIED, a conta de serviço precisa do papel "Firebase Authentication Admin".
- Planilha: Real dos gastos com Plan ganha pílula (`s-ok` < 70%, `s-warn` 70–100%, `s-over` acima; vars `--pk-*` por tema); linhas alternadas `.zb` (`RZ` zera em cada grupo). Ajuste no Real da caixinha cria `cxMove` com `note` "Ajuste de planilha".
- Barras das despesas: verde < 70%, laranja de 70% a 100% (cheia e sem tracejado em 100%), vermelho escuro acima ("estourou"), cinza sem orçamento. Receitas e caixinhas ficam cheias ao atingir.
- Variáveis da Vercel: `FIREBASE_SERVICE_ACCOUNT`, `CRON_SECRET`, `FIREBASE_API_KEY`, `PLUGGY_ENC_KEY`, `ADMIN_UID`. Notificações precisam ser ativadas no app (aba ⚙) em cada aparelho.

## Histórico
- 11 a 14/11/2026: push diário às 9h e botão ⟳ do Pluggy; títulos acima dos campos; compromisso sugerido e desfazer na conciliação; caixinhas redesenhadas; Pagar pelo Resumo; dados isolados por conta; máscara de valor; cadastro só por convite; Lançamentos pela data da compra; scripts em `tools/`; revisão geral (ids únicos em lote, parcela excluída ajusta a planilha, backup completo, escape de HTML, `dOk` para datas, ícones (i)); TESTES.md, `tools/regressao.js` e suíte `--estresse`.
- 14/11/2026: planilha de Orçamentos no modelo E (pílulas, linhas alternadas, nome largo, Plan tracejado); pop-up do Real das caixinhas (R94–R96); `pgAuto` reconsulta o Pluggy se a leitura tem mais de 1 h e o ⟳ não promete "atualizar o banco" (MeuPluggy não aceita). Real dos gastos sem sinal − na planilha; lixeira vermelha padrão nas linhas (R74 passa).

## Pendências
- Pluggy: itens "MeuPluggy" (proxy) não aceitam `PATCH /items`; atualizam 1x/dia no horário da conexão original, então o refresh do cron e do ⟳ não força nada (`refresh` em `lib/bank.js` só acompanha o status). Se a leitura vier velha, o limite é do Pluggy, não do app.
- Conferir a linha "Servidor" na aba ⚙ para saber o que o cron das 9h fez.
- Segurança: conferir as regras do Firestore (só `users/{uid}` com o próprio uid; `push/*` só pelo servidor) e apagar contas desconhecidas. Opcional: restringir a API key por referrer e exigir senha mais forte.
- Aguardando aprovação (visual): título acima de `#pin1` e `#bk-txt` (R72); `confirm()` nativos, "Remover" banco e "Esquecer" regra fora do padrão; menus (barra com 5 abas não cabe em 390 px; busca em Lançamentos). Decidido: Conciliação fica dentro da ⚙, não separar.
- Estresse (TESTES.md parte 3): conciliação lenta acima de ~2.000 pendências; estado corrompido derruba a abertura (falta normalizar na carga); cabeçalhos de segurança no `vercel.json` (CSP, X-Frame-Options, nosniff).
- Decidir se o backup deve levar as pendências da conciliação (`rec`).
- Trocar `#052E16` fixo em `.oks` e `.svd` por `var(--on-in)` (o `verificar.sh` avisa; muda o tema rosa: pedir aprovação).
- Remover `pluggy.js` da raiz e a tag `<script src="pluggy.js">`.
- Apagar no GitHub as branches antigas já mescladas (claude/push-diario, claude/titulos-compromisso, claude/corrige-carregamento).
- Transformar em app instalável (APK Android).
- Ideia, se mais gente usar: horário do push por usuário (`/api/daily?h=HH`).
