import fs from 'node:fs';
import path from 'node:path';

const base=path.resolve('data/players');
const load=n=>JSON.parse(fs.readFileSync(path.join(base,n),'utf8'));
const find=(rows,name)=>rows.find(x=>x.name===name);
const assert=(cond,msg)=>{if(!cond) throw new Error(msg);};

const aiko=load('aiko.json');
const escudo=find(aiko.abilities,'Escudo Temporal');
const regen=find(aiko.abilities,'Regeneração Temporal');
const ataque=find(aiko.abilities,'Ataque Temporal');
const interrupcao=find(aiko.abilities,'Interrupção Temporal');
assert(escudo && regen && ataque && interrupcao,'Aiko precisa manter as quatro habilidades temporais separadas.');
assert(escudo.config?.is_reaction===true,'Escudo Temporal precisa ser reação.');
assert(Array.isArray(escudo.config?.overloads) && escudo.config.overloads.length>0,'Escudo Temporal precisa ter Sobrecarga.');
assert(Array.isArray(regen.config?.overloads) && regen.config.overloads.length>0,'Regeneração Temporal precisa ter Sobrecarga.');
assert(Array.isArray(interrupcao.config?.modes) && interrupcao.config.modes.some(m=>m.key==='enemy') && interrupcao.config.modes.some(m=>m.key==='ally'),'Interrupção Temporal precisa ter modos inimigo/aliado.');

const kotone=load('kotone.json');
const orfeu=(kotone.summons||[]).find(x=>x.name==='Orfeu');
const invocar=find(kotone.abilities,'Invocar Orfeu');
assert(orfeu,'Orfeu precisa existir como ficha filha.');
assert(['Agi','Dia','Pancada','Tarukaja'].every(n=>find(orfeu.abilities,n)),'As habilidades de Orfeu precisam morar na ficha filha.');
assert(invocar?.config?.special_action==='activate_summon','Invocar Orfeu precisa ativar a ficha filha.');
assert(invocar?.config?.target_mode==='self','Invocar Orfeu precisa ter alvo próprio automático.');

const jin=load('jin.json');
const clot=(jin.character?.special_resources||[]).find(r=>r.key==='blood_clot');
assert(clot?.max===3 && clot?.start_combat===3,'Jin precisa iniciar combate com 3/3 Coágulos.');
const arm=find(jin.abilities,'Armamento de Sangue');
const fluxo=find(jin.abilities,'Fluxo das Escamas Vermelhas');
assert(arm?.config?.special_action==='create_weapon','Armamento de Sangue precisa criar equipamento temporário.');
assert(arm?.config?.target_mode==='self','Armamento de Sangue não pode pedir alvo externo.');
assert(fluxo?.config?.target_mode==='self','Fluxo das Escamas Vermelhas não pode pedir alvo externo.');
assert((jin.equipment||[]).some(x=>x.name==='Uniforme Okkotsu'),'Uniforme Okkotsu precisa estar no pacote do Jin.');
assert(jin.cursed_body?.name==='Circuito Hemático','Jin precisa ter o Circuito Hemático preparado como Técnica do Corpo.');
assert(jin.cursed_body?.is_released===false,'Circuito Hemático não deve ser liberado automaticamente.');
assert(jin.cursed_body?.seed_only===true,'Circuito Hemático precisa preservar decisões futuras do Mestre em reimportações.');

console.log('OK: Aiko, Kotone, Jin, invocações, reações, sobrecargas, Coágulos, Armamento de Sangue e Técnica do Corpo validados.');
