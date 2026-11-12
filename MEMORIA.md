# Meu Caixa — MEMÓRIA (regras fixas)
Só regras que valem sempre. Procedimento: CLAUDE.md. Contexto técnico e histórico: CONTEXTO.md.

## Como trabalhar comigo
- Respostas diretas e técnicas; explicar o porquê das decisões (estou aprendendo sistemas e análise de dados).
- A main do GitHub é a versão mais atual, pois eu também edito: partir sempre dela.
- Depois de subir na main, eu testo no celular.
- A Vercel não publica CLAUDE.md, MEMORIA.md, CONTEXTO.md nem tools/ (ficam no `.vercelignore`).

## Regras de design
- Todo delete: lixeira vermelha pequena padrão, sempre com confirmação.
- Em blocos de orçamento, o valor orçado fica abaixo ou à direita do realizado.
- Todo campo de edição ou cadastro (lançamento, caixinha, compromisso, conciliação e qualquer tela nova) tem título fixo acima do campo. Placeholder é só exemplo e nunca substitui o título. Campo opcional leva "(opcional)" no título; unidade entre parênteses quando couber, como "Valor (R$)".
- "Novo compromisso" só na aba Lançamentos; painel do topo só na aba Resumo.
- Tema padrão escuro; tema rosa liberado por e-mail, só no código, preservado nas atualizações.
- Resumo: fatura do cartão entra no A pagar, não nas Despesas.
- Pop-up não foca campo sozinho ao abrir (o teclado do celular não pode abrir sem eu tocar).
- Campos de valor (R$): só números, com máscara de moeda (digita só dígitos, entram pela direita: 2590 vira 25,90), sempre 2 casas decimais, teclado numérico (`MONEY` no index.html). Exceção: células da planilha de Orçamentos (aceitam negativo).
- Rótulo da data em lançamento: "Data do pagamento"; em compra no cartão, "Data da compra".

## Dados por conta
- Tudo que o app guarda no navegador (localStorage) e que vem de uma conta (Open Finance, push etc.) leva o uid da conta ou é apagado ao sair. Nunca mostrar dado de uma conta em outra no mesmo aparelho. Testar com duas contas no mesmo navegador.

## Acesso e segurança
- Cadastro público desligado: contas novas só por convite do administrador (`api/invite.js`, `ADMIN_UID` na Vercel). Não recolocar "Criar conta".
- Regras do Firestore: cada pessoa só lê e grava `users/{uid}` com o próprio uid; nenhuma outra coleção é aberta ao cliente.
- Segredos só nas variáveis da Vercel, nunca no repositório.
