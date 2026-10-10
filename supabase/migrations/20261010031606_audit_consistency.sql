-- Correções incrementais: preserva fichas, snapshots, chaves e assinaturas dos RPCs.
begin;

update public.system_attributes set name='Controle Amaldiçoado',
 description='Precisão e domínio sobre a própria Energia Amaldiçoada; não mede o tamanho da reserva.'
where key='cursed_control';
update public.system_skills set name='Defender' where key='defend';

create or replace function public.roll_pg_d20(p_mode text default 'normal', p_count int default 1)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare vals int[]:='{}'; i int; c int:=greatest(1,coalesce(p_count,1)); v int; chosen int;
 mode text:=coalesce(p_mode,'normal');
begin
  if mode not in ('normal','advantage','disadvantage') then raise exception 'Modo de rolagem inválido.'; end if;
  if mode='normal' then c:=1; else c:=greatest(2,c); end if;
  for i in 1..c loop v:=public.roll_pg_die(20); vals:=array_append(vals,v); end loop;
  if mode='advantage' then select max(x) into chosen from unnest(vals) x;
  elsif mode='disadvantage' then select min(x) into chosen from unnest(vals) x;
  else chosen:=vals[1]; end if;
  return jsonb_build_object('rolls',to_jsonb(vals),'natural',chosen);
end;$$;

-- Estes helpers ignoram RLS para calcular o combate. Não são endpoints do cliente.
-- RPCs autorizados continuam a chamá-los com o papel do proprietário da função.
revoke execute on function public.combat_attribute_modifier(uuid,text),
 public.combat_skill_bonus(uuid,text), public.combat_test_bonus(uuid,text,text),
 public.combat_ca(uuid), public.combat_max_ps(uuid), public.combat_max_ea(uuid),
 public.combat_max_pa(uuid), public.equipment_attunement_used(uuid,uuid),
 public.roll_pg_die(int), public.roll_pg_d20(text,int), public.roll_pg_damage(int,int,boolean)
from public,anon,authenticated;

-- Uma ficha sem atributos passava na soma de orçamento, mas divergia da UI.
alter table public.characters alter column attributes set default
 '{"strength":1,"dexterity":1,"resistance":1,"intelligence":1,"perception":1,"will":1,"presence":1,"cursed_control":1}'::jsonb;
do $$
declare definition text;
begin
  select pg_get_functiondef('public.validate_character_build()'::regprocedure) into definition;
  definition:=replace(definition,'  a_sum :=', $validation$
  if jsonb_typeof(new.attributes)<>'object' or not (new.attributes ?& array[
    'strength','dexterity','resistance','intelligence','perception','will','presence','cursed_control'
  ]) then raise exception 'A ficha precisa conter os oito atributos do sistema.'; end if;
  a_sum :=$validation$);
  execute definition;
end;$$;

commit;
