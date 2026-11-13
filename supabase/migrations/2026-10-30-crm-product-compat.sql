begin;

-- Keep existing deployments compatible with product writes that include this
-- flag; products already in the catalog remain non-prosthesis by default.
alter table public.products
  add column if not exists is_prosthesis_capillary boolean not null default false;

insert into public.schema_metadata (key, value)
values ('app_schema_version', '2026-10-30.2')
on conflict (key) do update
  set value = excluded.value, updated_at = now();

notify pgrst, 'reload schema';
commit;
