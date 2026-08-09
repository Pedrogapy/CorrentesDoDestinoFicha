-- Correntes do Destino - Equipamentos v0.6
-- Revisão de slots, Sintonia e dano de armas.
--
-- Princípios:
-- * mão principal/secundária são ocupação física, sem bônus/penalidade de acerto;
-- * itens vestíveis usam locais corporais e podem, quando permitido, ser segurados;
-- * cada item amaldiçoado equipado consome 1 Sintonia (consumíveis não contam);
-- * Sintonia: 3 (Nv 1-24), 4 (25-49), 5 (50-74), 6 (75-99), 7 (100);
-- * arma Padrão: 1d8 em uma mão e pode causar 1d10 ao ser usada com duas mãos no ataque;
-- * Pesada: 1d12/1 PA/2 mãos; Muito pesada: 2d10/2 PA/2 mãos;
-- * equipamentos podem ser excluídos por seu dono ou pelo Mestre via RPC.

alter table public.equipment
  add column if not exists wear_slot text not null default 'none',
  add column if not exists can_hold boolean not null default false;

-- Converte itens já existentes para os novos metadados sem alterar sua posse.
update public.equipment
set wear_slot = case
  when category='accessory' and wear_slot='none' then 'accessory'
  when category='armor' and wear_slot='none' then 'body'
  else wear_slot
end;

-- Arma Padrão passa a ser armazenada como arma de uma mão; o uso com duas mãos
-- é uma escolha feita no ataque quando a mão secundária estiver livre.
update public.equipment set hands=1 where category='weapon' and weapon_profile='standard';

-- Expande os slots físicos.
alter table public.equipment drop constraint if exists equipment_slot_check;
alter table public.equipment add constraint equipment_slot_check
  check (equip_slot is null or equip_slot in (
    'main_hand','off_hand','head','neck','body','arms','waist','feet','accessory_1','accessory_2'
  ));

alter table public.equipment drop constraint if exists equipment_wear_slot_check;
alter table public.equipment add constraint equipment_wear_slot_check
  check (wear_slot in ('none','head','neck','body','arms','waist','feet','accessory'));

create or replace function public.equipment_attunement_capacity(p_level int)
returns int
language sql immutable
as $$
  select case
    when greatest(1,least(100,coalesce(p_level,1))) >= 100 then 7
    when greatest(1,least(100,coalesce(p_level,1))) >= 75 then 6
    when greatest(1,least(100,coalesce(p_level,1))) >= 50 then 5
    when greatest(1,least(100,coalesce(p_level,1))) >= 25 then 4
    else 3
  end;
$$;

create or replace function public.equipment_attunement_used(p_character_id uuid, p_exclude_item_id uuid default null)
returns int
language sql stable
security definer
set search_path=public
as $$
  select count(*)::int
  from public.equipment e
  where e.character_id=p_character_id
    and e.equipped
    and e.status='approved'
    and e.is_cursed
    and e.category<>'consumable'
    and (p_exclude_item_id is null or e.id<>p_exclude_item_id);
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
  master_now boolean := public.is_master() or coalesce(current_setting('app.equipment_migration',true),'')='1';
