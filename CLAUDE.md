# Meu Caixa: instruções para o Claude Code

@MEMORIA.md
@CONTEXTO.md

A memória (CLAUDE.md, MEMORIA.md, CONTEXTO.md) vive na raiz do repositório do GitHub para que o agente consiga trabalhar também pelo celular. A versão da main é a referência.

## Passo 0: sincronizar a memória (antes de qualquer outra coisa)
Os arquivos importados acima foram lidos na abertura da sessão e podem estar desatualizados. Antes de executar o pedido:
1. `git fetch origin main`
2. `git status -sb` e `git diff HEAD origin/main --stat -- CLAUDE.md MEMORIA.md CONTEXTO.md`
3. Se a main do GitHub tem commits novos: `git pull --ff-only origin main` e depois RELEIA `MEMORIA.md` e `CONTEXTO.md` do disco. Siga a versão relida, não a do início da sessão.
4. Se há alterações locais não commitadas nesses arquivos, ou o pull não é fast-forward (histórico divergiu): PARE. Mostre o que difere e pergunte qual versão vale. Não sobrescreva nada.
5. Se o GitHub estiver inacessível: avise que não foi possível conferir e siga com a cópia local, sinalizando isso no resumo final.
6. Se os arquivos de memória ainda não estiverem no repositório (migração em andamento): avise e proponha commitá-los, junto com o `.vercelignore` que impede a Vercel de publicar CLAUDE.md, MEMORIA.md e CONTEXTO.md.
Só depois do passo 0 comece a tarefa.

## Fluxo em toda tarefa
1. A raiz deste repositório é o próprio app: `index.html`, `sw.js`, `vercel.json`, `api/`, `lib/`, `tools/`. Trabalhe só dentro do repositório.
2. Mudança visual ou de funcionalidade: descreva ou mostre um mockup e ESPERE aprovação antes de editar.
3. Depois de editar, verifique antes de dizer que terminou:
   - rode `tools/checar-cores.sh`;
   - confira que o `index.html` não tem erro de sintaxe JS (extraia o `<script>` e rode `node --check`);
   - revise o fluxo mexido pensando em dados completos (cartões, recorrentes, pagos, parcelas), não só dados mínimos.
4. NUNCA faça `git push` sem o usuário autorizar nesta conversa (a Vercel publica a main sozinha). Sem criar branches: trabalhar direto na main.
5. Ao final, atualize a memória para ela melhorar: `CONTEXTO.md` (o que mudou, pendências novas, data e commit) e, se surgir regra fixa nova, `MEMORIA.md`. Mantenha os dois curtos: resuma histórico antigo em vez de acumular. Os arquivos de memória sobem no mesmo commit/push da mudança, para o celular e o PC partirem do mesmo estado.
6. Nunca escreva segredos (chaves, tokens, conteúdo de variáveis de ambiente) em arquivo do repositório. Eles ficam só nas variáveis da Vercel.
7. Resposta final: resumo curto do que mudou e por quê (o usuário está aprendendo), e a oferta de subir na main.
