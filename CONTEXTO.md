# Meu Caixa — memória e contexto do projeto
Atualizado em 11/11/2026 (main no commit b0a6dd4 + botão Pagar no Resumo e pop-ups sem foco automático, ainda não commitado). Regras fixas ficam em MEMORIA.md. Arquivo para revisão; a fonte da verdade do código é o GitHub (branch main).

## O que é
Sistema de finanças pessoais em página web interativa, arquivo único `index.html`.
- Código: GitHub `Ita-013/Meu-sistema-financeiro`, branch `main`
- Deploy: Vercel (https://meu-sistema-pink.vercel.app), publica sozinho ao atualizar a main
- Dados: Firebase (login por e-mail + Firestore, documento `users/{uid}` com campo `data` em JSON)
- Banco: Pluggy (Open Finance) por função serverless `api/pluggy.js`
- Uso pessoal. Controle vinha de planilha anual; importado jan–out/2026.

## Regras de trabalho e de design
Ver MEMORIA.md (fonte única; não repetir aqui).

## Funcionamento do sistema
- Resumo: 3 blocos (Sobrou no mês, Receitas com A receber, Despesas com A pagar), mais orçado x realizado por categoria em blocos.
- Lançamentos/Compromissos (Pix, dinheiro, cartão). Compromissos: vencimento opcional, recorrentes ou avulsos, status a pagar/pago/atrasado, dá para ignorar.
- Orçamentos: planilha por categoria (realizado e planejado por mês); fixos e variáveis, arrastar para reordenar.
- Caixinhas: blocos iguais aos do orçado x realizado do Resumo (emoji, nome, "de meta", barra com guardado e falta tracejada). Tocar no nome ou na barra expande Valor/Data, Guardar/Retirar e Histórico. Botão Editar no topo (como no Resumo) libera emoji, nome e meta de todas, com ✓/✕ e lixeira por caixinha.
- Conciliação (aba da engrenagem): importa movimentações via Pluggy, usuário confirma categorias; parcelamentos com prévia (x/X); atualiza na primeira abertura do dia.

## O que foi feito nesta fase (11/11/2026)
1. Push diário às 9h (Brasília): Vercel cron `/api/daily` (`0 12 * * *` UTC) lê o Firestore (somente leitura), calcula atrasadas, vence hoje e movimentações novas do Pluggy, e envia push (FCM). Tokens em `push/{uid}`. `sw.js` v2 com handler de push. O app não repete o aviso no mesmo dia. Hobby pode atrasar até ~1h.
2. Correções do sync do Pluggy/notificações (diagnóstico: o aviso e a atualização só rodavam com o app aberto).
3. Títulos acima de todos os campos de formulário.
4. Conciliação: movimentação de saída que bate com um compromisso em aberto (mesmo valor, ou nome parecido + valor até 20% próximo, vencimento até 40 dias) sugere o compromisso; botão "Lançar e marcar como pago". "Lançar sugeridas" NÃO inclui as que têm compromisso sugerido (confirmação individual).
5. Bug introduzido e corrigido: a sugestão chamava `occ()` antes de `cdt` existir no carregamento (erro "Cannot access 'cdt' before initialization"), quebrando cliques (Compromissos e categorias do Resumo) para quem tem cartões/recorrentes. Correção: `cpCands` só roda com `window.compReady`.
6. Caixinhas redesenhadas (11/11/2026): código em renderCx (estado cxExp/cxEd/cxDr); removidos o lápis por caixinha e o campo Nome dentro de Histórico.
7. Registro do último envio (11/11/2026): o push das 9h não chegou e a Vercel Hobby guarda log só ~1h, então o `daily` agora grava em `push/{uid}` os campos `lastRun` e `lastResult` (enviado, sem aparelho, nada a avisar, erro do FCM; função `setRun` em `lib/google.js`), e também escreve no log. `api/push.js` ganhou a ação `status`, e a aba ⚙ mostra "Servidor: N aparelho(s) · último envio ..." (`srvStatus` no `index.html`, `#nfr`). Causa do push que não chegava (resolvida em 11/11): a variável `FIREBASE_SERVICE_ACCOUNT` na Vercel estava inválida/incompleta, então `POST /api/push` e `/api/daily` davam 500 "config" e nenhum aparelho era cadastrado (app mostrava "Push: inativo (config)"). Corrigida com uma nova chave da conta de serviço colada inteira + Redeploy; o Run do cron passou a mostrar `1 de 1 aparelho(s) enviado(s)`. Se voltar a falhar com "config", conferir primeiro essa variável (e redeployar depois de mudar).
8. Pagar pelo Resumo e sem teclado automático (11/11/2026): cada linha de "Próximos vencimentos" (`renderComp`, `#vl`) ganhou botão Pagar (compromisso abre o pop-up "Marcar como pago"; fatura usa `fpay`, e antes clicar numa fatura ali não fazia nada); o pop-up "Editar compromisso" ganhou o botão `#cpay` "Marcar como pago" (só em compromisso em aberto; fecha os dois pop-ups ao confirmar). Removido o `.focus()` automático dos pop-ups de compromisso, caixinha, linha, cartão e ressarcimento, para o teclado do celular não abrir sozinho. Mantido o foco só no lápis de renomear categoria/emoji, nos erros de validação e na tela de senha. Testado em Chrome headless com estado completo (cartão, fatura, recorrente, atrasado, pago).
Lição: testar com dados completos (cartões, recorrentes, pagos, parcelas), não só com dados mínimos.

## Índice do index.html (funções e linhas aproximadas; confirme com `grep -n "function nome"`)
- Estado e base: `S` e `persist` (~742-780), `fillCats` (794), `norm` (803), `toast` (1156), `askDel` (752).
- Resumo e painel do topo: `render` (805; cálculo do Sobrou em ~808-811), `detail` (1603), `renderFat`/`detailFat` (1854/1866), `renderOced`/`ocApply` (1569/1570, modo Editar do orçado).
- Lançamentos: `openEt`/`etDel` (2183/2175), parcelas `parUI`/`parPrev` (1659/1663).
- Compromissos: `occ`/`fatOcc` (2041/2043), `renderComp` (2057), `openForm` (2076), `recvOf` (2111).
- Orçamentos (planilha): `renderSheet` (1135), `setPlan`/`setCell` (1080/1097), `bAt` (1602), `renameCat` (1198), arrastar `dstart`/`dmove`/`dend` (2155-2159).
- Caixinhas: `cxMove` (1676), `renderCx` (1682; estado `cxExp`/`cxEd`/`cxDr`), `cxOced` (1681), `openCxNew` (1161).
- Conciliação/Pluggy: `renderRec` (1464), `recImport` (1322), `cpCands`/`cpSug` (1344/1346), parcelas `inst*` (1364-1437), `pgIngest` (2251), `pgShow` (2234).
- Importar/exportar: `importText` (978), `parseCSV`/`parseOFX` (1307/1316).
- Nuvem e acesso: `startCloud` (2030), `applyCloud` (1964), `reinit` (1963), PIN `lockNow` (1928), `wipeAll` (1941).
- Tema: `setTema`/`applyTheme` (1043/1044). CSS dos blocos de orçamento e caixinhas: seção "blocos de orçamento e caixinhas" (~205).

## Configuração na Vercel (já feita pelo usuário)
Variáveis: `FIREBASE_SERVICE_ACCOUNT`, `CRON_SECRET`, `FIREBASE_API_KEY`, `PLUGGY_ENC_KEY`. Notificações precisam ser ativadas no app (aba ⚙) no celular.
Verificar: Vercel → Settings → Cron Jobs mostra `/api/daily`. Se o push não chegar até ~10h, ver Logs de `/api/daily`.

## Estrutura do repositório
`index.html` (app inteiro) · `sw.js` (service worker + push) · `vercel.json` (cron) · `api/pluggy.js`, `api/daily.js`, `api/push.js` · `lib/google.js`, `lib/plan.js` (cálculo de atrasadas/vencimentos no servidor, espelha o do app), `lib/bank.js` · `manifest.webmanifest` e ícones · `pluggy.js` na raiz (antigo; o index.html ainda carrega e gera um erro inofensivo "module is not defined" no console; candidato a remoção)

## Pendências e ideias
- Confirmar o push real das 9h em 12/11 (o Run manual de 11/11 enviou 1 de 1; ler a linha "Servidor" na aba ⚙ se não chegar). O app só mostra "config" quando o servidor responde esse erro; se quiser mais detalhe, fazer o app exibir o `detail` da resposta.
- Instruções do projeto: incluir a regra dos títulos e corrigir o tema padrão descrito (instruções dizem preto/vermelho; o código usa azul-marinho `#090D16` com verde `#10B981` e vermelho `#F43F5E`).
- Remover `pluggy.js` da raiz e a tag `<script src="pluggy.js">`.
- Transformar em app instalável (APK Android).
- Apagar no GitHub as branches antigas já mescladas (claude/push-diario, claude/titulos-compromisso, claude/corrige-carregamento).

## Onde ficam memória e contexto
Instruções do projeto (claude.ai → Projetos → Meu Caixa) · memória do projeto (arquivo `areas/meu-caixa.md`) · este arquivo · GitHub (código e histórico). O Claude não guarda o histórico detalhado das conversas.
