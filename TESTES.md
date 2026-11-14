# Meu Caixa — testes de regressão

Erros que já aconteceram (ou que a revisão de 13/11/2026 encontrou) e o teste que impede cada um de voltar.
Rodar a cada atualização, antes de oferecer subir na main.

## Como rodar
```
sh tools/verificar.sh        # sintaxe JS + cores fixas
node tools/regressao.js      # 40 testes automáticos (precisa de Node 22+ e Chrome)
node tools/regressao.js --estresse   # 15 testes de estresse e de segurança do navegador (~1 min); rodar quando mexer em importação, telas ou formato dos dados
```
O `regressao.js` abre o app no Chrome sem login, carrega dados fictícios em volume (`tools/regressao-dados.js`: ~1.600 lançamentos em 14 meses, 3 cartões, parcelas, compromissos recorrentes/pagos/ignorados/atrasados, caixinhas), **recarrega a página com esses dados** e roda `tools/regressao-testes.js`. Sai com código 1 se algo falhar. Nenhum dado real é tocado.

Regra: **bug novo corrigido = teste novo aqui e em `regressao-testes.js`**, com o mesmo id.

## Parte 1: automáticos (`node tools/regressao.js`)

| Id | O que confere | Erro que motivou |
|---|---|---|
| R01 | App carrega com dados completos sem erro de JavaScript | 11/11: travava ao abrir ("Cannot access 'cdt' before initialization"); estado usado por `render` declarado depois do uso (`recF`, `lsort`) |
| R02 | Resumo e planilha desenham em menos de 0,4 s com ~1.600 lançamentos | 09/11: lentidão (gravação a cada toque, histórico das caixinhas sempre montado) |
| R03, R60 | Todo lançamento tem id único, inclusive 150 lançados de uma vez na conciliação | 13/11: `recCommit` e `addTx` criavam id com `Date.now()` (+ sorteio); em lote saíam ids repetidos, e excluir um lançamento apagava o gêmeo |
| R10–R12 | Sobrou, Receitas, Despesas e A pagar batem com a conta refeita por fora (mês atual, seguinte e antigo) | 09/11 e 12/11: ajustes repetidos no A pagar e no que entra em Despesas |
| R13 | Fatura em aberto fica no A pagar e fora das Despesas; paga, vira Despesa sem mudar o Sobrou | Regra fixa do Resumo, já quebrada uma vez (09/11) |
| R14 | Guardar em caixinha baixa o Sobrou e não entra em Despesas nem no Gasto | 12/11: caixinha aparecia como gasto e como "fora do orçamento" |
| R15 | Orçado do Resumo = planejado da planilha | Duas fontes de orçamento (migração `bud`/`budm` para `sheet`) |
| R16 | Lançamentos ordenados pela data da compra | 12/11: lista ordenava pelo vencimento da fatura |
| R20 | Vencimento da fatura: antes/depois do fechamento, virada de ano, mês curto | Datas de cartão erradas na virada de mês |
| R21, R22 | Parcelas somam o valor total; parcela 3 de 6 espalha para trás e para frente | 11/11: correção do campo de parcelas |
| R23, R24 | Excluir uma parcela (ou todas) ajusta a linha "Parcelas" da planilha | 13/11: a lixeira da lista não tirava o valor da planilha (a janela de edição tirava) |
| R25 | Campos de parcela só aparecem com "Compra parcelada" marcada | 11/11: `.g2[hidden]` não escondia |
| R30 | Pagar compromisso cria lançamento; excluir o lançamento devolve para A pagar | 09/11: compromisso ficava pago sem lançamento |
| R31, R32 | Recorrente no dia 31 em mês curto, sem dia, encerrado, ignorado e atrasado | Regras de compromisso refeitas em 10/11 |
| R33 | Editar a data de compra no cartão recalcula a fatura | Armadilha `date` x `pd` |
| R34 | Ressarcimento abate a despesa e não vira receita | Regra do Resumo |
| R40 | `lib/plan.js` (push das 9h) dá as mesmas atrasadas e "vence hoje" do app | Cálculo duplicado no servidor: mudar um lado e esquecer o outro |
| R50 | Planejado: mês vazio vale até dezembro; mês preenchido muda só ele | Regra dos Orçamentos |
| R51 | Rodapé da planilha bate com os lançamentos | — |
| R52 | Renomear categoria leva lançamentos, planejado e compromissos | 28/10: renomear perdia o grupo e os compromissos |
| R61 | Importar o mesmo extrato duas vezes não duplica | Correções do sync do Pluggy (10/11) |
| R62 | "Parece já lançado" fica fora do "Lançar sugeridas"; fatura e transferência própria são ignoradas | Duplicidade na conciliação |
| R63 | Saída que bate com compromisso sugere o compromisso e fica fora do lote | 11/11: sugestão de compromisso |
| R70 | Máscara de valor (2590 vira 25,90) | 11/11 |
| R71 | Nenhum pop-up abre com campo focado | 11/11: teclado do celular abria sozinho |
| R72 | Todo campo tem título fixo acima | 11/11: placeholder no lugar do título. **Falha hoje:** `#pin1` (nova senha) e `#bk-txt` (texto do backup) |
| R73 | Descrição com HTML aparece como texto | Segurança (dados vêm do banco e de arquivos) |
| R74 | Toda exclusão usa a lixeira vermelha padrão | 09/11. **Falha hoje:** lixeira cinza nas linhas da planilha de Orçamentos |
| R75 | Nenhuma tela passa da largura do celular com valores grandes | 13/11: A pagar acima de R$ 10 mil empurrava "Novo compromisso" para fora da tela |
| R80 | Todo ícone (i) abre balão com texto, dentro da tela, e fecha; áreas principais têm ícone | 13/11: revisão dos ícones |
| R81 | Textos de ajuda sem afirmações antigas | 13/11: "dados ficam só neste aparelho", fatura "pelo mês da compra" |
| R90–R92 | Backup em arquivo e em texto restaura o mesmo estado; "Juntar" duas vezes não duplica | 13/11: backup em texto não levava compromissos; nenhum levava faturas pagas; "Juntar" ignorava compromissos |
| R94–R96 | Planilha: ajustar o Real da caixinha cria só a diferença; excluir movimento pelo pop-up (lixeira + confirmação); pílulas de status 70%/100% | 14/11: Real das caixinhas era só leitura; cores da planilha incomodavam |

