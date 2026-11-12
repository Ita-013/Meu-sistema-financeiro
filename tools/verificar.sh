#!/bin/sh
# Verificação depois de editar, numa chamada: sintaxe JS do index.html + cores fixas no CSS.
# Uso: sh tools/verificar.sh   (precisa de node)
cd "$(dirname "$0")/.." || exit 1
tmp="${TMPDIR:-/tmp}/meu-caixa-check.js"
node -e "const fs=require('fs');const s=fs.readFileSync('index.html','utf8');fs.writeFileSync(process.argv[1],[...s.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n'))" "$tmp" \
  && node --check "$tmp" && echo "ok: sintaxe JS" || { echo "ERRO: sintaxe JS (rode: node --check $tmp)"; exit 1; }
sh tools/checar-cores.sh 2>&1 | cut -c1-110 | tail -4
