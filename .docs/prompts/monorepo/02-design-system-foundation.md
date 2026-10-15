# Prompt 2: Fundação do Design System

Analisar a imagem de referência, extrair os design tokens e montar o design system compartilhado com shadcn/ui em `packages/ui`, usado pelos três apps web (PRD §6.1, §6.4).

Pré-requisito: [01-config-projeto](01-config-projeto.md) concluído (monorepo, `packages/ui` e os três apps Next existem).

## Entrada

[CAPTURA DE TELA DO DRIBBBLE, BEHANCE OU OUTRA REFERÊNCIA DE DESIGN]

## Fluxo

### 1. Analisar o design

Identificar ou inferir a partir da imagem:

**Cores:**

- Cor primária/da marca → escala completa (50–900)
- Neutros/cinzas → escala completa (50–900)
- Cores semânticas (sucesso, erro, alerta, informação)
- **Cores de domínio:** ganho e perda (resultado de trade, curva de patrimônio, calendário) e risco da conta de mesa (em dia, em risco, violada)
- Fundo e superfícies
- Bordas

**Tipografia:**

- Família (sans-serif, serif, monoespaçada)
- **Numérica:** fonte com algarismos tabulares (`font-variant-numeric: tabular-nums`) para preços, resultados e métricas — colunas de número precisam alinhar
- Tamanhos e pesos de títulos
- Tamanhos do texto corrido

**Espaçamento e raio:**

- Ritmo de espaçamento (compacto, normal, folgado) — o app do Trader tem tabelas densas de trades
- Estilo de raio (reto, arredondado, pílula)

**Sombras:**

- Estilo (nenhuma, sutil, marcada)

### 2. Inicializar o shadcn no monorepo

O shadcn trabalha em monorepo com um `components.json` em `packages/ui` e um em cada app; os componentes são instalados em `packages/ui/src/components` e importados pelos apps. Consultar o Context7 (`/shadcn-ui/ui`, tópico "monorepo") antes de rodar, porque o CLI muda.

```bash
pnpm dlx shadcn@latest init
```

Rodar em `packages/ui` e em cada app (`apps/web`, `apps/web-admin`, `apps/web-marketing`), com:

- Estilo: padrão
- Cor base: Neutral (será sobrescrita pelos tokens)
- Variáveis CSS: sim
- Aliases dos apps apontando para `@hypomna/ui` (confirmar o nome real do workspace)

### 3. Gerar e aplicar o `globals.css`

Os tokens vivem num único arquivo, `packages/ui/src/styles/globals.css`, importado pelo layout raiz de cada app. Nenhum app redefine token.

```css
@import 'tailwindcss';

:root {
  /* === BASE === */
  --background: [fundo da página extraído];
  --foreground: [cor do texto extraída];

  /* === CARD === */
  --card: [fundo do card];
  --card-foreground: [texto do card];

  /* === POPOVER / DROPDOWN / TOOLTIP === */
  --popover: [igual ao card ou branco];
  --popover-foreground: [igual a card-foreground];

  /* === PRIMARY (cor da marca) === */
  --primary: [primária extraída];
  --primary-foreground: [branco ou escuro, conforme contraste];

  /* === SECONDARY === */
  --secondary: [cinza claro ou primária esmaecida];
  --secondary-foreground: [texto escuro];

  /* === MUTED === */
  --muted: [fundo cinza claro];
  --muted-foreground: [texto cinza médio];

  /* === ACCENT === */
  --accent: [igual à secondary ou leve tom];
  --accent-foreground: [texto escuro];

  /* === DESTRUCTIVE === */
  --destructive: [vermelho de erro];
  --destructive-foreground: [branco];

  /* === BORDAS E INPUTS === */
  --border: [borda extraída];
  --input: [borda um pouco mais escura para inputs];
  --ring: [primária, para o anel de foco];

  /* === RAIO === */
  --radius: [raio extraído, ex.: 0.5rem];

  /* === GRÁFICOS === */
  --chart-1: [primária];
  --chart-2: [complementar];
  --chart-3: [variação];
  --chart-4: [variação];
  --chart-5: [variação];

  /* === SIDEBAR === */
  --sidebar: [fundo da sidebar];
  --sidebar-foreground: [texto da sidebar];
  --sidebar-primary: [primária];
  --sidebar-primary-foreground: [branco];
  --sidebar-accent: [accent];
  --sidebar-accent-foreground: [texto escuro];
  --sidebar-border: [borda];
  --sidebar-ring: [primária];

  /* === SEMÂNTICAS === */
  --success: [verde];
  --success-foreground: [branco];
  --warning: [amarelo/laranja];
  --warning-foreground: [escuro, para contraste];
  --info: [azul];
  --info-foreground: [branco];

  /* === DOMÍNIO: RESULTADO DE TRADE === */
  --gain: [verde do ganho];
  --gain-foreground: [texto sobre ganho];
  --loss: [vermelho da perda];
  --loss-foreground: [texto sobre perda];
  --breakeven: [neutro do zero a zero];

  /* === DOMÍNIO: STATUS DA CONTA DE MESA === */
  --risk-ok: [em dia];
  --risk-warning: [em risco];
  --risk-violated: [violada];
}

.dark {
  /* Valores invertidos para o modo escuro — todas as variáveis acima */
  --background: [fundo escuro];
  --foreground: [texto claro];
  /* ... */
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-success: var(--success);
  --color-success-foreground: var(--success-foreground);
  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);
  --color-info: var(--info);
  --color-info-foreground: var(--info-foreground);
  --color-gain: var(--gain);
  --color-gain-foreground: var(--gain-foreground);
  --color-loss: var(--loss);
  --color-loss-foreground: var(--loss-foreground);
  --color-breakeven: var(--breakeven);
  --color-risk-ok: var(--risk-ok);
  --color-risk-warning: var(--risk-warning);
  --color-risk-violated: var(--risk-violated);
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family:
    [fonte extraída],
    sans-serif;
}
```

