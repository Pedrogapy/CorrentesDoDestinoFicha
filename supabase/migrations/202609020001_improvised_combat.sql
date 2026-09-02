-- Improvisação reutiliza participantes, ações, efeitos, rolagens e snapshots.
-- Não altera dados físicos nem elimina o histórico existente de Undo.

alter table public.system_conditions add column if not exists public_catalog boolean not null default false;

-- Corrige também textos legados particulares, sem apagar registros nem trocar suas chaves.
create or replace function public.repair_condition_utf8(p_text text)
returns text language plpgsql immutable set search_path=public as $$
declare result text:=p_text; pair record; i int;
begin
  for i in 1..3 loop
    -- Substituições exatas não recodificam trechos que já estão corretos.
    for pair in select * from (values
      ('Ã¡','á'),('Ã¢','â'),('Ã£','ã'),('Ã ','à'),('Ã©','é'),('Ãª','ê'),
      ('Ã­','í'),('Ã³','ó'),('Ã´','ô'),('Ãµ','õ'),('Ãº','ú'),('Ã¼','ü'),('Ã§','ç'),
      ('Ã€','À'),('Ã','Á'),('Ã‚','Â'),('Ãƒ','Ã'),('Ã‰','É'),('ÃŠ','Ê'),
      ('Ã','Í'),('Ã“','Ó'),('Ã”','Ô'),('Ã•','Õ'),('Ãš','Ú'),('Ãœ','Ü'),('Ã‡','Ç'),
      ('â€™','’'),('â€œ','“'),('â€','”'),('â€“','–'),('â€”','—')
    ) as replacements(bad,good) loop
      result:=replace(result,pair.bad,pair.good);
    end loop;
  end loop;
  return result;
end;
$$;
update public.system_conditions set name=public.repair_condition_utf8(name),description=public.repair_condition_utf8(description)
where name ~ '(Ã|Â|â€)' or description ~ '(Ã|Â|â€)';
drop function public.repair_condition_utf8(text);

