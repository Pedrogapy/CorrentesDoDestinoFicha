-- Correntes do Destino - equipamentos e ferramentas amaldiçoadas v0.5
-- Regras centrais:
-- * ataque básico da arma é definido pelo perfil físico e não consome VP;
-- * efeitos sobrenaturais consomem o orçamento de VP do grau do item;
-- * itens amaldiçoados propostos por jogadores ficam pendentes até aprovação do Mestre;
-- * somente itens aprovados podem ser equipados;
-- * equipar/desquipar é resolvido no servidor para evitar conflitos de slots.

alter table public.equipment
  add column if not exists category text not null default 'other',
  add column if not exists subtype text not null default '',
  add column if not exists is_cursed boolean not null default false,
  add column if not exists status text not null default 'approved',
  add column if not exists master_response text not null default '',
  add column if not exists equipped boolean not null default false,
  add column if not exists equip_slot text,
  add column if not exists hands int not null default 0,
  add column if not exists weapon_profile text,
  add column if not exists weapon_range text not null default 'melee',
  add column if not exists effects jsonb not null default '[]'::jsonb,
  add column if not exists vp_limit_override boolean not null default false;

-- Restrições adicionadas de forma idempotente.
do $$
begin
  if not exists (select 1 from pg_constraint where conname='equipment_category_check') then
    alter table public.equipment add constraint equipment_category_check
      check (category in ('weapon','accessory','armor','consumable','other'));
  end if;
  if not exists (select 1 from pg_constraint where conname='equipment_status_check') then
    alter table public.equipment add constraint equipment_status_check
      check (status in ('pending','approved','rejected'));
  end if;
  if not exists (select 1 from pg_constraint where conname='equipment_slot_check') then
    alter table public.equipment add constraint equipment_slot_check
      check (equip_slot is null or equip_slot in ('main_hand','off_hand','body','accessory_1','accessory_2'));
  end if;
  if not exists (select 1 from pg_constraint where conname='equipment_hands_check') then
    alter table public.equipment add constraint equipment_hands_check check (hands between 0 and 2);
  end if;
  if not exists (select 1 from pg_constraint where conname='equipment_weapon_profile_check') then
    alter table public.equipment add constraint equipment_weapon_profile_check
      check (weapon_profile is null or weapon_profile in ('light','standard','heavy','very_heavy'));
  end if;
  if not exists (select 1 from pg_constraint where conname='equipment_weapon_range_check') then
    alter table public.equipment add constraint equipment_weapon_range_check
      check (weapon_range in ('melee','ranged'));
  end if;
end $$;

create or replace function public.equipment_vp_budget(p_grade text, p_is_cursed boolean default true)
returns int
language sql immutable
as $$
  select case
    when not coalesce(p_is_cursed,false) then 0
    when p_grade='Grau 4' then 2
    when p_grade='Grau 3' then 4
    when p_grade='Grau 2' then 6
    when p_grade='Grau 1' then 9
    when p_grade='Grau Especial' then 12
    else 0
  end;
$$;

create or replace function public.equipment_effects_vp(p_effects jsonb)
returns int
language sql immutable
as $$
  select coalesce(sum(greatest(0,coalesce((e->>'vp')::int,0))),0)::int
  from jsonb_array_elements(case when jsonb_typeof(coalesce(p_effects,'[]'::jsonb))='array' then coalesce(p_effects,'[]'::jsonb) else '[]'::jsonb end) e;
$$;

create or replace function public.validate_equipment_row()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  used_vp int;
  budget int;
  p jsonb;
  power_changed boolean := false;
  master_now boolean := public.is_master();