### 4. Instalar a fonte

Se uma Google Font corresponder ao design, carregá-la com `next/font` no layout raiz de cada app, expondo-a como variável CSS consumida pelo `globals.css` de `packages/ui`. O `lang` do `<html>` vem do idioma resolvido pelo `next-intl` (`pt-BR`, `en` ou `es`), nunca fixo.

```tsx
import { Inter } from 'next/font/google'; // ou a fonte recomendada

const font = Inter({ subsets: ['latin'], variable: '--font-sans' });
```

### 5. Instalar os componentes de demonstração

Da raiz, apontando para um app (os arquivos vão para `packages/ui`):

```bash
pnpm dlx shadcn@latest add button card badge alert radio-group table -c apps/web
```

### 6. Configurar a navegação do styleguide

O styleguide é ferramenta de desenvolvimento e fica só em `apps/web`, fora do build de produção (rota desabilitada quando `NODE_ENV === 'production'`). Criar `src/app/styleguide/navigation.ts` (dentro do segmento de locale, se o app usar um):

```ts
export interface NavItem {
  labelKey: string;
  href: string;
}

export interface NavSection {
  titleKey: string;
  items: NavItem[];
}

export const navigation: NavSection[] = [
  {
    titleKey: 'styleguide.nav.foundation',
    items: [{ labelKey: 'styleguide.nav.tokens', href: '/styleguide' }],
  },
  {
    titleKey: 'styleguide.nav.components',
    items: [
      // Componentes adicionados pelos próximos prompts
    ],
  },
];
```

Os rótulos são chaves do catálogo `styleguide` em `packages/i18n`, nos três idiomas: nenhum texto de UI escrito direto no código (`.claude/rules/i18n.md`).

### 7. Criar o layout do styleguide com sidebar

`src/app/styleguide/layout.tsx`, lendo a navegação acima e traduzindo as chaves com `next-intl`. Sidebar fixa (`w-64`, `bg-card`, `border-r`), item ativo com `bg-primary text-primary-foreground`, conteúdo deslocado pela largura da sidebar. Componentes como arrow functions e sem `else` (`.claude/rules/typescript.md`, `.claude/rules/react.md`).

### 8. Criar a página do styleguide

`src/app/styleguide/page.tsx`, com TODOS os tokens numa só página:

- **Paleta** — todas as cores como amostras, com o nome da variável CSS
- **Escala primária** — 50 a 900
- **Escala de cinzas** — 50 a 900
- **Semânticas** — sucesso, alerta, erro, informação
- **Domínio** — ganho, perda, zero a zero e os três status de conta de mesa, cada um **com ícone ou sinal** além da cor (PRD §7, acessibilidade: cor nunca é o único indicador)
- **Números** — valores monetários de exemplo em tabela, com algarismos tabulares, formatados pelos helpers de `packages/i18n` a partir de strings decimais (nunca `number`), nos três idiomas
- **Tipografia** — títulos e texto corrido
- **Raio** — exemplos de cada tamanho
- **Sombras** — exemplos
- **Componentes** — Button, Card, Badge, Alert, Radio Group e Table usando os tokens
- **Alternância de tema** — pré-visualização clara e escura

## Estrutura de diretórios

```
packages/ui/
└── src/
    ├── styles/
    │   └── globals.css       # tokens (fonte única)
    └── components/           # componentes do shadcn

apps/web/src/app/
└── styleguide/
    ├── layout.tsx            # layout com sidebar
    ├── navigation.ts         # navegação (editável pelos próximos prompts)
    ├── page.tsx              # todos os tokens
    └── components/
        └── [name]/
            └── page.tsx      # componentes individuais (próximos prompts)

packages/i18n/
└── [pt-BR | en | es]/styleguide.*  # rótulos do styleguide
```

## Saída

- shadcn inicializado em `packages/ui` e nos três apps
- `packages/ui/src/styles/globals.css` com os tokens completos, claro e escuro, importado pelos três apps
- Fonte carregada no layout de cada app
- Componentes de demonstração instalados (button, card, badge, alert, radio-group, table)
- Styleguide navegável em `apps/web`, só em desenvolvimento
- Chaves do styleguide em `pt-BR`, `en` e `es`, com a verificação de chaves passando

---

## Resumo do design (entregar também)

Depois da configuração, resumir:

- **Cor primária:** [hex e nome]
- **Ganho / perda:** [hex de cada um e o contraste medido]
- **Fonte:** [nome, e se tem algarismos tabulares]
- **Estilo:** [ex.: "Minimalista moderno", "Terminal financeiro", "Suave"]
- **Raio:** [ex.: "Arredondado 8px", "Reto", "Pílula"]
- **Sensação geral:** [descrição curta]

---

## Notas

- Se as cores não estiverem claras na imagem, inferir de forma razoável.
- Gerar escalas harmônicas com teoria das cores.
- Contraste WCAG 2.2 AA (PRD §7): 4,5:1 para texto, 3:1 para elementos de interface, nos dois temas.
- Ganho e perda precisam ser distinguíveis também por quem tem daltonismo vermelho-verde; validar e, se preciso, ajustar matiz e luminosidade.
- Cores de gráfico visualmente distintas; a biblioteca de gráficos ainda não foi escolhida (PRD, questão 10.8), então os tokens não dependem dela.
- Na dúvida, usar os padrões do shadcn.
- Nunca rodar `pnpm run dev` para conferir; verificar com `check-types`, testes de componente e, se o usuário quiser ver, pedir que ele suba o app.
