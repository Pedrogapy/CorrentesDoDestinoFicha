import assert from 'node:assert/strict';
import { buildCharacterPdf, characterAccent } from '../src/lib/character-pdf.js';
import { createBalancedBuild } from '../src/lib/system.js';

const build=createBalancedBuild(5);
const character={
  id:'11111111-1111-1111-1111-111111111111',
  first_name:'João',last_name:'Pereira',nickname:'Jô',level:5,grade:'Grau 4',xp:0,
  technique_name:'Linha do Amanhã',technique_description:'Uma técnica de teste com acentuação, ação e precisão.',
  ...build,permanent_ps_bonus:0,permanent_ea_bonus:0,
  biography:'História de teste.',personality:'Calmo e atento.',goals:'Proteger a equipe.',appearance:'Uniforme escuro.',notes:'',
};
const snapshot={character,abilities:[{name:'Passo Preciso',category:'technique',status:'approved',description:'Reposiciona o usuário.',mechanics:'1 PA.',vp_approved:2,config:{pa_cost:1,ea_cost:1}}],equipment:[{name:'Lâmina de treino',grade:'Sem Grau',equipped:true,status:'approved',description:'Arma de treino.'}],vows:[]};
const bytes=buildCharacterPdf(snapshot);
const header=new TextDecoder().decode(bytes.slice(0,8));
assert.equal(header,'%PDF-1.4','Exportação precisa gerar um PDF 1.4 real.');
assert.ok(bytes.length>2500,'PDF ficou pequeno demais; conteúdo da ficha pode ter sido omitido.');
const ascii=new TextDecoder().decode(bytes);
assert.ok(ascii.includes('/WinAnsiEncoding'),'PDF precisa declarar WinAnsi para português latino.');
assert.ok(ascii.includes('xref')&&ascii.includes('startxref'),'PDF precisa possuir tabela xref válida.');
assert.deepEqual(characterAccent(character),characterAccent({...character}),'A assinatura visual precisa ser determinística.');
const accentVariants=new Set(Array.from({length:24},(_,i)=>characterAccent({...character,id:`00000000-0000-0000-0000-${String(i).padStart(12,'0')}`}).hex));
assert.ok(accentVariants.size>1,'A assinatura visual precisa variar entre fichas, ainda que a paleta possa se repetir.');
console.log(`OK: exportação PDF válida (${bytes.length} bytes), acentos e assinatura visual determinística.`);
