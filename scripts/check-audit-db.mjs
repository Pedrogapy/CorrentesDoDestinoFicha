import assert from 'node:assert/strict';
import { testDatabase,asUser } from './lib/test-db.mjs';
import { createBalancedBuild,characterDerived } from '../src/lib/system.js';
import { BACKUP_TABLES,backupOrderKey } from '../supabase/functions/session-backup/snapshot.js';
const db=await testDatabase();
const master='00000000-0000-4000-8000-000000000010',player='00000000-0000-4000-8000-000000000011';
const pc='00000000-0000-4000-8000-000000000020';
try {
  await db.exec(`insert into auth.users(id,email) values('${master}','m@test.invalid'),('${player}','p@test.invalid');
  select set_config('request.jwt.claim.role','service_role',false);
  update profiles set role='master' where id='${master}';
  select set_config('request.jwt.claim.role','authenticated',false);
  select set_config('request.jwt.claim.sub','${master}',false);
  insert into characters(id,owner_id,entity_type,first_name) values('${pc}','${player}','player','Teste');`);
  const query=async(sql,args=[]) => (await db.query(sql,args)).rows;
  for(const level of [1,6,7,24,25,49,50,74,75,91,99,100]) {
    const c={level,...createBalancedBuild(level)};
    await db.query('update characters set level=$1,attributes=$2,skills=$3,growth_vigor=$4,growth_reserve=$5 where id=$6',[level,JSON.stringify(c.attributes),JSON.stringify(c.skills),c.growth_vigor,c.growth_reserve,pc]);
    const [actual]=await query('select combat_max_ps($1) as ps,combat_max_ea($1) as ea,combat_max_pa($1) as pa,combat_ca($1) as ca',[pc]);
    const expected=characterDerived(c);
    for(const key of ['ps','ea','pa','ca']) assert.equal(actual[key],expected[key],`${key} no nível ${level}`);
  }
  await assert.rejects(db.query("update characters set attributes='{}' where id=$1",[pc]),/oito atributos/);
  // Teste real da fila física: o 12º dado altera o mínimo, revelando truncamento.
  const tokens=Array.from({length:12},(_,i)=>({kind:'die',sides:20,value:i===11?1:20}));
  await db.query('select set_manual_dice_queue($1)',[JSON.stringify(tokens)]);
  const [{r}]=await query("select roll_pg_d20('disadvantage',12) as r");
  assert.equal(r.rolls.length,12); assert.equal(r.natural,1);
  await db.query('select clear_manual_dice_queue()');
  const [{r:digital}]=await query("select roll_pg_d20('disadvantage',20) as r");
  assert.equal(digital.rolls.length,20); assert.equal(digital.natural,Math.min(...digital.rolls));
  await asUser(db,player,async()=>{
    for(const signature of ['combat_ca(uuid)','combat_max_ps(uuid)','combat_skill_bonus(uuid,text)','roll_pg_d20(text,integer)','capture_combat_state(uuid)']) {
      const [{allowed}]=await query("select has_function_privilege(current_user,$1,'execute') as allowed",[signature]);
      assert.equal(allowed,false,signature);
    }
    await assert.rejects(query('select combat_ca($1)',[pc]),/permission denied/);
    assert.equal((await query('select * from character_master_secrets')).length,0);
  });
  assert.equal((await query("select name from system_attributes where key='cursed_control'"))[0].name,'Controle Amaldiçoado');
  assert.equal((await query("select name from system_skills where key='defend'"))[0].name,'Defender');
  for(const table of BACKUP_TABLES) {
    const key=backupOrderKey(table);
    await query(`select ${key} from ${table} order by ${key} limit 0`);
  }
  const noRls=await query("select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity");
  assert.deepEqual(noRls,[],'Todas as tabelas públicas mantêm RLS');
  console.log('OK: paridade JS/PostgreSQL em 12 níveis, dados acima de 10, funções internas, RLS, nomenclatura e esquema do backup.');
} finally { await db.close(); }
