import assert from 'node:assert/strict';
import fs from 'node:fs';
import { testDatabase, asUser } from './lib/test-db.mjs';
import { GENERIC_ENEMY_ID, IMPROVISED_ACTIONS, improvisedPayload, improvisedFormHtml } from '../src/lib/improvised-combat.js';

const master = '00000000-0000-4000-8000-000000000010';
const player = '00000000-0000-4000-8000-000000000011';
const outsider = '00000000-0000-4000-8000-000000000012';
const pc = '00000000-0000-4000-8000-000000000020';
const npc = '00000000-0000-4000-8000-000000000021';
let encounter;
const db = await testDatabase({ beforeNewMigrations: async db => {
  await db.exec(`insert into auth.users(id,email) values('${master}','master@test.invalid'),('${player}','player@test.invalid'),('${outsider}','outsider@test.invalid');
    select set_config('request.jwt.claim.role','service_role',false);
    update profiles set role='master' where id='${master}';
    select set_config('request.jwt.claim.role','authenticated',false);
    select set_config('request.jwt.claim.sub','${master}',false);
    insert into characters(id,owner_id,entity_type,first_name) values('${pc}','${player}','player','Jogador'),('${npc}',null,'npc','Identidade secreta');
    insert into system_conditions(key,name,description) values('legacy_secret','CondiÃ§Ã£o secreta','O alvo estÃ¡ em posiÃ§Ã£o alterada.');
    insert into abilities(character_id,category,name,status,config) values('${pc}','general','Habilidade conhecida','approved','{"pa_cost":1,"master_secret":"SEGREDO_TESTE","nested":{"internal_note":"SEGREDO_TESTE","value":3}}');
    insert into character_cursed_body_techniques(character_id,name,master_notes) values('${pc}','Corpo oculto','SEGREDO_TESTE');
    insert into abilities(character_id,category,name,status,cursed_body_technique_id) select '${pc}','general','Habilidade oculta','disabled',id from character_cursed_body_techniques where character_id='${pc}';
    insert into abilities(character_id,category,name,status) values('${npc}','general','Técnica futura','approved');
  `);
  encounter = (await db.query("insert into combat_encounters(name) values('Teste') returning id")).rows[0].id;
  await db.query('insert into combat_participants(encounter_id,character_id) values($1,$2),($1,$3)', [encounter,pc,npc]);
  await db.query('update combat_participants set current_ps=combat_max_ps(character_id),current_ea=combat_max_ea(character_id),current_pa=combat_max_pa(character_id) where encounter_id=$1',[encounter]);
  await db.query("select commit_combat_undo(begin_combat_undo($1,'Snapshot anterior'))", [encounter]);
  await db.exec("select set_config('request.jwt.claim.sub','',false)");
}});
const query = async (sql, params = []) => (await db.query(sql, params)).rows;
const value = async (sql, params = []) => (await query(sql, params))[0]?.value;
const rpc = (name, args = []) => value(`select to_jsonb(public.${name}(${args.map((_,i) => `$${i+1}`).join(',')})) as value`, args);
const gm = fn => asUser(db, master, fn);
const pl = fn => asUser(db, player, fn);
const improvise = action => rpc('improvise_combat_action', [encounter, JSON.stringify({ target_id:pc, ...action })]);
const participant = async id => {
  if (await value('select current_user as value') === 'postgres') return value('select to_jsonb(p) as value from combat_participants p where encounter_id=$1 and character_id=$2',[encounter,id]);
  const rows=await query('select p as value from get_combat_participants($1) p where p->>\'character_id\'=$2',[encounter,id]);
  const p=rows[0]?.value;if (p) delete p.characters;return p;
};
const undo = () => rpc('undo_last_combat_action',[encounter]);
let checks = 0;
async function test(name, run) {
  try { await run(); checks++; console.log(`OK: ${name}`); }
  catch (error) { console.error(`FALHOU: ${name}: ${error.message}\n${error.where || ''}`); throw new Error(name); }
}
try {
  await test('migrations preservam catálogo legado e snapshots anteriores', async () => {
    assert.equal(await value("select name as value from system_conditions where key='legacy_secret'"), 'Condição secreta');
    assert.equal(await value("select description as value from system_conditions where key='legacy_secret'"), 'O alvo está em posição alterada.');
    assert.equal(await value('select count(*)::int as value from combat_undo_snapshots'),1);
    assert.equal(await gm(undo),'Snapshot anterior');
    assert.ok(await participant(pc));
  });
  await test('Inimigo permanente, neutro e editável nos atributos', async () => {
    const enemy = await value('select to_jsonb(c) as value from characters c where id=$1',[GENERIC_ENEMY_ID]);
    assert.equal(enemy.entity_type,'enemy'); assert.equal(enemy.first_name,'Inimigo');
    for (const key of ['last_name','biography','personality','goals','appearance','notes','technique_name','technique_description']) assert.equal(enemy[key],'');
    await gm(async () => {
      await query("update characters set attributes=jsonb_set(attributes,'{strength}','3') where id=$1",[GENERIC_ENEMY_ID]);
      await assert.rejects(query('delete from characters where id=$1',[GENERIC_ENEMY_ID]), /permanente/);
      await query('insert into combat_participants(encounter_id,character_id,side_key) values($1,$2,\'enemy\')',[encounter,GENERIC_ENEMY_ID]);
    });
    assert.equal(await pl(() => value('select count(*)::int as value from characters where id=$1',[GENERIC_ENEMY_ID])),0);
  });
  await test('45 condições genéricas UTF-8, sem novas pistas de conteúdo futuro', async () => {
    const catalog = JSON.parse(fs.readFileSync('data/system/conditions.json','utf8'));
    const received = await pl(() => query('select key,name,description from system_conditions order by key'));
    assert.deepEqual(received,catalog.toSorted((a,b)=>a.key.localeCompare(b.key)));
    assert.ok(!/Ã|Â|�|Correntes da Verdade|Aposta Fortificada|Mandato Real/.test(JSON.stringify(received)));
    await gm(() => query("insert into system_conditions(key,name,description) values('future','CONTEUDO_FUTURO','SEGREDO_TESTE')"));
    assert.equal(await pl(() => value('select count(*)::int as value from system_conditions')),45);
    await gm(()=>assert.rejects(query("update system_conditions set name='Técnica futura' where key='stunned'"),/genérica pública/));
    await gm(()=>query("update system_conditions set public_catalog=true where key='future'"));
    assert.equal(await pl(() => value('select count(*)::int as value from system_conditions')),45);
  });
  await test('dano direto, limites, derrota e Undo restauram PS e log', async () => gm(async () => {
    const before=await participant(pc);
    await improvise({kind:'damage',amount:7,public_text:'O chão cede.'});
    assert.equal((await participant(pc)).current_ps,before.current_ps-7);
    assert.equal(await value("select label as value from roll_logs where roll_type='improvised' order by created_at desc limit 1"),'O chão cede.');
    await undo(); assert.equal((await participant(pc)).current_ps,before.current_ps);
    assert.equal(await value("select count(*)::int as value from roll_logs where roll_type='improvised'"),0);
    await improvise({kind:'damage',amount:100000}); assert.equal((await participant(pc)).defeated,true); await undo();
    const latest=await query('select * from get_latest_combat_undo($1)',[encounter]);
    for(const amount of [-1,1.5,null,100001]) await assert.rejects(improvise({kind:'damage',amount}));
    assert.deepEqual(await query('select * from get_latest_combat_undo($1)',[encounter]),latest);
  }));
  await test('cura e EA respeitam limites e Undo', async () => gm(async () => {
    await improvise({kind:'damage',amount:100000});
    await improvise({kind:'heal',amount:5}); assert.equal((await participant(pc)).current_ps,5); assert.equal((await participant(pc)).defeated,false);
    await undo(); assert.equal((await participant(pc)).current_ps,0); await undo();
    const before=await participant(pc);
    await improvise({kind:'heal',amount:100000}); assert.equal((await participant(pc)).current_ps,before.current_ps); await undo();
    await improvise({kind:'energy',amount:-100000}); assert.equal((await participant(pc)).current_ea,0);
    await improvise({kind:'energy',amount:100000}); assert.equal((await participant(pc)).current_ea,before.current_ea);
    await undo(); assert.equal((await participant(pc)).current_ea,0); await undo(); assert.equal((await participant(pc)).current_ea,before.current_ea);
  }));
  await test('ação narrativa aceita ausência de alvo e publica somente texto escolhido', async () => {
    const before=await participant(pc);
    await gm(()=>improvise({kind:'narrative',target_id:null,public_text:'Um estrondo ecoa ao longe.'}));
    assert.deepEqual(await participant(pc),before);
    const logs=await pl(()=>query("select * from roll_logs where roll_type='improvised'"));
    assert.equal(logs[0].label,'Um estrondo ecoa ao longe.'); assert.equal(logs[0].character_id,null);
    await gm(undo);
    await gm(()=>assert.rejects(improvise({kind:'narrative',target_id:null,public_text:''}),/narrativa/));
  });
  await test('efeito do catálogo reutiliza combat_effect_states e expira por turno', async () => gm(async () => {
    const base=await rpc('combat_ca',[pc]);
    await improvise({kind:'effect',condition_key:'protected',remaining_turns:1,modifiers:{ca_bonus:2}});
    assert.equal(await rpc('combat_ca',[pc]),base+2);
    const p=await participant(pc); await rpc('start_combat_turn',[p.id]); await rpc('end_combat_turn',[p.id]);
    assert.equal(await value("select count(*)::int as value from combat_effect_states where source_type='improvised'"),0);
    assert.equal(await rpc('combat_ca',[pc]),base);
    await undo();
  }));
  await test('efeito personalizado não cadastra habilidade/condição e consome usos com Undo', async () => gm(async () => {
    const n=await value('select count(*)::int as value from system_conditions');
    const a=await value('select count(*)::int as value from abilities');
    const id=await improvise({kind:'effect',name:'Equilíbrio instável',uses:2,modifiers:{ca_bonus:-2}});
    assert.equal(await value('select count(*)::int as value from system_conditions'),n);
    assert.equal(await value('select count(*)::int as value from abilities'),a);
    await rpc('manage_improvised_effect',[id,true]); assert.equal(await value('select uses_remaining as value from combat_effect_states where id=$1',[id]),1);
    await rpc('manage_improvised_effect',[id,true]); assert.equal(await value('select count(*)::int as value from combat_effect_states where id=$1',[id]),0);
    await undo(); assert.equal(await value('select uses_remaining as value from combat_effect_states where id=$1',[id]),1);
    await undo(); await undo();
  }));
  await test('payload de efeitos não revela origem, flags ou efeitos ocultos', async () => {
    await gm(()=>improvise({kind:'effect',name:'Estado perceptível',actor_id:npc,description:'Movimentos limitados.',modifiers:{blocks_movement:true}}));
    await gm(()=>improvise({kind:'effect',name:'SEGREDO_TESTE',visible:false,actor_id:npc}));
    await pl(async () => {
      const effects=await query('select * from get_visible_combat_effects($1)',[encounter]);
      assert.equal(effects.length,1);
      const json=JSON.stringify(effects);
      for(const forbidden of ['SEGREDO_TESTE',npc,'source_id','source_character_id','blocks_movement','effect_key','master_secret','"data"']) assert.ok(!json.includes(forbidden),forbidden);
      assert.equal(await value('select count(*)::int as value from combat_effect_states'),0);
    });
    await gm(async()=>{await undo();await undo();});
  });
  await test('RLS bloqueia jogadores nas ferramentas, Undo e configurações privadas', async () => pl(async () => {
    await assert.rejects(improvise({kind:'damage',amount:5}),/Somente o Mestre/);
    await assert.rejects(undo(),/Somente o Mestre/);
    await assert.rejects(query('select * from combat_undo_snapshots'),/permission denied/);
    assert.equal(await value('select count(*)::int as value from ability_master_data'),0);
    assert.equal(await value('select count(*)::int as value from abilities where character_id=$1',[npc]),0);
    assert.equal(await value("select count(*)::int as value from abilities where name='Habilidade oculta'"),0);
    assert.equal(await value('select count(*)::int as value from audit_logs'),0);
    assert.ok(!JSON.stringify(await query('select * from abilities')).includes('SEGREDO_TESTE'));
    assert.equal(await rpc('get_visible_cursed_body',[pc]),null);
    await assert.rejects(query('select master_notes from character_cursed_body_techniques'),/permission denied/);
    await assert.rejects(rpc('capture_combat_state',[encounter]),/permission denied/);
  }));
  await test('notas corporais e auditoria continuam secretas após liberação', async () => {
    await gm(()=>query('update character_cursed_body_techniques set is_released=true where character_id=$1',[pc]));
    const body=await pl(()=>rpc('get_visible_cursed_body',[pc]));
    assert.equal(body.name,'Corpo oculto'); assert.ok(!Object.hasOwn(body,'master_notes'));
    assert.ok(!JSON.stringify(await pl(()=>rpc('get_visible_audit_logs',[pc]))).includes('SEGREDO_TESTE'));
    assert.equal(await gm(()=>value('select count(*)::int as value from ability_master_data')),1);
  });
  await test('ataque improvisado mantém defesa, dano informado e Undo separado', async () => {
    let action;
    const before=await participant(pc);
    await gm(async () => {
      await query('update combat_participants set visible_to_players=false where encounter_id=$1 and character_id=$2',[encounter,GENERIC_ENEMY_ID]);
      const actor=await rpc('start_combat_turn',[(await participant(GENERIC_ENEMY_ID)).id]);
      await rpc('set_manual_dice_queue',[JSON.stringify([{kind:'die',sides:20,value:20}])]);
      action=await improvise({kind:'attack',actor_id:GENERIC_ENEMY_ID,amount:13,public_text:'Um impacto corta o ar.'});
      await rpc('clear_manual_dice_queue');
      assert.equal(await value('select status as value from combat_actions where id=$1',[action]),'pending_defense');
      assert.equal((await participant(GENERIC_ENEMY_ID)).current_pa,actor.current_pa-1);
    });
    await pl(async () => {
      const rows=await query('select * from get_visible_combat_actions($1)',[encounter]);
      assert.equal(rows[0].attacker_character_id,null); assert.equal(rows[0].source_id,null); assert.equal(rows[0].attack_natural,null);
      assert.equal(rows[0].is_critical,false,'Crítico do Mestre não é revelado automaticamente');
    });
    await pl(async () => {
      const snap=await rpc('begin_combat_undo',[encounter,'Defesa']);
      const result=await rpc('resolve_combat_defense',[action,'accept','normal',1]);
      assert.ok(!Object.hasOwn(result,'master_action')); assert.ok(!Object.hasOwn(result,'on_hit_effect'));
      await rpc('commit_combat_undo',[snap]);
    });
    assert.equal((await participant(pc)).current_ps,before.current_ps-13);
    await gm(async()=>{await undo();assert.equal(await value('select status as value from combat_actions where id=$1',[action]),'pending_defense');await undo();});
    assert.equal((await participant(pc)).current_ps,before.current_ps);
    assert.equal(await value('select count(*)::int as value from combat_actions where id=$1',[action]),0);
    await gm(async()=>rpc('end_combat_turn',[(await participant(GENERIC_ENEMY_ID)).id]));
  });
  await test('formulário exige valores por uso e mantém texto como texto', async () => {
    assert.equal(Object.keys(IMPROVISED_ACTIONS).length,6);
    const f=new FormData(); f.set('kind','damage');f.set('target',pc);
    assert.throws(()=>improvisedPayload(f),/valores/);f.set('amount','12');assert.equal(improvisedPayload(f).amount,12);
    f.set('kind','energy');f.set('amount','-9');assert.equal(improvisedPayload(f).amount,-9);
    const html=improvisedFormHtml([],[],null,s=>String(s).replaceAll('<','&lt;'),()=>'<script>');
    assert.ok(html.includes('Ataque Improvisado'));assert.ok(!html.includes('name="amount" type="number" value='));
  });
  await test('redução fixa e bônus de ataque consomem usos pelo motor atual', async () => {
    let shield, bonus, action;
    const before=await participant(pc);
    await gm(async()=>{
      shield=await improvise({kind:'effect',condition_key:'shield',uses:1,modifiers:{damage_reduction_flat:4}});
      bonus=await improvise({kind:'effect',target_id:GENERIC_ENEMY_ID,name:'Precisão',uses:1,modifiers:{conditional_attack_bonus:3}});
      await rpc('start_combat_turn',[(await participant(GENERIC_ENEMY_ID)).id]);
      await rpc('set_manual_dice_queue',[JSON.stringify([{kind:'die',sides:20,value:20}])]);
      action=await improvise({kind:'attack',actor_id:GENERIC_ENEMY_ID,amount:10});await rpc('clear_manual_dice_queue');
      assert.equal(await value('select count(*)::int as value from combat_effect_states where id=$1',[bonus]),0);
      const snap=await rpc('begin_combat_undo',[encounter,'Defesa']);
      await rpc('resolve_combat_defense',[action,'accept','normal',1]);await rpc('commit_combat_undo',[snap]);
      assert.equal((await participant(pc)).current_ps,before.current_ps-6);
      assert.equal(await value('select count(*)::int as value from combat_effect_states where id=$1',[shield]),0);
      await undo();assert.equal(await value('select uses_remaining as value from combat_effect_states where id=$1',[shield]),1);
      await undo();assert.equal(await value('select uses_remaining as value from combat_effect_states where id=$1',[bonus]),1);
      await undo();await undo();
    });
  });
  await test('Undo conserva recursos especiais, modos e contador de turno', async () => gm(async()=>{
    await query("update combat_participants set resources='{\"test\":{\"current\":2,\"max\":4}}',turn_epoch=7,active_combat_mode='magic_brush',combat_mode_bonus_used=true where encounter_id=$1 and character_id=$2",[encounter,pc]);
    const before=await participant(pc);
    await improvise({kind:'damage',amount:1});await undo();
    assert.deepEqual(await participant(pc),before);
  }));
  await test('dados físicos de ataque e defesa permanecem funcionais', async()=>{
    const before=await participant(pc);
    let action;
    await gm(async()=>{
      await rpc('start_combat_turn',[(await participant(GENERIC_ENEMY_ID)).id]);
      await rpc('set_manual_dice_queue',[JSON.stringify([{kind:'die',sides:20,value:15}])]);
      action=await rpc('create_combat_attack',[encounter,GENERIC_ENEMY_ID,pc,'Ataque de teste','basic',null,'strength','fight',1,0,false,false,20,1,6,null,null,'normal',1]);
      await rpc('clear_manual_dice_queue');
      await rpc('mark_physical_attack',[action]);
      assert.equal((await rpc('get_physical_attack_prompt',[action])).needs_damage,true);
      await rpc('set_physical_attack_damage',[action,JSON.stringify([{kind:'die',sides:6,value:4}])]);
    });
    await pl(()=>rpc('resolve_combat_defense',[action,'accept','normal',1]));
    assert.equal((await participant(pc)).current_ps,before.current_ps-4);
    await gm(async()=>rpc('end_combat_turn',[(await participant(GENERIC_ENEMY_ID)).id]));
  });
  await test('Realtime recebe sinal do encontro ao aplicar/remover efeito',async()=>gm(async()=>{
    const before=await value('select updated_at as value from combat_encounters where id=$1',[encounter]);
    const effect=await improvise({kind:'effect',name:'Estado temporário'});
    const after=await value('select updated_at as value from combat_encounters where id=$1',[encounter]);assert.ok(after>before);
    await rpc('manage_improvised_effect',[effect,false]);
    const removed=await value('select updated_at as value from combat_encounters where id=$1',[encounter]);assert.ok(removed>=after);
    await undo();await undo();
  }));
  await test('importação futura separa master_secret antes de RETURNING e preserva o original',async()=>gm(async()=>{
    const result=await query("insert into abilities(character_id,category,name,status,config) values($1,'general','Nova habilidade','approved',$2) returning *",[npc,JSON.stringify({master_secret:'SEGREDO_TESTE',pa_cost:1,overloads:[{master_notes:'SEGREDO_TESTE',key:'known'}]})]);
    assert.ok(!JSON.stringify(result).includes('SEGREDO_TESTE'));
    assert.equal(await value('select count(*)::int as value from ability_master_data where ability_id=$1',[result[0].id]),1);
  }));
  await test('outro jogador não obtém ações, efeitos ou detalhes de técnica corporal',async()=>asUser(db,outsider,async()=>{
    assert.equal((await query('select * from get_visible_combat_actions($1)',[encounter])).length,0);
    assert.equal((await query('select * from get_visible_combat_effects($1)',[encounter])).length,0);
    assert.equal(await rpc('get_visible_cursed_body',[pc]),null);
    assert.equal(await value('select count(*)::int as value from characters'),0);
  }));
  await test('condições privadas legadas não expõem chaves na ficha nem no retorno de turno',async()=>{
    await gm(()=>query("update combat_participants set conditions='[\"legacy_secret\",\"stunned\"]' where encounter_id=$1 and character_id=$2",[encounter,pc]));
    await pl(async()=>{
      const p=await participant(pc);assert.deepEqual(p.conditions.toSorted(),['active_effect','stunned']);
      await assert.rejects(query('select conditions from combat_participants'),/permission denied/);
    });
    await gm(async()=>rpc('start_combat_turn',[(await participant(pc)).id]));
    await pl(async()=>{
      const result=await rpc('end_combat_turn',[(await participant(pc)).id]);
      assert.ok(!JSON.stringify(result).includes('legacy_secret'));
    });
  });
  console.log(`\n${checks} grupos de testes passaram, incluindo migrations completas e RLS com papel authenticated.`);
} finally { await db.close(); }