-- Catálogo genérico estável; entradas autorais existentes são preservadas para o Mestre.
-- GENERIC_CONDITIONS
insert into public.system_conditions(key,name,description) values
('bleeding','Sangramento','O alvo está perdendo sangue de forma relevante. Duração, intensidade e condições para interromper o efeito são determinadas pela fonte.'),
('burning','Queimadura','O alvo sofre os efeitos de uma queimadura ativa ou residual. Intensidade, duração e eventual dano são definidos pela fonte.'),
('immobilized','Imobilizado','O alvo não consegue mudar voluntariamente de posição enquanto a condição permanecer. Outras ações continuam possíveis quando não forem impedidas por outro efeito.'),
('stunned','Atordoado','O alvo está temporariamente desorientado e com dificuldade de agir. Os efeitos mecânicos específicos são definidos pela fonte da condição.'),
('blind','Cego','O alvo não consegue utilizar visão de maneira funcional. Outros sentidos continuam disponíveis normalmente.'),
('silenced','Silenciado','O alvo não consegue utilizar fala de maneira funcional enquanto a condição permanecer.'),
('prone','Caído','O alvo está no chão ou em posição equivalente. Pode precisar se reposicionar antes de determinadas ações.'),
('shaken','Abalado','O alvo apresenta instabilidade emocional ou física que dificulta manter a compostura.'),
('frightened','Amedrontado','O alvo sente medo intenso. As limitações para se aproximar ou agir dependem do efeito aplicado.'),
('confused','Confuso','O alvo tem dificuldade para interpretar a situação e escolher suas ações com clareza.'),
('disoriented','Desorientado','O alvo tem dificuldade para reconhecer direção, distância ou referências ao redor.'),
('weakened','Enfraquecido','O alvo demonstra redução de força ou de capacidade de esforço.'),
('exhausted','Exausto','O alvo sofre cansaço intenso que compromete seu desempenho.'),
('poisoned','Envenenado','O alvo sofre os efeitos de uma substância nociva. A intensidade e a duração dependem do efeito aplicado.'),
('slowed','Lento','Os movimentos ou respostas do alvo estão mais lentos.'),
('accelerated','Acelerado','Os movimentos ou respostas do alvo estão mais rápidos.'),
('vulnerable','Vulnerável','O alvo está mais exposto a danos ou interferências enquanto o efeito permanecer.'),
('protected','Protegido','O alvo recebe proteção temporária contra determinados danos ou interferências.'),
('marked','Marcado','O alvo apresenta uma marca ou sinal perceptível associado ao efeito aplicado.'),
('restricted','Restrito','Parte dos movimentos ou ações do alvo está limitada. As restrições concretas dependem do efeito aplicado.'),
('incapacitated','Incapacitado','O alvo não consegue executar ações de maneira funcional enquanto a condição permanecer.'),
('unconscious','Inconsciente','O alvo perdeu a consciência e não consegue agir voluntariamente.'),
('provoked','Provocado','A atenção do alvo está direcionada a uma provocação, dificultando ignorá-la.'),
('hidden','Oculto','A presença ou posição do alvo não está claramente perceptível aos observadores afetados.'),
('revealed','Revelado','A presença ou posição do alvo tornou-se perceptível aos observadores afetados.'),
('deaf','Surdo','O alvo não consegue utilizar audição de maneira funcional. Outros sentidos continuam disponíveis.'),
('no_reaction','Sem Reação','O alvo não consegue realizar reações enquanto o efeito permanecer.'),
('no_movement','Sem Movimento','O alvo não consegue realizar deslocamentos voluntários enquanto o efeito permanecer.'),
('suppression','Supressão','Uma ou mais capacidades do alvo estão temporariamente impedidas ou reduzidas.'),
('energy_interference','Interferência de Energia','O alvo apresenta dificuldade ou irregularidade na utilização de energia.'),
('regeneration','Regeneração','O alvo recupera sua integridade gradualmente. O ritmo e os limites dependem do efeito aplicado.'),
('ongoing_damage','Dano Contínuo','O alvo sofre dano recorrente enquanto o efeito permanecer. Intervalo e intensidade dependem do efeito aplicado.'),
('damage_reduction','Redução de Dano','O alvo sofre menos dano de determinados impactos ou efeitos.'),
('barrier','Barreira','Uma separação perceptível limita passagem, alcance ou contato na área afetada.'),
('shield','Escudo','O alvo está coberto por uma proteção que pode absorver ou reduzir impactos.'),
('strengthened','Fortalecido','O alvo apresenta aumento temporário de força ou de capacidade de esforço.'),
('stasis','Suspenso','O alvo permanece temporariamente suspenso, com suas possibilidades de ação ou interação limitadas.'),
('disarmed','Desarmado','O alvo está sem acesso imediato ao objeto ou arma que utilizava.'),
('unbalanced','Desequilibrado','O alvo tem dificuldade para manter equilíbrio e postura.'),
('focused','Concentrado','O alvo mantém atenção intensificada em uma atividade ou objetivo.'),
('empowered','Energizado','O alvo dispõe de maior energia utilizável durante o efeito.'),
('drained','Drenado','O alvo apresenta redução temporária de energia disponível.'),
('transformed','Transformado','O alvo apresenta alterações perceptíveis de forma ou funcionamento enquanto o efeito permanecer.'),
('attack_bonus','Precisão Ampliada','O alvo apresenta maior precisão ao executar determinados ataques.'),
('reflection','Reflexão de Dano','Parte do impacto recebido pelo alvo retorna a quem o atingiu.')
on conflict(key) do update set
  name=excluded.name,
  description=excluded.description,
  updated_at=now();

