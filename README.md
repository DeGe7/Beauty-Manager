# Beauty Manager

Sistema SaaS de gestão para barbearias, salões de beleza e negócios de prótese capilar.

O projeto combina operação diária, gestão financeira e controle de acesso multiestabelecimento em uma interface dark com identidade dourada.

## Destaques

- Dashboard geral e visão individual por profissional
- Agenda com bloqueios, conflitos e status de atendimento
- Clientes, histórico de visitas, origem e campanhas
- Profissionais, convites e permissões editáveis por cargo
- Produtos, estoque, reposição e baixa atômica via RPC
- Vendas de prótese e sessões de mentoria
- Planos, assinantes e acompanhamento de mensalidades
- Financeiro com receitas, despesas e relatórios
- Avatar e logo em Supabase Storage privado
- RLS por organização e restrição operacional por profissional
- Layout responsivo para desktop e mobile

## Stack

- React + TypeScript + Vite
- Tailwind CSS e Radix UI
- Supabase Auth, PostgreSQL, RLS, RPCs e Storage
- pnpm workspaces
- Playwright para smoke tests do frontend
- Express para health check e diagnóstico do ambiente

## Arquitetura

```text
artifacts/barber-manager/   Aplicação web principal
artifacts/api-server/       Health check e diagnóstico
lib/                        Pacotes compartilhados do workspace
supabase/schema.sql         Schema, triggers, RLS, RPCs e Storage
supabase/tests/             Testes SQL de controle de acesso
```

O Supabase é a fonte única de dados do produto. A organização e o profissional atual são derivados da sessão e dos vínculos persistidos no banco; o navegador não define `organization_id`, `role` ou `professional_id`.

## Executar localmente

Requisitos: Node.js 20+ e pnpm.

```bash
pnpm install
pnpm --filter @workspace/barber-manager run dev
```

O app precisa destas variáveis de ambiente:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

O schema fonte está em `supabase/schema.sql` e deve ser aplicado no SQL Editor do projeto Supabase.

## Verificações

```bash
pnpm run typecheck
PORT=23945 BASE_PATH=/ pnpm --filter @workspace/barber-manager run build
pnpm run e2e:typecheck
pnpm run e2e:validate
E2E_START_SERVER=true pnpm e2e
```

A suíte E2E em `e2e/` cobre guards de autenticação, login, onboarding, convites, permissões, CRUD e responsividade. Os fluxos que exigem contas ou tokens ficam condicionais às variáveis de uma organização de teste isolada e nunca devem usar credenciais de produção.

## Segurança

- Nunca commitar arquivos `.env`, chaves ou tokens.
- As políticas de acesso vivem no banco e devem ser validadas junto com as telas.
- Convites persistem apenas o hash do token, com expiração, revogação e uso único.
- Dados privados do Storage são lidos por caminho persistido e URL assinada.

## Status

O produto está em fase de validação final dos fluxos autenticados, matriz CRUD por cargo, isolamento entre organizações e smoke test de produção.