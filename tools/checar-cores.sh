#!/bin/sh
# Procura cores escritas direto no CSS fora dos blocos de tema (:root...).
# Toda cor nova deve ser uma variável (var(--...)) definida nos blocos de tema,
# senão o tema rosa (e qualquer outro) não consegue mudá-la.
# Uso: sh tools/checar-cores.sh [index.html]
# Ignora o branco puro (#fff) e o vermelho do botão de excluir (#BE123C).
f="${1:-index.html}"
awk '
  function tem_cor(l,    len, nxt) {
    while (match(l, /#[0-9a-fA-F]+/)) {
      len = RLENGTH - 1
      nxt = substr(l, RSTART + RLENGTH, 1)
      if ((len == 3 || len == 4 || len == 6 || len == 8) && nxt !~ /[0-9a-zA-Z_-]/) return 1
      l = substr(l, RSTART + RLENGTH)
    }
    return 0
  }
  /<style>/ { s = 1; next }
  /<\/style>/ { s = 0 }
  s && /^:root/ { t = 1 }
  s && !t {
    l = $0
    gsub(/#[fF][fF][fF]([^0-9a-zA-Z_-]|$)/, " ", l)
    gsub(/#[bB][eE]123[cC]/, " ", l)
    if (tem_cor(l) || l ~ /rgba?\(/) { print FILENAME ":" NR ": " $0; bad = 1 }
  }
  t && /}/ { t = 0 }
  END { exit bad }
' "$f"
if [ $? -eq 0 ]; then echo "ok: nenhuma cor fixa fora dos blocos de tema"; else echo "ATENCAO: troque as cores acima por variaveis" >&2; exit 1; fi
