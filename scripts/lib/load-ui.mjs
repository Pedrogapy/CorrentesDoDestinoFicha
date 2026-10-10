import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

// Exercita o código real, substituindo apenas a fronteira de rede.
export async function loadUI(entry, appended='') {
  const source=fs.readFileSync(entry,'utf8').replace(/\bboot\(\);\s*$/, '')+'\n'+appended;
  const result=await build({stdin:{contents:source,resolveDir:path.dirname(path.resolve(entry)),loader:'js'},
    bundle:true,write:false,format:'esm',platform:'node',loader:{'.css':'empty'},
    plugins:[{name:'isolated-network',setup(builder){
      builder.onLoad({filter:/[\\/]api\.js$/},()=>({contents:'export const '+[
        ...fs.readFileSync('src/lib/api.js','utf8').matchAll(/export async function (\w+)/g),
      ].map(match=>`${match[1]}=(...args)=>globalThis.__testApi.${match[1]}(...args)`).join(',')+';'}));
      builder.onLoad({filter:/[\\/]supabase\.js$/},()=>({contents:'export const isConfigured=false; export const supabase=globalThis.__testSupabase;'}));
    }}]});
  return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
