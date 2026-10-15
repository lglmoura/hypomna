---
paths:
  - "apps/web/**/*"
  - "apps/web-admin/**/*"
  - "apps/web-marketing/**/*"
  - "packages/api-client/**/*"
---

# Consumo da API nos clientes (Orval e TanStack Query)

Contrato API↔clientes do PRD §6 e RF-80: o Orval gera o client tipado de `packages/api-client` a partir do OpenAPI de `apps/api` (`openapi.md`), com funções `fetch` e hooks TanStack Query. **NUNCA** escreva à mão uma chamada nem um tipo que o client gerado já cobre.

## Onde fica o client gerado

| App                  | Uso                                                                              |
| -------------------- | -------------------------------------------------------------------------------- |
| `apps/web`           | funções `fetch` em Server Components e hooks TanStack Query em Client Components |
| `apps/web-admin`     | idem, só com as rotas de `/admin/*`                                              |
| `apps/web-marketing` | só `/public/*` (ex.: `GET /public/plans`), em geração estática com revalidação   |

Se a função necessária não existir no client gerado, regenere o client a partir do OpenAPI; se continuar ausente, INTERROMPA a resposta e avise o usuário. O client regenerado é commitado, e o CI falha se ele divergir do OpenAPI (CA-RF80-1).

## Regras

- **EVITE** transformar páginas inteiras em Client Components. Prefira buscar dados em Server Components.
- No server-side, use as funções `fetch` geradas; no client-side, **SEMPRE** TanStack Query com os hooks gerados. **PRIORIZE** o dado do servidor como `initialData` do hook.
- Ao chamar o `authClient`, **NUNCA** o coloque dentro de `try/catch`: faça o destructuring do `error` do resultado e trate-o. Ex.: `const { error } = await authClient.changePassword({})`.
- Mutations: **SEMPRE** a variação síncrona (`mutate`) dos hooks gerados, tratando sucesso e erro em `onSuccess` e `onError`. Depois da mutation, invalide as queries afetadas com a `QueryKey` gerada.
- **NUNCA** envie `tenantId` em body, query ou path: o tenant vem da sessão no servidor (PRD §3.2).
- Erro da API tem o formato `{ error, code, message, details? }`. **SEMPRE** decida pelo `code` (contrato estável, `UPPER_SNAKE_CASE`, ex.: `VALIDATION_ERROR`, `NOT_FOUND`, `SUBSCRIPTION_REQUIRED`, `RATE_LIMITED`); `message` e `details[].message` já vêm no idioma do usuário e podem ser exibidos como fallback.
- `402 SUBSCRIPTION_REQUIRED` indica tenant `READ_ONLY`: a interface oferece leitura e exportação e leva à assinatura, sem esconder os dados. `429 RATE_LIMITED` respeita o `Retry-After`.
- Valores monetários chegam como string decimal e instantes em ISO 8601 UTC: o cliente só formata (`i18n.md`), nunca converte para `number` para calcular.
- Arquivos (capturas, CSV, exportações) sobem e descem por URL assinada emitida pela API, nunca por caminho montado no cliente.

Exemplo (mutation com `onSuccess` e `onError`):

```tsx
const t = useTranslations("profile");
const { mutate: updateLocale } = useUpdateMeLocale();

const onSubmit = (payload: UpdateLocaleBody) => {
  updateLocale(
    { data: payload },
    {
      onSuccess: () => {
        toast.success(t("localeUpdated"));
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      },
      onError: (error) => {
        if (error.response?.data.code === "VALIDATION_ERROR") {
          return toast.error(t("localeNotSupported"));
        }
        toast.error(error.response?.data.message ?? t("genericError"));
      },
    },
  );
};
```

## Data fetching: server-side e client-side

```tsx
// page.tsx (Server Component)
import { getMe } from "@hypomna/api-client/fetch";

const Page = async () => {
  const data = await getMe();

  return <ClientComponent data={data} />;
};

export default Page;

// client-component.tsx (Client Component)
import { useGetMe } from "@hypomna/api-client/react-query";

export const ClientComponent = (props: Props) => {
  const result = useGetMe({ query: { initialData: props.data } });

  return <></>;
};
```

Os caminhos de import (`@hypomna/api-client/fetch` e `@hypomna/api-client/react-query`) valem a partir da configuração do Orval no pacote; se ela usar outros, siga a do pacote e atualize este arquivo.