update public.system_conditions
set public_catalog=true
where key in ('bleeding','burning','immobilized','stunned','blind','silenced','prone','shaken','frightened','confused','disoriented','weakened','exhausted','poisoned','slowed','accelerated','vulnerable','protected','marked','restricted','incapacitated','unconscious','provoked','hidden','revealed','deaf','no_reaction','no_movement','suppression','energy_interference','regeneration','ongoing_damage','damage_reduction','barrier','shield','strengthened','stasis','disarmed','unbalanced','focused','empowered','drained','transformed','attack_bonus','reflection');
-- END_GENERIC_CONDITIONS

drop policy if exists conditions_read on public.system_conditions;
create policy conditions_read on public.system_conditions for select to authenticated
using (public.is_master() or (active and public_catalog));

-- Apenas migrations ampliam o catálogo público. Edições cotidianas são privadas,
-- evitando que um nome autoral seja publicado ao atualizar uma chave genérica.
create or replace function public.protect_public_condition_catalog()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='INSERT' then new.public_catalog:=false;
  elsif old.public_catalog then
    if new.key is distinct from old.key or new.name is distinct from old.name or new.description is distinct from old.description then
      raise exception 'Condição genérica pública: use um efeito temporário ou uma nova chave privada para personalizar.';
    end if;
    new.public_catalog:=true;
  else new.public_catalog:=false;
  end if;
  return new;
end;
$$;
create trigger protect_public_condition_catalog before insert or update on public.system_conditions
for each row execute function public.protect_public_condition_catalog();

alter table public.characters disable trigger protect_character_insert_trigger;
insert into public.characters(id,entity_type,first_name,last_name,level,grade,attributes,skills)
values ('cdd00000-0000-4000-8000-000000000001','enemy','Inimigo','',5,'',
  '{"strength":2,"dexterity":2,"resistance":2,"intelligence":2,"perception":2,"will":2,"presence":2,"cursed_control":2}', '{}')
on conflict (id) do nothing;
alter table public.characters enable trigger protect_character_insert_trigger;

create or replace function public.preserve_generic_enemy()
returns trigger language plpgsql set search_path=public as $$
begin
  if old.id='cdd00000-0000-4000-8000-000000000001' then
    if tg_op='DELETE' then raise exception 'Inimigo é uma ficha reutilizável permanente.'; end if;
    new.id:=old.id; new.entity_type:='enemy'; new.first_name:='Inimigo'; new.last_name:=''; new.owner_id:=null;
  end if;
  return new;
end;
$$;
create trigger preserve_generic_enemy before update or delete on public.characters
for each row execute function public.preserve_generic_enemy();

-- Nullable: snapshots anteriores continuam válidos quando restaurados.
alter table public.combat_actions add column if not exists master_action jsonb;

