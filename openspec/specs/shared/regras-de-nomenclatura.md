# Regras de Nomenclatura

Convenções globais de nomes de arquivos e diretórios. Podem ser referenciadas por qualquer spec. Nomes de código em inglês, seguindo o glossário do PRD (§11.1); ver também `.claude/rules/typescript.md`.

## Regra geral

- nomes de arquivos e diretórios em `kebab-case`, sempre minúsculas
- nomes devem indicar **responsabilidade**, não implementação
- quando fizer sentido, o sufixo deve explicitar o papel do arquivo
- não usar `PascalCase`, `camelCase` ou mistura de maiúsculas em diretórios

Exemplos de diretórios válidos: `shared`, `trades`, `prop-rules`, `trading-accounts`.

## Sufixos recomendados

| Sufixo                       | Uso                                                               |
| ---------------------------- | ----------------------------------------------------------------- |
| `*.entity.ts`                | entidades de domínio                                              |
| `*.vo.ts`                    | value objects                                                     |
| `*.policy.ts`                | políticas de domínio (ex.: regras de mesa)                        |
| `*.calculator.ts`            | calculadoras de domínio                                           |
| `*.repository.ts`            | contratos ou implementações de repositório                        |
| `*.use-case.ts`              | casos de uso                                                      |
| `*.service.ts`               | serviços de domínio ou serviços do Nest                           |
| `*.port.ts`                  | interfaces (portas) da camada `application`                       |
| `*.controller.ts`            | controllers                                                       |
| `*.guard.ts`                 | guards                                                            |
| `*.processor.ts`             | processors de fila (BullMQ)                                       |
| `*.parser.ts`                | parsers de importação (um por layout)                             |
| `*.factory.ts`               | fábricas para clientes, adapters, instâncias ou objetos complexos |
| `*.config.ts`                | arquivos de configuração                                          |
| `*.types.ts`                 | tipos auxiliares                                                  |
| `*.page.tsx`                 | páginas                                                           |
| `*.component.tsx`            | componentes                                                       |
| `*.context.tsx`              | contextos React e hooks associados                                |
| `*.provider.tsx`             | providers de composição, wrappers globais, integração de runtime  |
| `*.hook.ts`                  | hooks                                                             |
| `*.spec.ts`                  | testes unitários (domínio e aplicação)                            |
| `*.test.ts(x)`               | testes de componente nos apps Next                                |
| `RF-<nn>.feature`            | cenários BDD do PRD (exceção ao `kebab-case`, `.claude/rules/testing.md`) |
| `RF-<nn>.steps.e2e-spec.ts`  | passos dos cenários na API                                        |
| `RF-<nn>.steps.test.ts(x)`   | passos dos cenários nos apps Next                                 |

### Exemplos aplicados

- `trade.entity.ts`
- `prop-firm-account.entity.ts`
- `money.vo.ts`
- `tick-size.vo.ts`
- `trailing-drawdown.policy.ts`
- `performance.calculator.ts`
- `trade.repository.ts`
- `import-trades-csv.use-case.ts`
- `file-storage.port.ts`
- `trades.controller.ts`
- `tenant.guard.ts`
- `trade-import.processor.ts`
- `ninjatrader-trades.parser.ts`
- `login.page.tsx`
- `trade-form.component.tsx`
- `use-trade-filters.hook.ts`
- `app.providers.tsx`
- `api-client.factory.ts`

## Exceções controladas

Nomes exigidos por ferramentas ou convenções externas mantêm o formato original. Exemplos: `README.md`, `SKILL.md`, `package.json`, `tsconfig.json`, `spec.md`, `page.tsx`/`layout.tsx` do App Router e os arquivos `RF-<nn>.*` dos cenários do PRD.

Fora dessas exceções, prefira sempre `kebab-case`.

## Regra de decisão

Se um nome estiver ambíguo, prefira a forma que deixe mais claro:

- o que o arquivo representa
- em que camada ele vive
- qual a responsabilidade principal