As duas falhas de hoje (R72 e R74) são mudanças visuais: esperam aprovação.

## Parte 2: manuais (dependem de login, banco ou celular)

| Id | Passo | Erro que motivou |
|---|---|---|
| M01 | Duas contas no mesmo navegador: entrar na A, sair, entrar na B. B não pode ver cartões, titular, última consulta nem a caixa "Ativar notificações" de A | 11/11: `caixa-pg` e push eram do aparelho, não da conta |
| M02 | Aba ⚙ > Notificações: linha "Servidor" com data de hoje e "Pluggy: x/y atualizado(s)" depois das 9h | 11/11: push das 9h não chegava e não deixava rastro |
| M03 | "Enviar notificação de teste" chega com o app fechado | `FIREBASE_SERVICE_ACCOUNT` inválida dá 500 "config" |
| M04 | Botão ⟳ da conciliação: atualiza, mostra horário novo, limite de 3 em 10 min | Item parado no Pluggy = movimentações ausentes |
| M05 | Tela de login sem "Criar conta"; convite só aparece para o administrador | 12/11: cadastro público desligado |
| M06 | Conta liberada continua com o tema Rosa depois da atualização; conta comum não vê | Regra fixa do tema rosa |
| M07 | Celular: alterar algo, fechar o app na hora, reabrir: a alteração está lá e a data de "Última alteração" mudou | 09/11: gravação adiada (0,3 s) |
| M08 | Depois de subir: abrir o site e conferir que `/CLAUDE.md`, `/MEMORIA.md`, `/CONTEXTO.md`, `/TESTES.md` e `/tools/` dão 404 | `.vercelignore` |
| M09 | Planilha de Orçamentos no celular: arrastar um gasto entre fixos e variáveis e reordenar | 28/10: arrastar e soltar |
| M10 | Pluggy: abrir o app, tocar no ⟳ e conferir o horário "atualizado em" de cada banco; reabrir depois de mais de 1 h e ver se consulta sozinho | 14/11: consultava só 1x por dia |

## Parte 3: estresse e segurança (`node tools/regressao.js --estresse`)

| Id | O que confere | Resultado em 14/11/2026 |
|---|---|---|
| E01 | 20.000 lançamentos (5 anos): telas em menos de 1,5 s | Passa (menos de 0,1 s) |
| E02 | Quantos lançamentos cabem no limite de 1 MB do documento da nuvem | Passa: ~127 bytes por lançamento, cerca de 8.000 lançamentos |
| E03 | 5.000 pendências na conciliação desenham em menos de 2 s | **Falha:** 21 s (até 1.000 pendências leva 0,2 s). Corrigir com lista paginada |
| E04 | 300 categorias, 100 caixinhas, 40 cartões | Passa |
| E05 | 2.000 lançamentos seguidos pelo formulário, ids únicos | Passa |
| E10–E12 | Centavos exatos, valores de bilhões, datas de 1999 a 2099, ano bissexto | Passa |
| E20 | 14 backups malformados são recusados sem erro | Passa (corrigido: item nulo no backup derrubava a restauração) |
| E21 | Backup com `__proto__`/`constructor` não contamina o sistema | Passa |
| E22 | Backup de 50.000 lançamentos restaura em menos de 5 s | Passa |
| E23 | Extratos CSV/OFX quebrados não geram pendência inválida | Passa (corrigido: 31/02 e mês 99 viravam pendência) |
| E30 | Texto com HTML/script em todo campo de nome aparece só como texto | Passa (corrigido: nome do cartão, forma de pagamento e emojis entravam sem escape) |
| E31 | Dados da nuvem com campo faltando ou de tipo errado não derrubam as telas | **Falha:** lançamento sem data, caixinha sem histórico e pendência sem valor quebram a tela |
| E40 | Dados locais corrompidos: o app abre mesmo assim | **Falha** em 4 de 12 casos (listas nulas ou de tipo trocado). JSON inválido já é tratado |

E31 e E40 pedem uma "limpeza na carga" (normalizar o estado ao abrir). Não foi feita porque descartar item inválido em silêncio pode apagar dado real: decidir a regra antes.
