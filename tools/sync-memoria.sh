#!/bin/sh
# Passo 0 do CLAUDE.md numa chamada só: compara a memória local com a main do GitHub.
# Saída (primeira palavra): OK | ATUALIZADO | PARAR | SEM_GITHUB  (código de saída 2 = PARAR)
git fetch -q origin main 2>/dev/null || { echo "SEM_GITHUB: seguir com a cópia local e avisar no resumo final"; exit 0; }
if [ -n "$(git status --porcelain -- CLAUDE.md MEMORIA.md CONTEXTO.md)" ]; then
  echo "PARAR: há alterações locais nos arquivos de memória"; git status -sb -- CLAUDE.md MEMORIA.md CONTEXTO.md; exit 2
fi
atras=$(git rev-list --count HEAD..origin/main); frente=$(git rev-list --count origin/main..HEAD)
if [ "$atras" = 0 ]; then
  if [ "$frente" = 0 ]; then echo "OK: em dia com a main"; else echo "OK: $frente commit(s) local(is) ainda sem push"; fi
  exit 0
fi
if [ "$frente" != 0 ]; then
  echo "PARAR: histórico divergiu ($atras atrás, $frente à frente)"; git log --oneline HEAD..origin/main | head -5; exit 2
fi
git pull -q --ff-only origin main && echo "ATUALIZADO: $atras commit(s) novo(s); RELEIA MEMORIA.md e CONTEXTO.md do disco" \
  || { echo "PARAR: o pull não foi fast-forward"; exit 2; }
