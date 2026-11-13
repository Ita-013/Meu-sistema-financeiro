# Meu Caixa: instruções para o Claude Code

@MEMORIA.md
@CONTEXTO.md

A memória (CLAUDE.md, MEMORIA.md, CONTEXTO.md) vive na raiz do repositório; a main do GitHub é a referência (assim o agente também trabalha pelo celular).

## Antes de tudo
Rode `sh tools/sync-memoria.sh` (uma chamada) e siga o resultado:
- `OK`: siga com o pedido.
- `ATUALIZADO`: releia MEMORIA.md e CONTEXTO.md do disco (os importados acima ficaram velhos).
- `PARAR`: mostre o que difere e pergunte qual versão vale. Não sobrescreva nada.
- `SEM_GITHUB`: avise e siga com a cópia local, sinalizando isso no resumo final.
Se os arquivos de memória não estiverem no repositório: avise e proponha commitá-los junto com o `.vercelignore`.

## Economia (leia antes de agir)
- `index.html` é grande (arquivo único): nunca leia inteiro. Ache a função com `grep -n "function nome" index.html` (nomes no mapa do CONTEXTO.md) e leia só o trecho.
- Não releia o que acabou de editar nem rode comandos para "conferir" o que a ferramenta já confirmou.
- Pergunta de diagnóstico ("por que…?"): leia o código, responda e pare. Só edite quando pedirem a mudança.
- Teste de tela: `node tools/teste-chrome.js cenario.js` (uso no cabeçalho do script); não monte navegador do zero.

## Fluxo
1. A raiz é o app: `index.html`, `sw.js`, `vercel.json`, `api/`, `lib/`, `tools/`. Trabalhe só no repositório.
2. Mudança visual ou de funcionalidade: descreva ou mostre um mockup e ESPERE aprovação antes de editar.
3. Depois de editar: `sh tools/verificar.sh` (sintaxe JS + cores fixas) e `node tools/regressao.js` (testes de regressão com dados fictícios; roteiro em TESTES.md; bug novo corrigido = teste novo) e revise o fluxo mexido com dados completos (cartões, recorrentes, pagos, parcelas), não só dados mínimos.
4. NUNCA `git push` sem o usuário autorizar nesta conversa (a Vercel publica a main sozinha). Sem branches: direto na main.
5. Memória, no MESMO commit da mudança:
   - CONTEXTO.md: uma linha nova em "Histórico" (data + o que mudou); uma linha em "Armadilhas" só se houver pegadinha que o código não mostra; tire de "Pendências" o que foi resolvido.
   - MEMORIA.md: só se surgir regra fixa nova.
   - NUNCA escreva status de publicação ("ainda sem subir", "subiu no…") nem hash de commit: quem diz o que subiu é o `git log`.
   - Mantenha o CONTEXTO.md abaixo de ~6 KB: ao passar, funda o histórico antigo em uma linha por mês.
6. Segredos (chaves, tokens, variáveis de ambiente) nunca vão para arquivo do repositório; ficam só na Vercel.
7. Resposta final curta: o que mudou e por quê (o usuário está aprendendo) e a oferta de subir na main.