create or replace function public.improvise_combat_action(p_encounter_id uuid,p_action jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  e public.combat_encounters%rowtype;
  target public.combat_participants%rowtype;
  actor public.combat_participants%rowtype;
  condition public.system_conditions%rowtype;
  kind text:=p_action->>'kind';
  amount int; turns int; uses int; val int; k text;
  mods jsonb:=coalesce(p_action->'modifiers','{}');
  effect_data jsonb:='{}';
  public_text text:=trim(coalesce(p_action->>'public_text',''));
  effect_name text:=trim(coalesce(p_action->>'name',''));
  description text:=trim(coalesce(p_action->>'description',''));
  damage_type text:=trim(coalesce(p_action->>'damage_type',''));
  reveal boolean:=coalesce((p_action->>'reveal_details')::boolean,false);
  title text; target_name text; snapshot uuid; result_id uuid;
begin
  if not public.is_master() then raise exception 'Somente o Mestre pode improvisar ações.'; end if;
  if kind is null or kind not in ('attack','effect','narrative','damage','heal','energy') then raise exception 'Ferramenta inválida.'; end if;
  select * into e from public.combat_encounters where id=p_encounter_id for update;
  if e.id is null or e.status<>'active' then raise exception 'Combate não está ativo.'; end if;
  select * into target from public.combat_participants
    where encounter_id=e.id and character_id=nullif(p_action->>'target_id','')::uuid for update;
  if kind<>'narrative' and target.id is null then raise exception 'Escolha um alvo deste combate.'; end if;
  if nullif(p_action->>'target_id','') is not null and target.id is null then raise exception 'Alvo não pertence a este combate.'; end if;
  select * into actor from public.combat_participants
    where encounter_id=e.id and character_id=nullif(p_action->>'actor_id','')::uuid for update;
  if kind='attack' and (actor.id is null or actor.id is distinct from e.active_participant_id) then
    raise exception 'Inicie o turno de quem fará o ataque.';
  end if;
  if kind='narrative' and public_text='' then raise exception 'Escreva a ação narrativa pública.'; end if;
  if length(public_text)>2000 or length(description)>2000 or length(effect_name)>120 or length(damage_type)>80 then
    raise exception 'Texto acima do limite permitido.';
  end if;
  if kind in ('attack','damage','heal','energy') then
    if coalesce(p_action->>'amount','') !~ '^-?[0-9]+$' then raise exception 'Informe um valor inteiro.'; end if;
    amount:=(p_action->>'amount')::int;
    if amount not between -100000 and 100000 or (kind<>'energy' and amount<0) then raise exception 'Valor fora dos limites.'; end if;
  end if;
  title:=case kind when 'attack' then 'Ataque Improvisado' when 'effect' then 'Efeito Improvisado'
    when 'narrative' then 'Ação Narrativa' when 'damage' then 'Aplicar Dano' when 'heal' then 'Curar/Restaurar' else 'Alterar EA' end;

  -- Uma transação inclui snapshot, efeitos e registro. Uma validação que falha não deixa Undo pendente.
  snapshot:=public.begin_combat_undo(e.id,title);
  if kind='attack' then
    result_id:=public.create_combat_attack(e.id,actor.character_id,target.character_id,'Ataque','custom',null,
      'strength','fight',1,0,false,false,20,0,0,null,null,'normal',1);
    update public.combat_actions set damage_flat_bonus=coalesce(damage_flat_bonus,0)+amount,
      master_action=jsonb_build_object('public_text',public_text,'reveal_details',reveal,'damage_type',damage_type)
    where id=result_id;
  elsif kind='damage' then
    update public.combat_participants set current_ps=greatest(0,coalesce(current_ps,public.combat_max_ps(character_id))-amount),defeated=(greatest(0,coalesce(current_ps,public.combat_max_ps(character_id))-amount)=0) where id=target.id;
  elsif kind='heal' then
    update public.combat_participants set current_ps=least(public.combat_max_ps(character_id),coalesce(current_ps,public.combat_max_ps(character_id))+amount),
      defeated=(least(public.combat_max_ps(character_id),coalesce(current_ps,public.combat_max_ps(character_id))+amount)=0) where id=target.id;
  elsif kind='energy' then
    update public.combat_participants set current_ea=greatest(0,least(public.combat_max_ea(character_id),coalesce(current_ea,public.combat_max_ea(character_id))+amount)) where id=target.id;
  elsif kind='effect' then
    if nullif(p_action->>'condition_key','') is not null then
      select * into condition from public.system_conditions where key=p_action->>'condition_key' and active;
      if condition.id is null then raise exception 'Condição indisponível.'; end if;
      -- Nomes privados não se tornam públicos automaticamente ao selecionar um registro legado.
      if effect_name='' then effect_name:=case when condition.public_catalog then condition.name else 'Efeito temporário' end; end if;
      if description='' and condition.public_catalog then description:=condition.description; end if;
    end if;
    if effect_name='' then raise exception 'Informe o nome do efeito temporário.'; end if;
    turns:=(p_action->>'remaining_turns')::int; uses:=(p_action->>'uses')::int;
    if (turns is not null and turns not between 1 and 1000) or (uses is not null and uses not between 1 and 1000) then
      raise exception 'Duração e usos devem estar entre 1 e 1000.';
    end if;
    if jsonb_typeof(mods)<>'object' then raise exception 'Modificadores inválidos.'; end if;
    for k in select jsonb_object_keys(mods) loop
      if k in ('ca_bonus','conditional_attack_bonus','damage_reduction_flat','pa_penalty_next_turn') then
        if coalesce(mods->>k,'') !~ '^-?[0-9]+$' then raise exception 'Modificador deve ser inteiro.'; end if;
        val:=(mods->>k)::int;
        if val not between -100 and 100 or (k in ('damage_reduction_flat','pa_penalty_next_turn') and val<0) then raise exception 'Modificador fora dos limites.'; end if;
        -- Ausência de chave para bônus zero evita consumir um uso por uma ação sem bônus.
        if val<>0 then effect_data:=effect_data||jsonb_build_object(k,val); end if;
      elsif k in ('blocks_actions','blocks_reactions','blocks_movement','blocks_cursed_abilities') then
        if jsonb_typeof(mods->k)<>'boolean' then raise exception 'Modificador inválido.'; end if;
        effect_data:=effect_data||jsonb_build_object(k,(mods->>k)::boolean);
      else raise exception 'Modificador não permitido.';
      end if;
    end loop;
    effect_data:=effect_data||jsonb_build_object('public_name',effect_name,'public_description',description,
      'public_visible',coalesce((p_action->>'visible')::boolean,true),'condition_key',condition.key,
      'decrement_on','target_end','remove_when_empty',true);
    insert into public.combat_effect_states(encounter_id,source_character_id,target_character_id,source_type,effect_key,name,data,remaining_turns,uses_remaining)
    values(e.id,coalesce(actor.character_id,target.character_id),target.character_id,'improvised','improvised:'||gen_random_uuid(),effect_name,effect_data,turns,uses)
    returning id into result_id;
  end if;
  if reveal then
    select case when target.visible_to_players then trim(concat_ws(' ',c.first_name,c.last_name)) else 'Alvo' end
      into target_name from public.characters c where c.id=target.character_id;
    public_text:=concat_ws(' ',nullif(public_text,''),title||case when target_name is not null then ' — '||target_name else '' end||
      case when amount is not null then ': '||amount::text else '' end||
      case when damage_type<>'' then ' ('||damage_type||')' else '' end||'.');
  end if;
  if public_text<>'' then
    insert into public.roll_logs(encounter_id,character_id,label,roll_type,total,visibility)
    values(e.id,null,public_text,'improvised',0,'public');
  end if;
  update public.combat_encounters set updated_at=clock_timestamp() where id=e.id;
  perform public.commit_combat_undo(snapshot);
  return result_id;
end;
$$;
revoke execute on function public.improvise_combat_action(uuid,jsonb) from public,anon;
grant execute on function public.improvise_combat_action(uuid,jsonb) to authenticated;

create or replace function public.manage_improvised_effect(p_effect_id uuid,p_consume boolean default false)
returns void language plpgsql security definer set search_path=public as $$
declare s public.combat_effect_states%rowtype; snapshot uuid;
begin
  if not public.is_master() then raise exception 'Somente o Mestre pode ajustar este efeito.'; end if;
  select * into s from public.combat_effect_states where id=p_effect_id and source_type='improvised' for update;
  if s.id is null then raise exception 'Efeito temporário não encontrado.'; end if;
  if p_consume and s.uses_remaining is null then raise exception 'Este efeito não possui limite de usos.'; end if;
  snapshot:=public.begin_combat_undo(s.encounter_id,case when p_consume then 'Consumir uso de efeito' else 'Remover efeito improvisado' end);
  if not p_consume or s.uses_remaining<=1 then delete from public.combat_effect_states where id=s.id;
  else update public.combat_effect_states set uses_remaining=uses_remaining-1 where id=s.id; end if;
  perform public.commit_combat_undo(snapshot);
end;
$$;
revoke execute on function public.manage_improvised_effect(uuid,boolean) from public,anon;
grant execute on function public.manage_improvised_effect(uuid,boolean) to authenticated;

-- Efeitos brutos incluem origem e configurações; nunca são entregues ao player.
drop policy if exists combat_effect_states_read on public.combat_effect_states;
create policy combat_effect_states_read on public.combat_effect_states for select to authenticated using(public.is_master());

create or replace function public.get_visible_combat_effects(p_encounter_id uuid)
returns setof jsonb language sql stable security definer set search_path=public as $$
  select case when public.is_master() then to_jsonb(s) else jsonb_build_object(
    'id',s.id,'encounter_id',s.encounter_id,'target_character_id',s.target_character_id,
    'name',coalesce(nullif(s.data->>'public_name',''),case when public.owns_character(s.source_character_id) then s.name else 'Efeito ativo' end),
    'description',coalesce(s.data->>'public_description',''),
    'remaining_turns',s.remaining_turns,'uses_remaining',s.uses_remaining,
    'extinguish_pa_cost',coalesce((s.data->>'extinguish_pa_cost')::int,0),
    'can_detonate',s.effect_key='art_bomb' and public.owns_character(s.source_character_id),
    'bomb_roll',case when s.effect_key='art_bomb' and public.owns_character(s.source_character_id) then jsonb_build_object(
      'count',coalesce((s.data->>'damage_dice_count')::int,0),'sides',coalesce((s.data->>'damage_die')::int,0),
      'target_count',greatest(1,jsonb_array_length(coalesce(s.data->'target_ids','[]')))) end
  ) end
  from public.combat_effect_states s
  where s.encounter_id=p_encounter_id and (public.is_master() or (
    public.owns_character(s.target_character_id) and coalesce((s.data->>'public_visible')::boolean,true)
  )) order by s.created_at,s.id;
$$;
revoke execute on function public.get_visible_combat_effects(uuid) from public,anon;
grant execute on function public.get_visible_combat_effects(uuid) to authenticated;

-- O encontro é o sinal público de atualização; Realtime não precisa enviar efeitos brutos.
create trigger touch_encounter_effect after insert or update or delete on public.combat_effect_states
for each row execute function public.touch_combat_encounter_from_participant();
create trigger touch_encounter_action after insert or update or delete on public.combat_actions
for each row execute function public.touch_combat_encounter_from_participant();

-- O núcleo v0.8 já calcula redução fixa, mas filtrava somente efeitos com dados.
do $$
declare definition text; patched text;
begin
  select pg_get_functiondef('public.resolve_combat_hit_v082_core(uuid,boolean)'::regprocedure) into definition;
  patched:=replace(definition,
    'and coalesce((s.data->>''damage_reduction_dice_count'')::int,0)>0',
    'and (coalesce((s.data->>''damage_reduction_dice_count'')::int,0)>0 or coalesce((s.data->>''damage_reduction_flat'')::int,0)>0)');
  if patched=definition then raise exception 'Núcleo de redução de dano incompatível.'; end if;
  execute patched;
end;
$$;

-- Restaurar participantes não deve reinicializar recursos, modos e contadores do snapshot.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.initialize_combat_runtime()'::regprocedure) into definition;
  definition:=replace(definition,E'begin\n',E'begin\n  if current_setting(''app.restoring_combat'',true)=''true'' then return new; end if;\n');
  execute definition;
end;
$$;
alter function public.undo_last_combat_action(uuid) rename to undo_last_combat_action_restore_core;
revoke execute on function public.undo_last_combat_action_restore_core(uuid) from public,anon,authenticated;
create or replace function public.undo_last_combat_action(p_encounter_id uuid)
returns text language plpgsql security definer set search_path=public as $$
declare result text;
begin
  if not public.is_master() then raise exception 'Somente o Mestre pode desfazer ações de combate.'; end if;
  perform set_config('app.restoring_combat','true',true);
  result:=public.undo_last_combat_action_restore_core(p_encounter_id);
  perform set_config('app.restoring_combat','false',true);
  return result;
end;
$$;
revoke execute on function public.undo_last_combat_action(uuid) from public,anon;
grant execute on function public.undo_last_combat_action(uuid) to authenticated;