begin
  new.effects := case when jsonb_typeof(coalesce(new.effects,'[]'::jsonb))='array' then coalesce(new.effects,'[]'::jsonb) else '[]'::jsonb end;
  new.wear_slot := coalesce(new.wear_slot,'none');
  new.can_hold := coalesce(new.can_hold,false);

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
    new.hands := case when new.weapon_profile in ('heavy','very_heavy') then 2 else 1 end;
    new.wear_slot := 'none';
    new.can_hold := false;

    p := coalesce(new.attack_config,'{}'::jsonb);
    p := p || jsonb_build_object(
      'enabled',true,
      'pa_cost',case when new.weapon_profile='very_heavy' then 2 else 1 end,
      'ea_cost',0,
      'damage_dice_count',case when new.weapon_profile='very_heavy' then 2 else 1 end,
      'damage_die',case
        when new.weapon_profile='light' then 6
        when new.weapon_profile='heavy' then 12
        when new.weapon_profile='very_heavy' then 10
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

    if new.category='accessory' and new.wear_slot='none' then new.wear_slot:='accessory'; end if;
    if new.category='armor' and new.wear_slot='none' then new.wear_slot:='body'; end if;
    if new.category='consumable' then
      new.wear_slot:='none';
      new.can_hold:=false;
    end if;
  end if;

  if tg_op='UPDATE' then
    power_changed :=
      new.name is distinct from old.name or
      new.category is distinct from old.category or
      new.subtype is distinct from old.subtype or
      new.is_cursed is distinct from old.is_cursed or
      new.grade is distinct from old.grade or
      new.hands is distinct from old.hands or
      new.wear_slot is distinct from old.wear_slot or
      new.can_hold is distinct from old.can_hold or
      new.weapon_profile is distinct from old.weapon_profile or
      new.weapon_range is distinct from old.weapon_range or
      new.attack_config is distinct from old.attack_config or
      new.effects is distinct from old.effects or
      new.charges_max is distinct from old.charges_max;
  end if;

  if not master_now then
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

-- O trigger já existe desde v0.5, mas é recriado para apontar explicitamente para a versão atual.
drop trigger if exists validate_equipment on public.equipment;
create trigger validate_equipment
before insert or update on public.equipment
for each row execute procedure public.validate_equipment_row();

-- Recalcula attack_config dos itens antigos com as novas tabelas de dano sem
-- transformar a migração em uma proposta pendente de jogador.
select set_config('app.equipment_migration','1',true);
update public.equipment set attack_config=attack_config where category='weapon';
select set_config('app.equipment_migration','0',true);

create or replace function public.equip_equipment(p_item_id uuid, p_slot text)
returns public.equipment
language plpgsql
security definer
set search_path=public
as $$
declare
  item public.equipment%rowtype;
  main_two_handed uuid;
  slot_ok boolean := false;
  used_sintonia int := 0;
  cap_sintonia int := 0;
  char_level int := 1;
begin
  select * into item from public.equipment where id=p_item_id for update;
  if item.id is null then raise exception 'Equipamento não encontrado.'; end if;
  if not (public.is_master() or public.owns_character(item.character_id)) then raise exception 'Sem permissão.'; end if;
  if item.status<>'approved' then raise exception 'O equipamento precisa estar aprovado.'; end if;
  if not item.active then raise exception 'O equipamento está inativo.'; end if;
  perform set_config('app.equipment_slot_rpc','1',true);

  if item.category='weapon' then
    if item.weapon_profile in ('heavy','very_heavy') then
      slot_ok := p_slot='main_hand';
    else
      slot_ok := p_slot in ('main_hand','off_hand');
    end if;
  elsif item.category='consumable' then
    slot_ok := false;
  else
    slot_ok :=
      (item.wear_slot='head' and p_slot='head') or
      (item.wear_slot='neck' and p_slot='neck') or
      (item.wear_slot='body' and p_slot='body') or
      (item.wear_slot='arms' and p_slot='arms') or
      (item.wear_slot='waist' and p_slot='waist') or
      (item.wear_slot='feet' and p_slot='feet') or
      (item.wear_slot='accessory' and p_slot in ('accessory_1','accessory_2')) or
      (item.can_hold and p_slot in ('main_hand','off_hand'));
  end if;

  if not slot_ok then
    raise exception 'Este item não pode ser equipado nesse slot.';
  end if;

  -- Resolve ocupação das mãos.
  if p_slot in ('main_hand','off_hand') then
    if item.category='weapon' and item.hands=2 then
      update public.equipment set equipped=false,equip_slot=null
      where character_id=item.character_id and id<>item.id and equip_slot in ('main_hand','off_hand');
    else
      if p_slot='off_hand' then
        select id into main_two_handed from public.equipment
        where character_id=item.character_id and equipped and equip_slot='main_hand' and category='weapon' and hands=2 limit 1;
        if main_two_handed is not null then
          update public.equipment set equipped=false,equip_slot=null where id=main_two_handed;
        end if;
      end if;
      update public.equipment set equipped=false,equip_slot=null
      where character_id=item.character_id and id<>item.id and equip_slot=p_slot;
    end if;
  else
    -- Um único objeto físico por slot corporal.
    update public.equipment set equipped=false,equip_slot=null
    where character_id=item.character_id and id<>item.id and equip_slot=p_slot;
  end if;

  -- Sintonia é verificada depois dos itens deslocados, dentro da mesma transação.
  if item.is_cursed and item.category<>'consumable' then
    select level into char_level from public.characters where id=item.character_id;
    cap_sintonia := public.equipment_attunement_capacity(char_level);
    used_sintonia := public.equipment_attunement_used(item.character_id,item.id);
    if used_sintonia + 1 > cap_sintonia then
      raise exception 'Sintonia insuficiente: %/% itens amaldiçoados ativos.', used_sintonia, cap_sintonia;
    end if;
  end if;

  update public.equipment set equipped=true,equip_slot=p_slot where id=item.id returning * into item;
  return item;
end;
$$;

create or replace function public.delete_equipment(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  item public.equipment%rowtype;
begin
  select * into item from public.equipment where id=p_item_id;
  if item.id is null then return; end if;
  if not (public.is_master() or public.owns_character(item.character_id)) then raise exception 'Sem permissão.'; end if;
  delete from public.equipment where id=p_item_id;
end;
$$;

grant execute on function public.equipment_attunement_capacity(int) to authenticated;
grant execute on function public.equipment_attunement_used(uuid,uuid) to authenticated;
grant execute on function public.equip_equipment(uuid,text) to authenticated;
grant execute on function public.delete_equipment(uuid) to authenticated;
