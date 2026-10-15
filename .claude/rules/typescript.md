# TypeScript e estilo de código

Convenção de qualidade de código do PRD §7 ("Precisão monetária", "Object Calisthenics", "Imutabilidade", "Nomenclatura", "Datas e fusos") e dos princípios de engenharia do `README.md`. Vale para todos os apps e pacotes.

- **SEMPRE** TypeScript strict e ESM. **NUNCA** use `any`; modele o tipo, use `unknown` com estreitamento ou o tipo inferido do schema Zod.
- Lint e formatação: ESLint + Prettier + `simple-import-sort`, com a config de `packages/eslint-config` (inclui as regras de Object Calisthenics e de fronteira de camadas). Não desative regra para fazer o código passar.
- Funções como arrow functions e early returns; **NUNCA** `else` (`no-else-return`).
- Escreva código limpo, conciso e fácil de manter, seguindo SOLID e Clean Code; DRY: quando houver duplicidade, extraia função ou componente reutilizável.
- Nomes em inglês e que revelam intenção (`calculateDailyDrawdown`, não `calcDD`; `isLoading`, `hasError`). Kebab-case em pastas e arquivos.
- Comentários: **NUNCA** comente o que o código já diz. Só entram um porquê não óbvio ou uma referência a RF/CA/§ do PRD quando ela ajuda a rastrear a decisão.

## Domínio e aplicação

- **Object Calisthenics** em `packages/domain` e na camada `application` da API: um nível de indentação por método (`max-depth: 1`), primitivos de domínio encapsulados em Value Objects, coleções de primeira classe, classes e métodos pequenos (limites de linhas por classe e de parâmetros por método no lint).
- **Imutabilidade:** Value Objects `readonly` e congelados; toda operação retorna nova instância, nunca altera a atual.
- **Dinheiro:** **NUNCA** `number` para valor monetário ou preço. Use `Money`/`Price` sobre decimal de precisão arbitrária (tipo nominal, garantido por lint). Arredondamento sempre explícito, `HALF_EVEN` só para exibição. Na fronteira (API e formulários) o valor trafega como string decimal.
- Preço e resultado de trade derivam de ticks e valor por tick do `Instrument`, nunca de constante solta no código.

## Datas e validação

- Instantes sempre em UTC (ISO 8601) no banco e na API; fusos IANA. **SEMPRE** `dayjs` com os plugins `utc` e `timezone`, encapsulado no `Clock`/`TradingCalendar` injetável. **NUNCA** `new Date()` nem `dayjs()` direto em regra de negócio.
- Validação com Zod; datas com `z.iso.date()` / `z.iso.datetime()`, nunca regex. Schemas compartilhados entre API e clientes ficam em `packages/contracts`.
