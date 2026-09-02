import fs from 'node:fs';

const conditions = JSON.parse(
  fs.readFileSync('data/system/conditions.json', 'utf8'),
);

const quote = value => `'${String(value).replaceAll("'", "''")}'`;

const values = rows =>
  rows
    .map(c => `(${[c.key, c.name, c.description].map(quote).join(',')})`)
    .join(',\n');

const migrationPath =
  'supabase/migrations/202609020001_improvised_combat.sql';

const block = `-- GENERIC_CONDITIONS
insert into public.system_conditions(key,name,description) values
${values(conditions)}
on conflict(key) do update set
  name=excluded.name,
  description=excluded.description,
  updated_at=now();

update public.system_conditions
set public_catalog=true
where key in (${conditions.map(c => quote(c.key)).join(',')});
-- END_GENERIC_CONDITIONS`;

const source = fs.readFileSync(migrationPath, 'utf8');

if (!source.includes('-- GENERIC_CONDITIONS') ||
    !source.includes('-- END_GENERIC_CONDITIONS')) {
  throw new Error(
    `Bloco GENERIC_CONDITIONS não encontrado em ${migrationPath}`,
  );
}

const migration = source.replace(
  /-- GENERIC_CONDITIONS[\s\S]*?-- END_GENERIC_CONDITIONS/,
  block,
);

if (process.argv.includes('--check')) {
  if (source !== migration) {
    throw new Error(`Catálogo fora de sincronia: ${migrationPath}`);
  }
} else {
  fs.writeFileSync(migrationPath, migration, 'utf8');
}

console.log(
  `OK: ${conditions.length} condições genéricas em UTF-8.`,
);