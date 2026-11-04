begin;

grant insert on public.expenses to authenticated;

drop policy if exists expenses_insert_reception on public.expenses;
create policy expenses_insert_reception on public.expenses
for insert to authenticated
with check (
  organization_id = public.current_organization_id()
  and public.current_user_role() = 'recepcao'
  and public.has_permission('controle')
);

insert into public.schema_metadata (key, value)
values ('app_schema_version', '2026-10-28.1')
on conflict (key) do update
  set value = excluded.value, updated_at = now();

notify pgrst, 'reload schema';

commit;
