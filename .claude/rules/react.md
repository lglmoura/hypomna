---
paths:
  - "apps/web/**/*"
  - "apps/web-admin/**/*"
  - "apps/web-marketing/**/*"
  - "packages/ui/**/*"
---

# Next.js: componentes, formulários e estilo

Vale para `apps/web`, `apps/web-admin` e `apps/web-marketing` (Next.js App Router, React Server Components primeiro, shadcn/ui + Tailwind; PRD §6.4). Os apps usam o alias `@/*` → `src/*`. Texto de UI sempre traduzido (`i18n.md`); consumo da API em `api.md`; sessão em `auth-client.md`.

## Princípios

- **NUNCA** regra de negócio na interface: métricas, resultado de trade, status de mesa e qualquer cálculo monetário vêm prontos da API. O cliente só formata o valor canônico (string decimal, instante UTC) com `Intl` (RF-64).
- **NUNCA** use `number` para operar valor monetário no cliente (nem somar, nem arredondar). Exibir é formatar a string decimal recebida.
- Cada app atende um único papel e nunca renderiza, nem parcialmente, tela de outro papel (PRD §1.5, princípio 7). `apps/web-admin` mostra só metadados de tenant, **NUNCA** trades, notas, capturas ou métricas (princípio 6).

## Componentes

- Use componentes da biblioteca shadcn/ui o máximo possível ao criar ou modificar componentes. O design system compartilhado pelos três apps fica em `packages/ui`; componente reaproveitável entre apps vai para lá, não é copiado.
- Antes de criar um novo componente, **SEMPRE** verifique (MCP do shadcn/ui, ou Context7) se já existe um componente do shadcn/ui que sirva. Caso exista, instale-o. Antes de montar uma página, reutilize o que já existe em `packages/ui` e em `src/components/`.
- **NUNCA** crie mais de um componente no mesmo arquivo. Cada componente deve ter seu próprio arquivo.
- **SEMPRE** use o componente `Button` do shadcn/ui para botões. **NUNCA** use `<button>` nativo diretamente.
- Gráficos usam uma única biblioteca para todo o produto (PRD, questão 10.8). Não introduza outra.

## Formulários

- **SEMPRE** React Hook Form + Zod, com os schemas de `packages/contracts` (os mesmos da API), e o componente `Form` do shadcn/ui.
- Mensagens de validação vêm das chaves de tradução, nunca de texto literal no schema do formulário.
- Campos de valor monetário e preço aceitam o separador decimal do idioma do usuário e enviam a string decimal canônica (RF-64). Campos de data e hora consideram o fuso do usuário e enviam ISO 8601 UTC.

Exemplo de formulário:

```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { createTradingAccountBody } from "@hypomna/contracts";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import type { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

type FormValues = z.infer<typeof createTradingAccountBody>;

export const CreateAccountForm = () => {
  const t = useTranslations("accounts.form");
  const form = useForm<FormValues>({
    resolver: zodResolver(createTradingAccountBody),
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("name")}</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit">{t("submit")}</Button>
      </form>
    </Form>
  );
};
```

## Estilização e acessibilidade

- **NUNCA** use cores hard-coded do Tailwind (`text-white`, `bg-black`, `bg-[#2b54ff]`, `bg-[oklch(...)]` etc.). **SEMPRE** use as cores do tema (`text-foreground`, `bg-primary`, `border-border` etc.). Caso a cor necessária não exista, crie a variável CSS no tema seguindo o padrão existente, depois de conferir na documentação de theming do shadcn/ui se ela é mesmo necessária.
- Ganho e perda têm cores próprias do tema, mas a cor **NUNCA** é o único indicador: sempre há sinal ou ícone junto (WCAG 2.2 AA, PRD §7).
- Layout responsivo, desktop primeiro e utilizável no celular (`apps/web`, PRD §1.4).

## Autenticação

Detalhes em `auth-client.md`. Resumo:

- **NUNCA** use middleware (`middleware.ts`) para autenticação ou autorização. **SEMPRE** verifique a sessão na própria página.
- `apps/web-marketing` **NUNCA** verifica sessão e não tem `authClient`; consome só `/public/*`.

## Imagens

- **SEMPRE** use o componente `Image` do Next para renderizar imagens. Capturas de gráfico vêm por URL assinada de curta duração; não as guarde em cache do cliente além da validade da URL.
