-- Correntes do Destino - Dados físicos opcionais v0.8.3
-- Mantém toda a matemática no PostgreSQL, mas permite que o jogador forneça
-- os resultados naturais dos dados quando preferir rolar fisicamente.

create table if not exists public.manual_dice_queues (
  user_id uuid primary key references auth.users(id) on delete cascade,
  queue jsonb not null default '[]'::jsonb,
  active boolean not null default false,
  expires_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.manual_dice_queues enable row level security;
revoke all on public.manual_dice_queues from anon, authenticated;

drop policy if exists manual_dice_owner_read on public.manual_dice_queues;
create policy manual_dice_owner_read on public.manual_dice_queues for select to authenticated using (user_id=auth.uid());

create or replace function public.set_manual_dice_queue(p_queue jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid();
begin
  if uid is null then raise exception 'Autenticação necessária.'; end if;
  if p_queue is null or jsonb_typeof(p_queue)<>'array' then raise exception 'Fila de dados inválida.'; end if;
  insert into public.manual_dice_queues(user_id,queue,active,expires_at,updated_at)
  values(uid,p_queue,true,now()+interval '90 seconds',now())
  on conflict(user_id) do update set queue=excluded.queue,active=true,expires_at=excluded.expires_at,updated_at=now();
end;$$;

create or replace function public.clear_manual_dice_queue()
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is not null then
    insert into public.manual_dice_queues(user_id,queue,active,expires_at,updated_at)
    values(auth.uid(),'[]'::jsonb,false,now(),now())
    on conflict(user_id) do update set queue='[]'::jsonb,active=false,expires_at=now(),updated_at=now();
  end if;
end;$$;

grant execute on function public.set_manual_dice_queue(jsonb) to authenticated;
grant execute on function public.clear_manual_dice_queue() to authenticated;

create or replace function public.manual_dice_peek()
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare q public.manual_dice_queues%rowtype;
begin
  if auth.uid() is null then return null; end if;
  select * into q from public.manual_dice_queues where user_id=auth.uid() for update;
  if q.user_id is null or not q.active or q.expires_at<=now() then return null; end if;
  if jsonb_typeof(q.queue)<>'array' or jsonb_array_length(q.queue)=0 then return null; end if;
  return q.queue->0;
end;$$;

create or replace function public.manual_dice_pop()
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare q public.manual_dice_queues%rowtype; item jsonb; rest jsonb;
begin
  if auth.uid() is null then return null; end if;
  select * into q from public.manual_dice_queues where user_id=auth.uid() for update;
  if q.user_id is null or not q.active or q.expires_at<=now() or jsonb_typeof(q.queue)<>'array' or jsonb_array_length(q.queue)=0 then return null; end if;
  item:=q.queue->0;
  select coalesce(jsonb_agg(x.value order by x.ord),'[]'::jsonb) into rest
  from jsonb_array_elements(q.queue) with ordinality as x(value,ord) where x.ord>1;
  update public.manual_dice_queues set queue=rest,updated_at=now() where user_id=auth.uid();
  return item;
end;$$;

revoke execute on function public.manual_dice_peek() from public,anon,authenticated;
revoke execute on function public.manual_dice_pop() from public,anon,authenticated;

create or replace function public.roll_pg_die(p_sides int)
returns int language plpgsql volatile security definer set search_path=public as $$
declare item jsonb; v int; sides int:=greatest(1,p_sides);
begin
  item:=public.manual_dice_peek();
  if item is not null then
    if coalesce(item->>'kind','')<>'die' then raise exception 'A rolagem física esperava um d% individual, mas recebeu outro formato.',sides; end if;
    if coalesce((item->>'sides')::int,0)<>sides then raise exception 'A rolagem física esperava d%, mas recebeu d%.',sides,coalesce((item->>'sides')::int,0); end if;
    v:=coalesce((item->>'value')::int,0);
    if v<1 or v>sides then raise exception 'Resultado inválido para d%: %.',sides,v; end if;
    perform public.manual_dice_pop();
    return v;
  end if;
  return floor(random()*sides)::int+1;
end;$$;

create or replace function public.roll_pg_d20(p_mode text default 'normal', p_count int default 1)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare vals int[]:='{}'; i int; c int:=greatest(1,least(10,p_count)); v int; chosen int; mode text:=coalesce(p_mode,'normal');
begin
  if mode in ('advantage','disadvantage') and c<2 then c:=2; end if;
  if mode='normal' then c:=1; end if;
  for i in 1..c loop v:=public.roll_pg_die(20); vals:=array_append(vals,v); end loop;
  if mode='advantage' then select max(x) into chosen from unnest(vals) x;
  elsif mode='disadvantage' then select min(x) into chosen from unnest(vals) x;
  else chosen:=vals[1]; end if;
  return jsonb_build_object('rolls',to_jsonb(vals),'natural',chosen);
end;$$;

create or replace function public.roll_pg_damage(p_count int,p_sides int,p_critical boolean default false)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare vals int[]:='{}'; i int; c int:=greatest(0,p_count)*case when p_critical then 2 else 1 end; total int:=0; v int; item jsonb; supplied int;
begin
  if c=0 or p_sides<=0 then return jsonb_build_object('rolls','[]'::jsonb,'total',0); end if;
  item:=public.manual_dice_peek();
  if item is not null and coalesce(item->>'kind','')='sum' then
    if coalesce((item->>'count')::int,0)<>c or coalesce((item->>'sides')::int,0)<>p_sides then
      raise exception 'A soma física esperada era %d%, mas o valor informado corresponde a %d%.',c,p_sides,coalesce((item->>'count')::int,0),coalesce((item->>'sides')::int,0);
    end if;
    supplied:=coalesce((item->>'total')::int,0);
    if supplied<c or supplied>c*p_sides then raise exception 'Soma inválida para %d%: %.',c,p_sides,supplied; end if;
    perform public.manual_dice_pop();
    return jsonb_build_object('rolls',jsonb_build_array(supplied),'total',supplied,'physical_sum',true);
  end if;
  for i in 1..c loop v:=public.roll_pg_die(p_sides); vals:=array_append(vals,v); total:=total+v; end loop;
  return jsonb_build_object('rolls',to_jsonb(vals),'total',total);
end;$$;

-- Dano de ataques é resolvido depois da rolagem de acerto. Guardamos os dados
-- físicos do atacante na própria ação até o alvo aceitar/reagir.
alter table public.combat_actions add column if not exists physical_damage_queue jsonb not null default '[]'::jsonb;
alter table public.combat_actions add column if not exists physical_damage_pending boolean not null default false;
alter table public.combat_actions add column if not exists attack_roll_source text not null default 'digital';
alter table public.combat_actions drop constraint if exists combat_actions_attack_roll_source_check;
alter table public.combat_actions add constraint combat_actions_attack_roll_source_check check (attack_roll_source in ('digital','physical'));

create or replace function public.mark_physical_attack(p_action_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare a public.combat_actions%rowtype; has_bonus boolean:=false;
begin
  select * into a from public.combat_actions where id=p_action_id for update;
  if a.id is null then raise exception 'Ataque não encontrado.'; end if;
  if not (public.is_master() or public.owns_character(a.attacker_character_id)) then raise exception 'Sem permissão para registrar os dados deste ataque.'; end if;
  select exists(select 1 from public.combat_effect_states s where s.encounter_id=a.encounter_id and s.target_character_id=a.attacker_character_id and coalesce((s.data->>'bonus_damage_dice_count')::int,0)>0 and coalesce((s.data->>'bonus_damage_die')::int,0)>0 and (s.uses_remaining is null or s.uses_remaining>0)) into has_bonus;
  update public.combat_actions set attack_roll_source='physical',physical_damage_pending=(status='pending_defense' and ((damage_dice_count>0 and damage_die>0) or has_bonus)),updated_at=now() where id=p_action_id;
end;$$;

create or replace function public.get_physical_attack_prompt(p_action_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a public.combat_actions%rowtype; bonus record; groups jsonb:='[]'::jsonb; cnt int;
begin
  select * into a from public.combat_actions where id=p_action_id;
  if a.id is null then raise exception 'Ataque não encontrado.'; end if;
  if not (public.is_master() or public.owns_character(a.attacker_character_id)) then raise exception 'Sem permissão.'; end if;
  if a.status<>'pending_defense' then return jsonb_build_object('needs_damage',false,'groups','[]'::jsonb); end if;
  if a.damage_dice_count>0 and a.damage_die>0 then
    cnt:=a.damage_dice_count*case when a.is_critical then 2 else 1 end;
    groups:=groups||jsonb_build_array(jsonb_build_object('label',case when a.is_critical then 'Dano crítico' else 'Dano' end,'count',cnt,'sides',a.damage_die));
  end if;
  select s.* into bonus from public.combat_effect_states s where s.encounter_id=a.encounter_id and s.target_character_id=a.attacker_character_id and coalesce((s.data->>'bonus_damage_dice_count')::int,0)>0 and coalesce((s.data->>'bonus_damage_die')::int,0)>0 and (s.uses_remaining is null or s.uses_remaining>0) order by s.created_at limit 1;
  if bonus.id is not null then groups:=groups||jsonb_build_array(jsonb_build_object('label',coalesce(nullif(bonus.name,''),'Dano adicional'),'count',(bonus.data->>'bonus_damage_dice_count')::int,'sides',(bonus.data->>'bonus_damage_die')::int)); end if;
  return jsonb_build_object('needs_damage',jsonb_array_length(groups)>0,'groups',groups);
end;$$;

create or replace function public.set_physical_attack_damage(p_action_id uuid,p_queue jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare a public.combat_actions%rowtype;
begin
  if p_queue is null or jsonb_typeof(p_queue)<>'array' then raise exception 'Dados físicos inválidos.'; end if;
  select * into a from public.combat_actions where id=p_action_id for update;
  if a.id is null then raise exception 'Ataque não encontrado.'; end if;
  if not (public.is_master() or public.owns_character(a.attacker_character_id)) then raise exception 'Sem permissão.'; end if;
  update public.combat_actions set physical_damage_queue=p_queue,physical_damage_pending=false,attack_roll_source='physical',updated_at=now() where id=p_action_id;
end;$$;

create or replace function public.use_digital_attack_damage(p_action_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare a public.combat_actions%rowtype;
begin
  select * into a from public.combat_actions where id=p_action_id for update;
  if a.id is null then raise exception 'Ataque não encontrado.'; end if;
  if not (public.is_master() or public.owns_character(a.attacker_character_id)) then raise exception 'Sem permissão.'; end if;
  update public.combat_actions set physical_damage_queue='[]'::jsonb,physical_damage_pending=false,updated_at=now() where id=p_action_id;
end;$$;

grant execute on function public.mark_physical_attack(uuid) to authenticated;
grant execute on function public.get_physical_attack_prompt(uuid) to authenticated;
grant execute on function public.set_physical_attack_damage(uuid,jsonb) to authenticated;
grant execute on function public.use_digital_attack_damage(uuid) to authenticated;

-- Envolve a resolução atual de dano sem reescrever as regras v0.8.
alter function public.resolve_combat_hit(uuid,boolean) rename to resolve_combat_hit_v082_core;
revoke execute on function public.resolve_combat_hit_v082_core(uuid,boolean) from public,anon,authenticated;

create or replace function public.resolve_combat_hit(p_action_id uuid,p_half boolean default false)
returns public.combat_actions language plpgsql security definer set search_path=public as $$
declare a public.combat_actions%rowtype; result public.combat_actions%rowtype;
begin
  select * into a from public.combat_actions where id=p_action_id for update;
  if a.id is null then raise exception 'Ação não encontrada.'; end if;
  if a.physical_damage_pending then raise exception 'Aguardando o atacante registrar o dano dos dados físicos.'; end if;
  if jsonb_typeof(a.physical_damage_queue)='array' and jsonb_array_length(a.physical_damage_queue)>0 then perform public.set_manual_dice_queue(a.physical_damage_queue); end if;
  result:=public.resolve_combat_hit_v082_core(p_action_id,p_half);
  perform public.clear_manual_dice_queue();
  update public.combat_actions set physical_damage_queue='[]'::jsonb,physical_damage_pending=false where id=p_action_id;
  return result;
exception when others then
  perform public.clear_manual_dice_queue();
  raise;
end;$$;

grant execute on function public.resolve_combat_hit(uuid,boolean) to authenticated;

-- Snapshots antigos não conhecem as novas colunas NOT NULL. O combate atual
-- permanece; somente o histórico de Ctrl+Z anterior à migração é descartado.
delete from public.combat_undo_snapshots;