begin
  new.effects := case when jsonb_typeof(coalesce(new.effects,'[]'::jsonb))='array' then coalesce(new.effects,'[]'::jsonb) else '[]'::jsonb end;

  if exists (
    select 1 from jsonb_array_elements(new.effects) e
    where coalesce((e->>'vp')::int,0) < 0
  ) then
    raise exception 'VP de efeito não pode ser negativo.';
  end if;

  if not new.is_cursed then
    new.grade := 'Sem Grau';
    new.vp_limit_override := false;
    if jsonb_array_length(new.effects) > 0 then
      raise exception 'Itens comuns não possuem efeitos sobrenaturais. Marque o item como amaldiçoado.';
    end if;
  end if;

  used_vp := public.equipment_effects_vp(new.effects);
  budget := public.equipment_vp_budget(new.grade,new.is_cursed);

  if used_vp > budget and not new.vp_limit_override then
    raise exception 'VP do equipamento excede o orçamento do grau: % / %.', used_vp, budget;
  end if;

  if new.vp_limit_override and not master_now then
    raise exception 'Somente o Mestre pode ignorar o limite de VP de equipamento.';
  end if;

  -- O perfil físico define o ataque básico e não pode ser inflado manualmente.
  if new.category='weapon' then
    new.weapon_profile := coalesce(new.weapon_profile,'standard');
    new.hands := case
      when new.weapon_profile='light' then 1
      when new.weapon_profile in ('heavy','very_heavy') then 2
      else greatest(1,least(2,coalesce(new.hands,1)))
    end;

    p := coalesce(new.attack_config,'{}'::jsonb);
    p := p || jsonb_build_object(
      'enabled',true,
      'pa_cost',case when new.weapon_profile='very_heavy' then 2 else 1 end,
      'ea_cost',0,
      'damage_dice_count',1,
      'damage_die',case
        when new.weapon_profile='light' then 6
        when new.weapon_profile='heavy' then 10
        when new.weapon_profile='very_heavy' then 12
        else 8
      end,
      'uses_cursed_energy',false,
      'forced_critical',false,
      'critical_threshold',20,
      'allow_cursed_reinforcement',true,
      'range',new.weapon_range
    );
    if not (p ? 'attack_attribute_key') then p:=p||jsonb_build_object('attack_attribute_key','strength'); end if;
    if not (p ? 'attack_skill_key') then p:=p||jsonb_build_object('attack_skill_key',case when new.weapon_range='ranged' then 'aim' else 'fight' end); end if;
    if not (p ? 'damage_flat_attribute_key') then p:=p||jsonb_build_object('damage_flat_attribute_key',coalesce(p->>'attack_attribute_key','strength')); end if;
    new.attack_config := p;
  else
    new.weapon_profile := null;
    new.hands := 0;
    new.weapon_range := 'melee';
    new.attack_config := coalesce(new.attack_config,'{}'::jsonb) || jsonb_build_object('enabled',false);
  end if;

  if tg_op='UPDATE' then
    power_changed :=
      new.name is distinct from old.name or
      new.category is distinct from old.category or
      new.subtype is distinct from old.subtype or
      new.is_cursed is distinct from old.is_cursed or
      new.grade is distinct from old.grade or
      new.hands is distinct from old.hands or
      new.weapon_profile is distinct from old.weapon_profile or
      new.weapon_range is distinct from old.weapon_range or
      new.attack_config is distinct from old.attack_config or
      new.effects is distinct from old.effects or
      new.charges_max is distinct from old.charges_max;
  end if;

  -- Jogadores podem propor ferramentas amaldiçoadas, mas não aprová-las.
  if not master_now then
    -- Slots só podem ser alterados pelas RPCs equip_equipment/unequip_equipment,
    -- evitando que uma atualização direta crie dois itens no mesmo slot.
    if tg_op='UPDATE' and (new.equipped is distinct from old.equipped or new.equip_slot is distinct from old.equip_slot)
       and coalesce(current_setting('app.equipment_slot_rpc',true),'')<>'1' then
      new.equipped := old.equipped;
      new.equip_slot := old.equip_slot;
    end if;

    if tg_op='INSERT' then
      new.status := case when new.is_cursed then 'pending' else 'approved' end;
    else
      if new.status is distinct from old.status then new.status := old.status; end if;
      if new.is_cursed and power_changed then new.status := 'pending'; end if;
      if not new.is_cursed then new.status := 'approved'; end if;

      -- O jogador pode gastar cargas, mas não restaurá-las manualmente.
      if old.charges_current is not null and new.charges_current is not null and new.charges_current > old.charges_current then
        new.charges_current := old.charges_current;
      end if;
    end if;
  end if;

  if new.charges_max is not null then
    new.charges_max := greatest(0,new.charges_max);
    new.charges_current := greatest(0,least(coalesce(new.charges_current,new.charges_max),new.charges_max));
  else
    new.charges_current := null;
  end if;

  if new.status <> 'approved' then
    new.equipped := false;
    new.equip_slot := null;
  end if;
  if not new.equipped then new.equip_slot := null; end if;

  return new;
end;
$$;

