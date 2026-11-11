# Meu Caixa — MEMÓRIA (regras fixas)
Atualizado em 11/11/2026. Espelha a memória do Claude e serve para colar nas instruções do projeto. Histórico e detalhes técnicos ficam no CONTEXTO.md.

## Como o Claude deve trabalhar comigo
- Respostas diretas e técnicas; explicar o porquê das decisões (estou aprendendo sistemas e análise de dados).
- Mudança visual ou de funcionalidade: mostrar mockup/protótipo e esperar minha aprovação antes de implementar.
- Entregar o index.html atualizado + resumo do que mudou. Sempre oferecer subir direto no GitHub.
- SEMPRE perguntar antes de subir na main. Se eu autorizar tudo, pode subir direto.
- NÃO criar branches: trabalhar direto na main.
- A versão do GitHub (main) é a mais atual, pois eu também edito. Partir sempre dela.
- Depois de subir na main, eu testo no celular.
- Testar com dados completos (cartões, recorrentes, pagos, parcelas) antes de entregar, não só dados mínimos.

## Memória no GitHub (para eu poder pedir alterações pelo celular)
- CLAUDE.md, MEMORIA.md e CONTEXTO.md vivem no repositório do GitHub, e a main é a referência. Assim o agente na nuvem (celular) lê a memória antes de agir.
- A memória deve continuar se atualizando para melhorar: ao fim de cada tarefa, atualizar CONTEXTO.md (e MEMORIA.md se surgir regra fixa) e subir no mesmo commit da mudança.
- Ao rodar um comando pelo computador, o agente primeiro compara a memória local com a do GitHub (fetch + pull). Se a do PC estiver desatualizada, atualiza e relê antes de seguir. Se houver conflito (alterações locais ou histórico divergente), para e pergunta.
- A Vercel não deve publicar esses arquivos: manter CLAUDE.md, MEMORIA.md e CONTEXTO.md no .vercelignore.
- Nunca colocar segredos (chaves, tokens) no repositório; ficam só nas variáveis da Vercel.

## Projeto
- Sistema de finanças pessoais, arquivo único index.html. GitHub: Ita-013/Meu-sistema-financeiro (main). Deploy na Vercel. Dados no Firebase (login por e-mail + Firestore). Banco via Pluggy (api/pluggy.js).
- Push diário às 9h (Brasília): vencimentos, atrasadas e novas movimentações para conciliar, com o app fechado.

## Regras de design
- Todo delete: lixeira vermelha pequena padrão, sempre com confirmação.
- Em blocos de orçamento, o valor orçado fica abaixo ou à direita do realizado.
- Todo campo de edição ou cadastro (lançamento, caixinha, compromisso, conciliação e qualquer tela nova) tem um título fixo acima do campo. Placeholder é só exemplo e nunca substitui o título. Campo opcional leva "(opcional)" no título, e a unidade vai entre parênteses quando couber, como em "Valor (R$)".
- "Novo compromisso" só na aba Lançamentos; painel do topo só na aba Resumo.
- Tema padrão escuro. Tema rosa liberado por e-mail, só no código, preservado nas atualizações.
- Resumo: fatura do cartão entra no A pagar, não nas Despesas.
- Pop-up não foca campo sozinho ao abrir (o teclado do celular não pode abrir sem eu tocar).

## Dados por conta
- Tudo que o app guarda no navegador (localStorage) e que vem de uma conta (Open Finance, push, etc.) deve levar o uid da conta ou ser apagado ao sair. Nunca mostrar dado de uma conta em outra no mesmo aparelho. Testar com duas contas no mesmo navegador.
