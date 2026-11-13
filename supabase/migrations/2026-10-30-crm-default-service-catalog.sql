begin;

-- Keep the persisted service catalog aligned with the application's fallback
-- when an organization has no custom services configured.
create or replace function public.default_service_catalog()
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select jsonb_build_array(
    jsonb_build_object('id', 'service-barbearia', 'name', 'Barbearia', 'category', 'Barbearia', 'price', 0, 'duration', 30, 'commissionKey', 'barbearia', 'isActive', true, 'sortOrder', 1),
    jsonb_build_object('id', 'service-manutencao', 'name', 'Manutenção', 'category', 'Barbearia', 'price', 0, 'duration', 30, 'commissionKey', 'manutencao', 'isActive', true, 'sortOrder', 2),
    jsonb_build_object('id', 'service-manicure', 'name', 'Manicure', 'category', 'Salão de Beleza', 'price', 0, 'duration', 60, 'commissionKey', 'manicure', 'isActive', true, 'sortOrder', 3),
    jsonb_build_object('id', 'service-protese', 'name', 'Prótese Capilar', 'category', 'Prótese', 'price', 0, 'duration', 120, 'commissionKey', 'protese', 'isActive', true, 'sortOrder', 4),
    jsonb_build_object('id', 'service-mentoria', 'name', 'Mentoria', 'category', 'Prótese', 'price', 0, 'duration', 120, 'commissionKey', 'mentoria', 'isActive', true, 'sortOrder', 5)
  );
$$;

create or replace function public.ensure_default_service_catalog()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (
    case
      when jsonb_typeof(coalesce(new.payload, '{}'::jsonb)->'services') = 'array'
        then jsonb_array_length(new.payload->'services') = 0
      else true
    end
  ) then
    new.payload := jsonb_set(
      coalesce(new.payload, '{}'::jsonb),
      '{services}',
      public.default_service_catalog(),
      true
    );
  end if;
  return new;
end;
$$;

revoke all on function public.default_service_catalog() from public, anon, authenticated;
revoke all on function public.ensure_default_service_catalog() from public, anon, authenticated;

drop trigger if exists organization_settings_default_services on public.organization_settings;
create trigger organization_settings_default_services
before insert or update of payload on public.organization_settings
for each row execute function public.ensure_default_service_catalog();

update public.organization_settings settings
   set payload = jsonb_set(
         coalesce(settings.payload, '{}'::jsonb),
         '{services}',
         public.default_service_catalog(),
         true
       ),
       updated_at = now()
 where case
   when jsonb_typeof(coalesce(settings.payload, '{}'::jsonb)->'services') = 'array'
     then jsonb_array_length(settings.payload->'services') = 0
   else true
 end;

insert into public.schema_metadata (key, value)
values ('app_schema_version', '2026-10-30.3')
on conflict (key) do update
  set value = excluded.value, updated_at = now();

notify pgrst, 'reload schema';
commit;
