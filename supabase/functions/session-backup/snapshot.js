export const BACKUP_TABLES = [
  'campaigns','profiles','system_attributes','system_skills','system_conditions',
  'characters','character_master_secrets','master_progress_tracks','abilities',
  'ability_master_data','character_cursed_body_techniques','vows','equipment',
  'transformations','sessions','free_time_balances','training_tickets','master_requests',
  'combat_encounters','combat_participants','combat_actions','combat_effect_states',
  'combat_usage','combat_undo_snapshots','roll_logs','audit_logs',
];

// Página pequena também funciona em projetos com limite inferior ao padrão 1000.
export function backupOrderKey(table) {
  return ({ability_master_data:'ability_id',character_master_secrets:'character_id',system_attributes:'key',system_skills:'key'})[table] || 'id';
}

export async function readBackupTable(client, table, pageSize = 100) {
  const rows=[];
  const key=backupOrderKey(table);
  for (let offset=0;;) {
    const {data,error}=await client.from(table).select('*').order(key).range(offset,offset+pageSize-1);
    if(error) throw new Error(`Falha ao ler ${table}: ${error.message}`);
    if(!data?.length) return rows;
    rows.push(...data);
    offset+=data.length;
  }
}

export async function requirePrivateRepository(fetcher, repositoryUrl, headers) {
  const response=await fetcher(repositoryUrl,{headers});
  if(!response.ok) throw new Error(`Não foi possível verificar a privacidade do backup (${response.status}).`);
  if((await response.json()).private!==true) throw new Error('O backup exige um repositório privado. Nenhum dado foi enviado.');
}
