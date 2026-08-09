-- Alternativa ao script PowerShell.
-- 1) Cadastre primeiro a conta pelo site.
-- 2) Troque o e-mail tÃ©cnico abaixo pelo nome usado no cadastro.
--    Ex.: "Pedro Mestre" -> pedro.mestre@example.com
update public.profiles
set role = 'master', updated_at = now()
where id = (
  select id from auth.users
  where email = 'pedro.mestre@example.com'
);
