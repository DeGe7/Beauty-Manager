# Beauty Manager

Sistema brasileiro de gestão para barbearias, salões de beleza e prótese capilar.

## Run & Operate

- `pnpm --filter @workspace/barber-manager run dev` — executar o web app
- `pnpm --filter @workspace/barber-manager run typecheck` — verificar o TypeScript do web app
- `pnpm --filter @workspace/barber-manager run build` — gerar o build de produção
- `pnpm --filter @workspace/api-server run typecheck` — verificar o servidor de health/diagnóstico
- O schema fonte está em `supabase/schema.sql` e deve ser aplicado no SQL Editor do projeto Supabase.
- O web app precisa de `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.

## Stack

- pnpm workspaces, Node.js, TypeScript, React, Vite e Tailwind
- Supabase Auth para identidade, sessão e recuperação de acesso
- Supabase PostgreSQL com RLS por estabelecimento
- Supabase Storage para avatares e logos
- Express somente para health check e diagnóstico do ambiente

## Onde as coisas vivem

- `artifacts/barber-manager/src/auth` — autenticação, sessão e onboarding
- `artifacts/barber-manager/src/data/api.ts` — acesso Supabase tipado usado pelas telas
- `artifacts/barber-manager/src/data/store.tsx` — estado da aplicação e mutações otimistas
- `supabase/schema.sql` — tabelas, RLS, Storage e RPCs de operações atômicas
- `artifacts/api-server/src` — servidor mínimo de diagnóstico; não contém CRUD de negócio

## Decisões de arquitetura

- Supabase é a única fonte de dados do produto; o cliente usa a sessão Supabase e nunca headers de papel/profissional.
- Cada registro de negócio pertence a uma organização e é protegido por RLS.
- O primeiro usuário autenticado cria uma organização através de `bootstrap_organization` e recebe o papel de gestor.
- Estoque é alterado por RPC para evitar corrida entre vendas concorrentes.
- O banco PostgreSQL legado não é apagado automaticamente; os dados precisam ser validados antes de qualquer descarte.

## Produto

O app inclui dashboard, agenda, controle diário, clientes, profissionais, vendas, estoque, planos, financeiro, comunicação, permissões e configurações com tema escuro/dourado.

## Gotchas

- Sem o schema Supabase aplicado, o login continua acessível, mas o onboarding e as telas protegidas informarão que o banco ainda não está configurado.
- O build do artefato exige que o workflow forneça `PORT` e `BASE_PATH`; use o workflow do artefato em vez de executar o Vite sem essas variáveis.
- Em produção, login e cadastro exigem `VITE_TURNSTILE_SITE_KEY`; a secret key correspondente deve ficar somente na configuração CAPTCHA do Supabase Auth.
- O Supabase Auth aplica o rate limit dos endpoints de autenticação; a interface também bloqueia novas tentativas por 60 segundos após receber um erro de limite.

## Baseline congelado

- O baseline da fonte aprovado do Supabase está documentado em `supabase/BASELINE.md`; a paridade de produção pendente também está registrada ali.
- `supabase/schema.sql` permanece a fonte única do schema e está marcado como
  `app_schema_version = 2026-09-04`.
- A partir deste ponto, mudanças em tabelas, colunas, enums, RPCs, triggers,
  RLS, Storage ou contratos exigem planejamento explícito e nova validação
  completa antes de serem aplicadas em qualquer ambiente.