drop trigger if exists validate_equipment on public.equipment;
create trigger validate_equipment
before insert or update on public.equipment
for each row execute procedure public.validate_equipment_row();

create or replace function public.equip_equipment(p_item_id uuid, p_slot text)
returns public.equipment
language plpgsql
security definer
set search_path=public
as $$
declare
  item public.equipment%rowtype;
  main_two_handed uuid;
begin
  select * into item from public.equipment where id=p_item_id for update;
  if item.id is null then raise exception 'Equipamento não encontrado.'; end if;
  if not (public.is_master() or public.owns_character(item.character_id)) then raise exception 'Sem permissão.'; end if;
  if item.status<>'approved' then raise exception 'O equipamento precisa estar aprovado.'; end if;
  if not item.active then raise exception 'O equipamento está inativo.'; end if;
  perform set_config('app.equipment_slot_rpc','1',true);

  if item.category='weapon' then
    if p_slot not in ('main_hand','off_hand') then raise exception 'Armas ocupam uma das mãos.'; end if;
    if item.hands=2 and p_slot<>'main_hand' then raise exception 'Armas de duas mãos devem ser equipadas na mão principal.'; end if;

    if item.hands=2 then
      update public.equipment set equipped=false,equip_slot=null
      where character_id=item.character_id and id<>item.id and equip_slot in ('main_hand','off_hand');
    else
      if p_slot='off_hand' then
        select id into main_two_handed from public.equipment
        where character_id=item.character_id and equipped and equip_slot='main_hand' and hands=2 limit 1;
        if main_two_handed is not null then
          update public.equipment set equipped=false,equip_slot=null where id=main_two_handed;
        end if;
      end if;
      update public.equipment set equipped=false,equip_slot=null
      where character_id=item.character_id and id<>item.id and equip_slot=p_slot;
    end if;
  elsif item.category='armor' then
    if p_slot<>'body' then raise exception 'Roupas e armaduras ocupam o slot Corpo.'; end if;
    update public.equipment set equipped=false,equip_slot=null
    where character_id=item.character_id and id<>item.id and equip_slot='body';
  elsif item.category='accessory' then
    if p_slot not in ('accessory_1','accessory_2') then raise exception 'Acessórios ocupam um slot de acessório.'; end if;
    update public.equipment set equipped=false,equip_slot=null
    where character_id=item.character_id and id<>item.id and equip_slot=p_slot;
  else
    raise exception 'Este tipo de item não utiliza slot de equipamento.';
  end if;

  update public.equipment set equipped=true,equip_slot=p_slot where id=item.id returning * into item;
  return item;
end;
$$;

create or replace function public.unequip_equipment(p_item_id uuid)
returns public.equipment
language plpgsql
security definer
set search_path=public
as $$
declare item public.equipment%rowtype;
begin
  select * into item from public.equipment where id=p_item_id for update;
  if item.id is null then raise exception 'Equipamento não encontrado.'; end if;
  if not (public.is_master() or public.owns_character(item.character_id)) then raise exception 'Sem permissão.'; end if;
  perform set_config('app.equipment_slot_rpc','1',true);
  update public.equipment set equipped=false,equip_slot=null where id=item.id returning * into item;
  return item;
end;
$$;

create or replace function public.spend_equipment_charges(p_item_id uuid, p_amount int default 1)
returns public.equipment
language plpgsql
security definer
set search_path=public
as $$
declare item public.equipment%rowtype; amount int:=greatest(0,coalesce(p_amount,0));
begin
  select * into item from public.equipment where id=p_item_id for update;
  if item.id is null then raise exception 'Equipamento não encontrado.'; end if;
  if not (public.is_master() or public.owns_character(item.character_id)) then raise exception 'Sem permissão.'; end if;
  if item.status<>'approved' then raise exception 'Equipamento não aprovado.'; end if;
  if item.charges_max is null or amount=0 then return item; end if;
  if coalesce(item.charges_current,0)<amount then raise exception 'Cargas insuficientes.'; end if;
  update public.equipment set charges_current=charges_current-amount where id=item.id returning * into item;
  return item;
end;
$$;

grant execute on function public.equipment_vp_budget(text,boolean) to authenticated;
grant execute on function public.equipment_effects_vp(jsonb) to authenticated;
grant execute on function public.equip_equipment(uuid,text) to authenticated;
grant execute on function public.unequip_equipment(uuid) to authenticated;
grant execute on function public.spend_equipment_charges(uuid,int) to authenticated;
