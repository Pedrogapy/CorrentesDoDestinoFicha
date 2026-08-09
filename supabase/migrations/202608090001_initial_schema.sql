-- Correntes do Destino - schema inicial v0.1
-- IMPORTANTE: dados secretos do mestre ficam em tabelas separadas e com RLS prÃ³prio.
-- NÃ£o mover segredos para `characters`, `abilities` ou campos que jogadores possam consultar.

create extension if not exists pgcrypto;

-- ============================================================
-- CAMPANHA / PERFIS
-- ============================================================

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  system_key text not null default 'correntes_do_destino',
  created_at timestamptz not null default now()
);

insert into public.campaigns (id, slug, name, system_key)
values ('00000000-0000-0000-0000-000000000001', 'correntes-do-destino', 'Correntes do Destino', 'correntes_do_destino')
on conflict (id) do nothing;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text not null default 'player' check (role in ('player','master')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)), 'player')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.is_master()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'master'
  );
$$;

-- ============================================================
-- SISTEMA / COMPÃŠNDIO
-- ============================================================

create table if not exists public.system_attributes (
  key text primary key,
  name text not null,
  description text not null,
  sort_order int not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.system_skills (
  key text primary key,
  name text not null,
  attribute_key text not null references public.system_attributes(key),
  description text not null,
  sort_order int not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.system_conditions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.system_attributes (key,name,description,sort_order) values
('strength','ForÃ§a','Capacidade de produzir e aplicar forÃ§a fÃ­sica atravÃ©s do corpo. Influencia potÃªncia muscular, combate fÃ­sico e aÃ§Ãµes baseadas em forÃ§a bruta.',10),
('dexterity','Destreza','CoordenaÃ§Ã£o, precisÃ£o corporal, equilÃ­brio e velocidade de resposta fÃ­sica.',20),
('resistance','ResistÃªncia','Capacidade fÃ­sica de suportar esforÃ§o, dano, desgaste e alteraÃ§Ãµes impostas ao corpo.',30),
('intelligence','InteligÃªncia','Capacidade de aprender, analisar, raciocinar e aplicar conhecimentos tÃ©cnicos ou teÃ³ricos.',40),
('perception','PercepÃ§Ã£o','Capacidade de captar, distinguir e interpretar informaÃ§Ãµes provenientes do ambiente e do comportamento ao redor.',50),
('will','Vontade','Estabilidade mental e espiritual, disciplina interna e capacidade de manter controle sobre si mesmo.',60),
('presence','PresenÃ§a','Capacidade de influenciar outras pessoas atravÃ©s de comunicaÃ§Ã£o, comportamento, autoridade ou expressÃ£o.',70),
('cursed_control','Controle AmaldiÃ§oado','PrecisÃ£o e domÃ­nio com que o personagem manipula sua prÃ³pria Energia AmaldiÃ§oada. NÃ£o representa o tamanho de sua reserva.',80)
on conflict (key) do update set name=excluded.name, description=excluded.description, sort_order=excluded.sort_order;

insert into public.system_skills (key,name,attribute_key,description,sort_order) values
('athletics','Atletismo','strength','Capacidade de executar esforÃ§os fÃ­sicos ligados a deslocamento, levantamento, corrida, salto, escalada e outras aÃ§Ãµes atlÃ©ticas.',101),
('fight','Lutar','strength','Treinamento e eficiÃªncia em combate corpo a corpo e no uso do prÃ³prio corpo para realizar ataques.',102),
('grapple','Agarrar','strength','Capacidade de prender, conter ou controlar fisicamente outro corpo e de disputar agarrÃµes.',103),
('impact','Impacto','strength','Capacidade de aplicar forÃ§a de maneira concentrada para quebrar, empurrar, deslocar ou afetar fisicamente objetos e estruturas.',104),
('acrobatics','Acrobacia','dexterity','Controle corporal durante movimentos complexos, equilÃ­brio, aterrissagens e reposicionamentos fÃ­sicos.',201),
('reflexes','Reflexos','dexterity','Capacidade de responder rapidamente a ameaÃ§as, movimentos e acontecimentos repentinos.',202),
('stealth','Furtividade','dexterity','Capacidade de ocultar presenÃ§a fÃ­sica, reduzir sinais de movimentaÃ§Ã£o e evitar ser percebido.',203),
('aim','Pontaria','dexterity','PrecisÃ£o ao direcionar ataques, projÃ©teis, objetos ou efeitos que dependam de mira.',204),
('defend','Defender','resistance','Capacidade de bloquear, aparar ou interceptar fisicamente ataques utilizando postura, corpo, arma ou meio apropriado.',301),
('fortitude','Fortitude','resistance','Capacidade do corpo de suportar dano, dor, exaustÃ£o, agentes nocivos e outras formas de desgaste fÃ­sico.',302),
('steadiness','Firmeza','resistance','Capacidade de manter posiÃ§Ã£o, equilÃ­brio e controle corporal contra efeitos que tentem deslocar, derrubar ou desestabilizar.',303),
('survival','SobrevivÃªncia','resistance','Capacidade de preservar o prÃ³prio corpo e operar adequadamente em ambientes hostis ou situaÃ§Ãµes prolongadas de privaÃ§Ã£o.',304),
('investigation','InvestigaÃ§Ã£o','intelligence','Capacidade de analisar evidÃªncias, identificar relaÃ§Ãµes, reconstruir acontecimentos e encontrar informaÃ§Ãµes por busca deliberada.',401),
('occultism','Ocultismo','intelligence','Conhecimento teÃ³rico sobre fenÃ´menos sobrenaturais, Energia AmaldiÃ§oada, maldiÃ§Ãµes, objetos e tradiÃ§Ãµes relacionadas Ã  feitiÃ§aria.',402),
('technical_sorcery','FeitiÃ§aria TÃ©cnica','intelligence','Conhecimento tÃ©cnico empregado na construÃ§Ã£o, anÃ¡lise e manipulaÃ§Ã£o de estruturas amaldiÃ§oadas, incluindo selos, barreiras, cortinas, delimitaÃ§Ãµes, condiÃ§Ãµes, rituais e estruturas semelhantes.',403),
('medicine','Medicina','intelligence','Conhecimento sobre anatomia, ferimentos, doenÃ§as, estabilizaÃ§Ã£o, diagnÃ³stico e tratamento do corpo.',404),
('technology','Tecnologia','intelligence','Conhecimento e capacidade prÃ¡tica envolvendo computadores, eletrÃ´nica, dispositivos e sistemas tecnolÃ³gicos.',405),
('attention','AtenÃ§Ã£o','perception','Capacidade de detectar conscientemente detalhes, sons, movimentos, alteraÃ§Ãµes e outros estÃ­mulos perceptÃ­veis.',501),
('intuition','IntuiÃ§Ã£o','perception','Capacidade de interpretar sinais sutis, comportamentos e sensaÃ§Ãµes para perceber intenÃ§Ãµes, riscos ou inconsistÃªncias.',502),
('tracking','Rastreamento','perception','Capacidade de identificar e seguir vestÃ­gios fÃ­sicos, energÃ©ticos ou ambientais deixados por um alvo ou acontecimento.',503),
('combat_reading','Leitura de Combate','perception','Capacidade de observar e compreender padrÃµes, ritmos, posturas, intenÃ§Ãµes e mudanÃ§as ocorridas durante um confronto.',504),
('concentration','ConcentraÃ§Ã£o','will','Capacidade de manter foco e continuidade mental mesmo diante de distraÃ§Ã£o, pressÃ£o, dor ou interferÃªncia.',601),
('self_control','Autocontrole','will','Capacidade de regular conscientemente emoÃ§Ãµes, impulsos e respostas comportamentais.',602),
('mental_resistance','ResistÃªncia Mental','will','Capacidade de resistir a interferÃªncias que afetem pensamento, percepÃ§Ã£o, emoÃ§Ã£o ou funcionamento da mente.',603),
('spiritual_resistance','ResistÃªncia Espiritual','will','Capacidade de proteger identidade, alma e estrutura espiritual contra interferÃªncias sobrenaturais.',604),
('persuasion','PersuasÃ£o','presence','Capacidade de influenciar decisÃµes e opiniÃµes atravÃ©s de argumentaÃ§Ã£o e comunicaÃ§Ã£o.',701),
('deception','EnganaÃ§Ã£o','presence','Capacidade de transmitir deliberadamente informaÃ§Ãµes ou impressÃµes falsas de maneira convincente.',702),
('intimidation','IntimidaÃ§Ã£o','presence','Capacidade de exercer pressÃ£o e provocar receio atravÃ©s da presenÃ§a, comportamento ou comunicaÃ§Ã£o.',703),
('leadership','LideranÃ§a','presence','Capacidade de coordenar, orientar e influenciar coletivamente outras pessoas.',704),
('performance','Performance','presence','Capacidade de executar apresentaÃ§Ãµes, interpretaÃ§Ãµes e formas deliberadas de expressÃ£o artÃ­stica ou pÃºblica.',705),
('channeling','CanalizaÃ§Ã£o','cursed_control','Capacidade de conduzir, concentrar, transferir e manipular diretamente o fluxo de Energia AmaldiÃ§oada.',801),
('reinforcement','ReforÃ§o','cursed_control','Capacidade de aplicar Energia AmaldiÃ§oada para fortalecer corpo, objetos, armas ou estruturas. TambÃ©m representa a aplicaÃ§Ã£o defensiva dessa energia.',802),
('technique_control','Controle de TÃ©cnica','cursed_control','Capacidade de operar com precisÃ£o os fenÃ´menos e efeitos produzidos pela prÃ³pria TÃ©cnica AmaldiÃ§oada.',803),
('cursed_suppression','SupressÃ£o AmaldiÃ§oada','cursed_control','Capacidade de reduzir, ocultar ou controlar deliberadamente a manifestaÃ§Ã£o e assinatura da prÃ³pria Energia AmaldiÃ§oada.',804)
on conflict (key) do update set name=excluded.name, attribute_key=excluded.attribute_key, description=excluded.description, sort_order=excluded.sort_order;

insert into public.system_conditions (key,name,description) values
('bleeding','Sangramento','O alvo estÃ¡ perdendo sangue de forma relevante. A origem do efeito define duraÃ§Ã£o, dano ou mÃ©todo de encerramento quando aplicÃ¡vel.'),
('burning','Queimadura','O alvo sofre os efeitos de uma queimadura ativa ou residual. A fonte define intensidade, duraÃ§Ã£o e eventuais danos adicionais.'),
('immobilized','Imobilizado','O alvo nÃ£o consegue mudar voluntariamente de posiÃ§Ã£o enquanto a condiÃ§Ã£o permanecer. Outras aÃ§Ãµes continuam possÃ­veis salvo indicaÃ§Ã£o da fonte.'),
('stunned','Atordoado','O alvo estÃ¡ temporariamente desorientado e com dificuldade de agir. A fonte define exatamente quais aÃ§Ãµes ou reaÃ§Ãµes sÃ£o afetadas.'),
('blind','Cego','O alvo nÃ£o pode utilizar visÃ£o para perceber, mirar ou interpretar o ambiente. Outros sentidos continuam funcionando normalmente.'),
('silenced','Silenciado','O alvo nÃ£o consegue produzir ou utilizar fala de maneira funcional enquanto a condiÃ§Ã£o permanecer.'),
('prone','CaÃ­do','O alvo estÃ¡ no chÃ£o ou em posiÃ§Ã£o equivalente e precisa se reposicionar antes de agir como se estivesse plenamente de pÃ©.')
on conflict (key) do update set name=excluded.name, description=excluded.description;

-- ============================================================
-- PERSONAGENS
-- ============================================================

create table if not exists public.characters (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.campaigns(id) on delete cascade,
  owner_id uuid references auth.users(id) on delete set null,
  parent_character_id uuid references public.characters(id) on delete cascade,
  entity_type text not null default 'player' check (entity_type in ('player','npc','curse','enemy','summon')),
  first_name text not null,
  last_name text not null default '',
  nickname text not null default '',
  grade text not null default 'Grau 4',
  level int not null default 5 check (level between 1 and 100),
  xp int not null default 0 check (xp >= 0),
  biography text not null default '',
  personality text not null default '',
  goals text not null default '',
  appearance text not null default '',
  notes text not null default '',
  image_url text not null default '',
  image_path text not null default '',
  technique_name text not null default '',
  technique_description text not null default '',
  attributes jsonb not null default '{}'::jsonb,
  skills jsonb not null default '{}'::jsonb,
  growth_vigor int not null default 0 check (growth_vigor >= 0),
  growth_reserve int not null default 0 check (growth_reserve >= 0),
  permanent_ps_bonus int not null default 0,
  permanent_ea_bonus int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists one_player_character_per_owner
on public.characters(owner_id)
where entity_type = 'player' and owner_id is not null;

create table if not exists public.character_master_secrets (
  character_id uuid primary key references public.characters(id) on delete cascade,
  secret_text text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.master_progress_tracks (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  key text not null,
  title text not null,
  current_points int not null default 0,
  target_points int,
  reward_notes text not null default '',
  master_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(character_id, key)
);

-- ============================================================
-- HABILIDADES / VOTOS / EQUIPAMENTOS / TRANSFORMAÃ‡Ã•ES
-- ============================================================

create table if not exists public.abilities (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  category text not null check (category in ('technique','general','manifestation','transformation','domain')),
  name text not null,
  description text not null default '',
  mechanics text not null default '',
  config jsonb not null default '{}'::jsonb,
  vp_estimated int not null default 1 check (vp_estimated >= 1),
  vp_approved int,
  limit_override boolean not null default false,
  status text not null default 'pending' check (status in ('draft','pending','approved','rejected','disabled')),
  master_response text not null default '',
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vows (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  name text not null,
  restriction text not null,
  benefit text not null,
  break_condition text not null,
  duration_type text not null default 'permanent' check (duration_type in ('permanent','temporary')),
  status text not null default 'pending' check (status in ('pending','active','player_disabled','master_locked','available_reactivation','rejected')),
  master_response text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.equipment (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  name text not null,
  equipment_type text not null default 'Comum',
  grade text not null default 'Sem Grau',
  description text not null default '',
  mechanics text not null default '',
  image_url text not null default '',
  charges_current int,
  charges_max int,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.transformations (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  name text not null,
  description text not null default '',
  modifiers jsonb not null default '{}'::jsonb,
  activation_cost jsonb not null default '{}'::jsonb,
  active boolean not null default false,
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- SESSÃ•ES / TEMPO LIVRE / TICKETS
-- ============================================================

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.campaigns(id) on delete cascade,
  title text not null default '',
  status text not null default 'active' check (status in ('active','ended')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_by uuid not null default auth.uid()
);

create unique index if not exists one_active_session_per_campaign
on public.sessions(campaign_id)
where status = 'active';

create table if not exists public.free_time_balances (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  granted int not null default 0 check (granted >= 0),
  committed int not null default 0 check (committed >= 0),
  spent int not null default 0 check (spent >= 0),
  expired boolean not null default false,
  created_at timestamptz not null default now(),
  unique(session_id, character_id),
  check (committed + spent <= granted)
);

create table if not exists public.training_tickets (
  id uuid primary key default gen_random_uuid(),
  balance_id uuid not null references public.free_time_balances(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  activity text not null,
  description text not null default '',
  days_requested int not null check (days_requested > 0),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  master_response text not null default '',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.master_requests (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  title text not null,
  message text not null,
  status text not null default 'pending' check (status in ('pending','answered','rejected')),
  master_response text not null default '',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- ============================================================
-- COMBATE / ROLAGENS
-- ============================================================

create table if not exists public.combat_encounters (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.campaigns(id) on delete cascade,
  name text not null,
  status text not null default 'active' check (status in ('active','ended')),
  round int not null default 1 check (round >= 1),
  current_turn int not null default 0,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists public.combat_participants (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references public.combat_encounters(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  initiative int not null default 0,
  current_ps int,
  current_ea int,
  current_pa int,
  conditions jsonb not null default '[]'::jsonb,
  counterattack_count int not null default 0,
  defeated boolean not null default false,
  created_at timestamptz not null default now(),
  unique(encounter_id, character_id)
);

create table if not exists public.roll_logs (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid references public.combat_encounters(id) on delete cascade,
  character_id uuid references public.characters(id) on delete set null,
  actor_user_id uuid default auth.uid(),
  label text not null,
  roll_type text not null default 'test',
  expression text not null default '',
  rolls jsonb not null default '[]'::jsonb,
  natural_roll int,
  bonus int not null default 0,
  total int not null,
  is_critical boolean not null default false,
  kokusen_eligible boolean not null default false,
  visibility text not null default 'public' check (visibility in ('public','owner','master')),
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id bigint generated by default as identity primary key,
  actor_id uuid,
  character_id uuid references public.characters(id) on delete set null,
  table_name text not null,
  action text not null,
  summary text not null default '',
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================
-- FUNÃ‡Ã•ES DE REGRAS
-- ============================================================

create or replace function public.jsonb_int_sum(p jsonb)
returns int
language sql immutable
as $$
  select coalesce(sum((value)::int),0)::int from jsonb_each_text(coalesce(p,'{}'::jsonb));
$$;

create or replace function public.jsonb_int_max(p jsonb)
returns int
language sql immutable
as $$
  select coalesce(max((value)::int),0)::int from jsonb_each_text(coalesce(p,'{}'::jsonb));
$$;

create or replace function public.attribute_budget(p_level int)
returns int language sql immutable as $$ select 15 + greatest(1, least(100, p_level)); $$;

create or replace function public.attribute_cap(p_level int)
returns int language sql immutable as $$
  select least(20, 5 + floor((greatest(1, least(100, p_level)) - 1) / 6.0)::int);
$$;

create or replace function public.skill_budget(p_level int)
returns int language sql immutable as $$ select 9 + greatest(1, least(100, p_level)); $$;

create or replace function public.skill_cap(p_level int)
returns int language sql immutable as $$
  select least(10, 3 + floor((greatest(1, least(100, p_level)) - 1) / 12.0)::int);
$$;

create or replace function public.xp_cost_for_next_level(p_level int)
returns int language sql immutable as $$
  select case when p_level >= 100 then 0 else 100 + 25 * p_level end;
$$;

create or replace function public.has_active_session()
returns boolean
language sql stable security definer set search_path=public
as $$
  select exists (
    select 1 from public.sessions
    where campaign_id='00000000-0000-0000-0000-000000000001' and status='active'
  );
$$;

create or replace function public.owns_character(p_character_id uuid)
returns boolean
language sql stable security definer set search_path=public
as $$
  select exists(select 1 from public.characters c where c.id=p_character_id and c.owner_id=auth.uid());
$$;

create or replace function public.validate_character_build()
returns trigger
language plpgsql
security definer set search_path=public
as $$
declare
  a_sum int;
  s_sum int;
  a_max int;
  s_max int;
  k text;
  v int;
begin
  a_sum := public.jsonb_int_sum(new.attributes);
  s_sum := public.jsonb_int_sum(new.skills);
  a_max := public.jsonb_int_max(new.attributes);
  s_max := public.jsonb_int_max(new.skills);

  if a_sum > public.attribute_budget(new.level) then
    raise exception 'Pontos de atributo excedem o orÃ§amento do nÃ­vel.';
  end if;
  if a_max > public.attribute_cap(new.level) then
    raise exception 'Um atributo excede o limite permitido no nÃ­vel.';
  end if;
  for k, v in select key, value::int from jsonb_each_text(coalesce(new.attributes,'{}'::jsonb)) loop
    if v < 1 then raise exception 'Atributos nÃ£o podem ser menores que 1.'; end if;
  end loop;

  if s_sum > public.skill_budget(new.level) then
    raise exception 'Pontos de perÃ­cia excedem o orÃ§amento do nÃ­vel.';
  end if;
  if s_max > public.skill_cap(new.level) then
    raise exception 'Uma perÃ­cia excede o limite permitido no nÃ­vel.';
  end if;
  for k, v in select key, value::int from jsonb_each_text(coalesce(new.skills,'{}'::jsonb)) loop
    if v < 0 then raise exception 'PerÃ­cias nÃ£o podem ser negativas.'; end if;
  end loop;

  if new.growth_vigor + new.growth_reserve > new.level then
    raise exception 'Crescimento excede os pontos disponÃ­veis do nÃ­vel.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_character_build_trigger on public.characters;
create trigger validate_character_build_trigger
before insert or update of level, attributes, skills, growth_vigor, growth_reserve on public.characters
for each row execute procedure public.validate_character_build();

create or replace function public.protect_character_update()
returns trigger
language plpgsql
security definer set search_path=public
as $$
begin
  if public.is_master() then
    return new;
  end if;

  -- Jogador nunca altera campos administrativos diretamente. A exceÃ§Ã£o level/xp Ã© somente
  -- a RPC `level_up_character`, marcada por uma configuraÃ§Ã£o local da transaÃ§Ã£o.
  new.owner_id := old.owner_id;
  new.entity_type := old.entity_type;
  new.parent_character_id := old.parent_character_id;
  new.campaign_id := old.campaign_id;
  if coalesce(current_setting('app.level_up', true),'') <> 'true' then
    new.level := old.level;
    new.xp := old.xp;
  end if;
  new.grade := old.grade;
  new.permanent_ps_bonus := old.permanent_ps_bonus;
  new.permanent_ea_bonus := old.permanent_ea_bonus;

  -- Respec Ã© permitido apenas fora de sessÃ£o.
  if public.has_active_session() and (
    new.attributes is distinct from old.attributes or
    new.skills is distinct from old.skills or
    new.growth_vigor is distinct from old.growth_vigor or
    new.growth_reserve is distinct from old.growth_reserve
  ) then
    raise exception 'RedistribuiÃ§Ã£o de atributos, perÃ­cias e crescimento sÃ³ Ã© permitida fora de sessÃ£o.';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_character_update_trigger on public.characters;
create trigger protect_character_update_trigger
before update on public.characters
for each row execute procedure public.protect_character_update();

create or replace function public.protect_character_insert()
returns trigger
language plpgsql
security definer set search_path=public
as $$
begin
  if public.is_master() then return new; end if;
  if coalesce(current_setting('app.summon_insert', true),'') = 'true' then return new; end if;
  new.owner_id := auth.uid();
  new.entity_type := 'player';
  new.level := 5;
  new.xp := 0;
  new.grade := 'Grau 4';
  new.permanent_ps_bonus := 0;
  new.permanent_ea_bonus := 0;
  return new;
end;
$$;

drop trigger if exists protect_character_insert_trigger on public.characters;
create trigger protect_character_insert_trigger
before insert on public.characters
for each row execute procedure public.protect_character_insert();

create or replace function public.level_up_character(p_character_id uuid)
returns public.characters
language plpgsql
security definer set search_path=public
as $$
declare
  c public.characters;
  cost int;
begin
  select * into c from public.characters where id=p_character_id for update;
  if not found then raise exception 'Personagem nÃ£o encontrado.'; end if;
  if not (public.is_master() or c.owner_id=auth.uid()) then raise exception 'Sem permissÃ£o.'; end if;
  if public.has_active_session() and not public.is_master() then raise exception 'NÃ£o Ã© possÃ­vel subir de nÃ­vel durante sessÃ£o ativa.'; end if;
  if c.level >= 100 then raise exception 'NÃ­vel mÃ¡ximo alcanÃ§ado.'; end if;
  cost := public.xp_cost_for_next_level(c.level);
  if c.xp < cost then raise exception 'XP insuficiente.'; end if;

  perform set_config('app.level_up','true',true);
  update public.characters
  set level=level+1, xp=xp-cost, updated_at=now()
  where id=p_character_id
  returning * into c;
  return c;
end;
$$;


create or replace function public.create_summon_sheet(p_parent_id uuid, p_name text)
returns public.characters
language plpgsql
security definer set search_path=public
as $$
declare
  parent public.characters;
  child public.characters;
begin
  select * into parent from public.characters where id=p_parent_id;
  if not found then raise exception 'Personagem principal nÃ£o encontrado.'; end if;
  if not (public.is_master() or parent.owner_id=auth.uid()) then raise exception 'Sem permissÃ£o.'; end if;
  if not public.is_master() and not exists(
    select 1 from public.abilities a where a.character_id=p_parent_id and a.category='manifestation' and a.status='approved'
  ) then
    raise exception 'Ã‰ necessÃ¡ria uma ManifestaÃ§Ã£o aprovada antes de criar uma ficha filha.';
  end if;

  perform set_config('app.summon_insert','true',true);
  insert into public.characters(
    campaign_id,owner_id,parent_character_id,entity_type,first_name,last_name,grade,level,xp,
    attributes,skills,growth_vigor,growth_reserve
  ) values (
    parent.campaign_id,parent.owner_id,parent.id,'summon',p_name,'','Sem Grau',parent.level,0,
    parent.attributes,parent.skills,parent.growth_vigor,parent.growth_reserve
  ) returning * into child;
  return child;
end;
$$;

-- ============================================================
-- SESSÃƒO / TEMPO LIVRE
-- ============================================================

create or replace function public.start_session(p_title text default '')
returns public.sessions
language plpgsql
security definer set search_path=public
as $$
declare s public.sessions;
begin
  if not public.is_master() then raise exception 'Apenas o mestre pode iniciar sessÃµes.'; end if;
  if exists(select 1 from public.sessions where campaign_id='00000000-0000-0000-0000-000000000001' and status='active') then
    raise exception 'JÃ¡ existe uma sessÃ£o ativa.';
  end if;

  update public.free_time_balances
  set expired=true
  where expired=false;

  insert into public.sessions(campaign_id,title,status,created_by)
  values('00000000-0000-0000-0000-000000000001',coalesce(p_title,''),'active',auth.uid())
  returning * into s;
  return s;
end;
$$;

create or replace function public.end_session(p_awards jsonb default '{}'::jsonb)
returns public.sessions
language plpgsql
security definer set search_path=public
as $$
declare
  s public.sessions;
  c record;
  award jsonb;
  xp_gain int;
  days_gain int;
begin
  if not public.is_master() then raise exception 'Apenas o mestre pode encerrar sessÃµes.'; end if;
  select * into s from public.sessions
  where campaign_id='00000000-0000-0000-0000-000000000001' and status='active'
  for update;
  if not found then raise exception 'NÃ£o existe sessÃ£o ativa.'; end if;

  for c in select * from public.characters where entity_type='player' and owner_id is not null loop
    award := coalesce(p_awards -> c.id::text, '{}'::jsonb);
    xp_gain := greatest(0, coalesce((award->>'xp')::int,0));
    days_gain := greatest(0, coalesce((award->>'days')::int,0));

    if xp_gain > 0 then
      update public.characters set xp=xp+xp_gain, updated_at=now() where id=c.id;
    end if;

    insert into public.free_time_balances(session_id,character_id,granted,committed,spent,expired)
    values(s.id,c.id,days_gain,0,0,false)
    on conflict(session_id,character_id) do update set granted=excluded.granted, expired=false;
  end loop;

  update public.sessions set status='ended', ended_at=now() where id=s.id returning * into s;
  return s;
end;
$$;

create or replace function public.submit_training_ticket(
  p_character_id uuid,
  p_activity text,
  p_description text,
  p_days int
)
returns public.training_tickets
language plpgsql
security definer set search_path=public
as $$
declare
  b public.free_time_balances;
  t public.training_tickets;
begin
  if not (public.is_master() or public.owns_character(p_character_id)) then raise exception 'Sem permissÃ£o.'; end if;
  if p_days <= 0 then raise exception 'Quantidade de dias invÃ¡lida.'; end if;

  select * into b from public.free_time_balances
  where character_id=p_character_id and expired=false
  order by created_at desc limit 1 for update;
  if not found then raise exception 'NÃ£o existem dias livres disponÃ­veis.'; end if;
  if b.granted - b.committed - b.spent < p_days then raise exception 'Dias livres insuficientes.'; end if;

  update public.free_time_balances set committed=committed+p_days where id=b.id;
  insert into public.training_tickets(balance_id,character_id,activity,description,days_requested)
  values(b.id,p_character_id,p_activity,coalesce(p_description,''),p_days)
  returning * into t;
  return t;
end;
$$;

create or replace function public.resolve_training_ticket(
  p_ticket_id uuid,
  p_status text,
  p_master_response text default ''
)
returns public.training_tickets
language plpgsql
security definer set search_path=public
as $$
declare
  t public.training_tickets;
begin
  if not public.is_master() then raise exception 'Apenas o mestre resolve tickets.'; end if;
  if p_status not in ('approved','rejected') then raise exception 'Status invÃ¡lido.'; end if;

  select * into t from public.training_tickets where id=p_ticket_id for update;
  if not found then raise exception 'Ticket nÃ£o encontrado.'; end if;
  if t.status <> 'pending' then raise exception 'Ticket jÃ¡ resolvido.'; end if;

  if p_status='approved' then
    update public.free_time_balances set committed=committed-t.days_requested, spent=spent+t.days_requested where id=t.balance_id;
  else
    update public.free_time_balances set committed=committed-t.days_requested where id=t.balance_id;
  end if;

  update public.training_tickets
  set status=p_status, master_response=coalesce(p_master_response,''), resolved_at=now()
  where id=p_ticket_id returning * into t;
  return t;
end;
$$;

-- ============================================================
-- PROTEÃ‡ÃƒO DE VOTOS / HABILIDADES
-- ============================================================

create or replace function public.protect_vow_update()
returns trigger
language plpgsql
security definer set search_path=public
as $$
begin
  if public.is_master() then return new; end if;
  if not public.owns_character(old.character_id) then raise exception 'Sem permissÃ£o.'; end if;

  -- Player sÃ³ pode: active -> player_disabled; available_reactivation -> active.
  if new.status is distinct from old.status then
    if not (
      (old.status='active' and new.status='player_disabled') or
      (old.status='available_reactivation' and new.status='active')
    ) then
      raise exception 'O estado deste voto sÃ³ pode ser alterado pelo mestre.';
    end if;
  end if;

  -- Depois de aprovado, editar termos manda o voto de volta para pendente,
  -- exceto quando estÃ¡ bloqueado pelo mestre.
  if (new.name is distinct from old.name or new.restriction is distinct from old.restriction or new.benefit is distinct from old.benefit or new.break_condition is distinct from old.break_condition) then
    if old.status='master_locked' then raise exception 'Voto bloqueado pelo mestre nÃ£o pode ser editado.'; end if;
    new.status := 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_vow_update_trigger on public.vows;
create trigger protect_vow_update_trigger before update on public.vows
for each row execute procedure public.protect_vow_update();

create or replace function public.protect_ability_update()
returns trigger
language plpgsql
security definer set search_path=public
as $$
begin
  if public.is_master() then return new; end if;
  if not public.owns_character(old.character_id) then raise exception 'Sem permissÃ£o.'; end if;
  new.vp_approved := old.vp_approved;
  new.limit_override := old.limit_override;
  new.master_response := old.master_response;
  if new.name is distinct from old.name or new.description is distinct from old.description or new.mechanics is distinct from old.mechanics or new.config is distinct from old.config or new.vp_estimated is distinct from old.vp_estimated then
    new.status := 'pending';
  else
    new.status := old.status;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_ability_update_trigger on public.abilities;
create trigger protect_ability_update_trigger before update on public.abilities
for each row execute procedure public.protect_ability_update();

-- ============================================================
-- AUDITORIA
-- ============================================================

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer set search_path=public
as $$
declare
  cid uuid;
  oldj jsonb;
  newj jsonb;
begin
  oldj := case when tg_op='INSERT' then null else to_jsonb(old) end;
  newj := case when tg_op='DELETE' then null else to_jsonb(new) end;

  if tg_table_name='characters' then
    cid := coalesce((newj->>'id')::uuid, (oldj->>'id')::uuid);
  else
    cid := coalesce((newj->>'character_id')::uuid, (oldj->>'character_id')::uuid);
  end if;

  insert into public.audit_logs(actor_id,character_id,table_name,action,summary,old_data,new_data)
  values(auth.uid(),cid,tg_table_name,tg_op,tg_table_name || ' ' || lower(tg_op),oldj,newj);

  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

-- Auditoria das tabelas mais relevantes.
drop trigger if exists audit_characters on public.characters;
create trigger audit_characters after insert or update or delete on public.characters for each row execute procedure public.audit_row_change();
drop trigger if exists audit_abilities on public.abilities;
create trigger audit_abilities after insert or update or delete on public.abilities for each row execute procedure public.audit_row_change();
drop trigger if exists audit_vows on public.vows;
create trigger audit_vows after insert or update or delete on public.vows for each row execute procedure public.audit_row_change();
drop trigger if exists audit_equipment on public.equipment;
create trigger audit_equipment after insert or update or delete on public.equipment for each row execute procedure public.audit_row_change();
drop trigger if exists audit_training_tickets on public.training_tickets;
create trigger audit_training_tickets after insert or update or delete on public.training_tickets for each row execute procedure public.audit_row_change();
drop trigger if exists audit_master_requests on public.master_requests;
create trigger audit_master_requests after insert or update or delete on public.master_requests for each row execute procedure public.audit_row_change();
drop trigger if exists audit_transformations on public.transformations;
create trigger audit_transformations after insert or update or delete on public.transformations for each row execute procedure public.audit_row_change();

-- ============================================================
-- STORAGE
-- ============================================================

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('character-images','character-images',true,5242880,array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update set public=true, file_size_limit=5242880;

-- Impede escalada de privilÃ©gio pela prÃ³pria tabela de perfil.
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer set search_path=public
as $$
begin
  if coalesce(auth.role(),'') = 'service_role' then return new; end if;
  if new.role is distinct from old.role and not public.is_master() then
    raise exception 'Apenas o mestre pode alterar papÃ©is de acesso.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_role_trigger on public.profiles;
create trigger protect_profile_role_trigger before update on public.profiles
for each row execute procedure public.protect_profile_role();


create or replace function public.ability_slot_limit(p_level int, p_category text)
returns int language sql immutable as $$
  select case p_category
    when 'technique' then 3 + floor((greatest(1,least(100,p_level))-1)/10.0)::int
    when 'general' then 3 + floor((greatest(1,least(100,p_level))-1)/15.0)::int
    when 'manifestation' then 1 + floor((greatest(1,least(100,p_level))-1)/25.0)::int
    when 'transformation' then 1 + floor((greatest(1,least(100,p_level))-1)/25.0)::int
    when 'domain' then 0
    else 0 end;
$$;

create or replace function public.ability_vp_limit(p_level int, p_category text)
returns int language sql immutable as $$
  select case p_category
    when 'technique' then 7 + ceil(greatest(1,least(100,p_level))/5.0)::int
    when 'general' then 5 + ceil(greatest(1,least(100,p_level))/5.0)::int
    when 'manifestation' then 7 + ceil(greatest(1,least(100,p_level))/5.0)::int
    when 'transformation' then 4 + ceil(greatest(1,least(100,p_level))/5.0)::int
    when 'domain' then 0
    else 0 end;
$$;

create or replace function public.ability_single_vp_limit(p_level int, p_category text)
returns int language sql immutable as $$
  select case p_category
    when 'technique' then least(10, 4 + floor((greatest(1,least(100,p_level))-1)/15.0)::int)
    when 'general' then least(8, 3 + floor((greatest(1,least(100,p_level))-1)/18.0)::int)
    when 'manifestation' then least(12, 5 + floor((greatest(1,least(100,p_level))-1)/12.0)::int)
    when 'transformation' then least(12, 5 + floor((greatest(1,least(100,p_level))-1)/12.0)::int)
    when 'domain' then 0
    else 0 end;
$$;

create or replace function public.enforce_approved_ability_budget()
returns trigger
language plpgsql
security definer set search_path=public
as $$
declare
  lvl int;
  used_slots int;
  used_vp int;
  vp_value int;
begin
  if new.status <> 'approved' or new.limit_override then return new; end if;
  select level into lvl from public.characters where id=new.character_id;
  vp_value := coalesce(new.vp_approved,new.vp_estimated,1);
  if vp_value > public.ability_single_vp_limit(lvl,new.category) then
    raise exception 'Habilidade excede o VP mÃ¡ximo individual desta categoria no nÃ­vel atual.';
  end if;
  select count(*), coalesce(sum(coalesce(vp_approved,vp_estimated)),0)
    into used_slots, used_vp
  from public.abilities
  where character_id=new.character_id and category=new.category and status='approved' and id<>new.id and not limit_override;

  if used_slots + 1 > public.ability_slot_limit(lvl,new.category) then
    raise exception 'Quantidade de slots aprovada excederia o limite do personagem.';
  end if;
  if used_vp + vp_value > public.ability_vp_limit(lvl,new.category) then
    raise exception 'VP total aprovado excederia a capacidade da categoria.';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_approved_ability_budget_trigger on public.abilities;
create trigger enforce_approved_ability_budget_trigger
before insert or update of status, vp_approved, category, character_id, limit_override on public.abilities
for each row execute procedure public.enforce_approved_ability_budget();

create or replace function public.protect_ability_insert()
returns trigger
language plpgsql
security definer set search_path=public
as $$
begin
  if not public.is_master() then
    new.status := 'pending';
    new.vp_approved := null;
    new.limit_override := false;
    new.master_response := '';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_ability_insert_trigger on public.abilities;
create trigger protect_ability_insert_trigger before insert on public.abilities
for each row execute procedure public.protect_ability_insert();

create or replace function public.protect_vow_insert()
returns trigger
language plpgsql
security definer set search_path=public
as $$
begin
  if not public.is_master() then
    new.status := 'pending';
    new.master_response := '';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_vow_insert_trigger on public.vows;
create trigger protect_vow_insert_trigger before insert on public.vows
for each row execute procedure public.protect_vow_insert();

create or replace function public.protect_transformation_write()
returns trigger
language plpgsql
security definer set search_path=public
as $$
begin
  if not public.is_master() then
    if tg_op='INSERT' then new.approved := false;
    else new.approved := old.approved; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_transformation_write_trigger on public.transformations;
create trigger protect_transformation_write_trigger before insert or update on public.transformations
for each row execute procedure public.protect_transformation_write();

-- ============================================================
-- RLS
-- ============================================================

alter table public.profiles enable row level security;
alter table public.campaigns enable row level security;
alter table public.system_attributes enable row level security;
alter table public.system_skills enable row level security;
alter table public.system_conditions enable row level security;
alter table public.characters enable row level security;
alter table public.character_master_secrets enable row level security;
alter table public.master_progress_tracks enable row level security;
alter table public.abilities enable row level security;
alter table public.vows enable row level security;
alter table public.equipment enable row level security;
alter table public.transformations enable row level security;
alter table public.sessions enable row level security;
alter table public.free_time_balances enable row level security;
alter table public.training_tickets enable row level security;
alter table public.master_requests enable row level security;
alter table public.combat_encounters enable row level security;
alter table public.combat_participants enable row level security;
alter table public.roll_logs enable row level security;
alter table public.audit_logs enable row level security;

-- Perfis
create policy "profiles_read_own_or_master" on public.profiles for select to authenticated
using (id=auth.uid() or public.is_master());
create policy "profiles_update_own_or_master" on public.profiles for update to authenticated
using (id=auth.uid() or public.is_master()) with check (id=auth.uid() or public.is_master());

-- Campanha e regras: leitura para autenticados, escrita apenas mestre
create policy "campaign_read" on public.campaigns for select to authenticated using (true);
create policy "campaign_master_write" on public.campaigns for all to authenticated using (public.is_master()) with check (public.is_master());

create policy "attributes_read" on public.system_attributes for select to authenticated using (active or public.is_master());
create policy "attributes_master_write" on public.system_attributes for all to authenticated using (public.is_master()) with check (public.is_master());
create policy "skills_read" on public.system_skills for select to authenticated using (active or public.is_master());
create policy "skills_master_write" on public.system_skills for all to authenticated using (public.is_master()) with check (public.is_master());
create policy "conditions_read" on public.system_conditions for select to authenticated using (active or public.is_master());
create policy "conditions_master_write" on public.system_conditions for all to authenticated using (public.is_master()) with check (public.is_master());

-- Personagens: jogador recebe apenas a prÃ³pria ficha/fichas-filhas; mestre recebe tudo.
create policy "characters_select" on public.characters for select to authenticated
using (public.is_master() or owner_id=auth.uid() or (parent_character_id is not null and public.owns_character(parent_character_id)));
create policy "characters_insert" on public.characters for insert to authenticated
with check (public.is_master() or (owner_id=auth.uid() and entity_type='player'));
create policy "characters_update" on public.characters for update to authenticated
using (public.is_master() or owner_id=auth.uid()) with check (public.is_master() or owner_id=auth.uid());
create policy "characters_delete" on public.characters for delete to authenticated
using (public.is_master());

-- SEGREDOS: exclusivamente mestre. NÃ£o criar policy de jogador aqui.
create policy "master_secrets_master_only" on public.character_master_secrets for all to authenticated
using (public.is_master()) with check (public.is_master());
create policy "master_progress_master_only" on public.master_progress_tracks for all to authenticated
using (public.is_master()) with check (public.is_master());

-- Habilidades / votos / equipamentos / transformaÃ§Ãµes
create policy "abilities_select" on public.abilities for select to authenticated
using (public.is_master() or public.owns_character(character_id));
create policy "abilities_insert" on public.abilities for insert to authenticated
with check (public.is_master() or public.owns_character(character_id));
create policy "abilities_update" on public.abilities for update to authenticated
using (public.is_master() or public.owns_character(character_id)) with check (public.is_master() or public.owns_character(character_id));
create policy "abilities_delete" on public.abilities for delete to authenticated
using (public.is_master() or public.owns_character(character_id));

create policy "vows_select" on public.vows for select to authenticated
using (public.is_master() or public.owns_character(character_id));
create policy "vows_insert" on public.vows for insert to authenticated
with check (public.is_master() or public.owns_character(character_id));
create policy "vows_update" on public.vows for update to authenticated
using (public.is_master() or public.owns_character(character_id)) with check (public.is_master() or public.owns_character(character_id));
create policy "vows_delete" on public.vows for delete to authenticated
using (public.is_master() or (public.owns_character(character_id) and status='pending'));

create policy "equipment_all" on public.equipment for all to authenticated
using (public.is_master() or public.owns_character(character_id)) with check (public.is_master() or public.owns_character(character_id));

create policy "transformations_select" on public.transformations for select to authenticated
using (public.is_master() or public.owns_character(character_id));
create policy "transformations_write" on public.transformations for all to authenticated
using (public.is_master() or public.owns_character(character_id)) with check (public.is_master() or public.owns_character(character_id));

-- SessÃµes visÃ­veis a todos, mutaÃ§Ã£o via RPC/master.
create policy "sessions_read" on public.sessions for select to authenticated using (true);
create policy "sessions_master_write" on public.sessions for all to authenticated using (public.is_master()) with check (public.is_master());

create policy "free_time_select" on public.free_time_balances for select to authenticated
using (public.is_master() or public.owns_character(character_id));
create policy "free_time_master_write" on public.free_time_balances for all to authenticated
using (public.is_master()) with check (public.is_master());

create policy "training_select" on public.training_tickets for select to authenticated
using (public.is_master() or public.owns_character(character_id));
create policy "training_master_write" on public.training_tickets for update to authenticated
using (public.is_master()) with check (public.is_master());

create policy "master_requests_select" on public.master_requests for select to authenticated
using (public.is_master() or public.owns_character(character_id));
create policy "master_requests_insert" on public.master_requests for insert to authenticated
with check (public.is_master() or public.owns_character(character_id));
create policy "master_requests_master_update" on public.master_requests for update to authenticated
using (public.is_master()) with check (public.is_master());

-- Combate: encontro Ã© conhecido; participante sÃ³ o prÃ³prio ou mestre.
create policy "encounter_read" on public.combat_encounters for select to authenticated using (true);
create policy "encounter_master_write" on public.combat_encounters for all to authenticated using (public.is_master()) with check (public.is_master());

create policy "participants_select" on public.combat_participants for select to authenticated
using (public.is_master() or public.owns_character(character_id));
create policy "participants_master_insert" on public.combat_participants for insert to authenticated
with check (public.is_master());
create policy "participants_update" on public.combat_participants for update to authenticated
using (public.is_master() or public.owns_character(character_id)) with check (public.is_master() or public.owns_character(character_id));
create policy "participants_master_delete" on public.combat_participants for delete to authenticated
using (public.is_master());

-- Rolagens do mestre nunca sÃ£o lidas por jogador quando visibility='master'.
create policy "rolls_select" on public.roll_logs for select to authenticated
using (
  public.is_master()
  or visibility='public'
  or (visibility='owner' and character_id is not null and public.owns_character(character_id))
);
create policy "rolls_insert" on public.roll_logs for insert to authenticated
with check (
  public.is_master()
  or (character_id is not null and public.owns_character(character_id) and visibility in ('public','owner'))
);

create policy "audit_select" on public.audit_logs for select to authenticated
using (public.is_master() or actor_id=auth.uid() or (character_id is not null and public.owns_character(character_id)));

-- Storage: imagens pÃºblicas, mas upload/alteraÃ§Ã£o sÃ³ na prÃ³pria pasta ou por mestre.
create policy "character_images_insert" on storage.objects for insert to authenticated
with check (bucket_id='character-images' and (public.is_master() or (storage.foldername(name))[1]=auth.uid()::text));
create policy "character_images_update" on storage.objects for update to authenticated
using (bucket_id='character-images' and (public.is_master() or owner_id=auth.uid()::text))
with check (bucket_id='character-images' and (public.is_master() or owner_id=auth.uid()::text));
create policy "character_images_delete" on storage.objects for delete to authenticated
using (bucket_id='character-images' and (public.is_master() or owner_id=auth.uid()::text));

-- ============================================================
-- GRANTS
-- ============================================================

grant usage on schema public to authenticated;
grant select on public.campaigns to authenticated;
grant select, insert, update, delete on public.system_attributes, public.system_skills, public.system_conditions to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.characters, public.abilities, public.vows, public.equipment, public.transformations to authenticated;
grant select, insert, update, delete on public.character_master_secrets, public.master_progress_tracks to authenticated;
grant select, insert, update, delete on public.sessions, public.free_time_balances, public.training_tickets, public.master_requests to authenticated;
grant select, insert, update, delete on public.combat_encounters, public.combat_participants, public.roll_logs to authenticated;
grant select on public.audit_logs to authenticated;
grant execute on function public.level_up_character(uuid) to authenticated;
grant execute on function public.create_summon_sheet(uuid,text) to authenticated;
grant execute on function public.start_session(text) to authenticated;
grant execute on function public.end_session(jsonb) to authenticated;
grant execute on function public.submit_training_ticket(uuid,text,text,int) to authenticated;
grant execute on function public.resolve_training_ticket(uuid,text,text) to authenticated;

-- Realtime usado pela sala de combate. Em projeto novo essas tabelas ainda nÃ£o fazem parte da publicaÃ§Ã£o.
do $$
begin
  begin alter publication supabase_realtime add table public.combat_encounters; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.combat_participants; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.roll_logs; exception when duplicate_object then null; end;
end $$;

-- ============================================================
-- NOTAS DE SEGURANÃ‡A / CONTINUAÃ‡ÃƒO
-- ============================================================
-- 1. `character_master_secrets` e `master_progress_tracks` nÃ£o possuem policy de leitura para players.
-- 2. Service role / secret key NUNCA deve ir para Vite/GitHub Pages.
-- 3. DomÃ­nio absoluto e outros conceitos narrativamente desconhecidos nÃ£o aparecem neste schema pÃºblico por nome.
-- 4. A estrutura `campaigns.system_key` foi deixada genÃ©rica para futuro suporte a outro sistema,
--    mas a UI atual deve apresentar APENAS Correntes do Destino.


