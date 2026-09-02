import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// PostgreSQL real em memória. Apenas auth/storage/publicação do Supabase são simulados.
export async function testDatabase({ beforeNewMigrations } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'authenticated') $$;
    grant usage on schema auth to authenticated,anon;
    grant execute on all functions in schema auth to authenticated,anon;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key,name text,bucket_id text,owner_id text);
    create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
    create publication supabase_realtime;
  `);
  const files = fs.readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (file === '202609020001_improvised_combat.sql' && beforeNewMigrations) await beforeNewMigrations(db);
    // gen_random_uuid é nativo ao PostgreSQL; a extensão não é usada pelo motor.
    const sql = fs.readFileSync(`supabase/migrations/${file}`, 'utf8').replace(/^\uFEFF/, '').replace('create extension if not exists pgcrypto;', '');
    try { await db.exec(sql); }
    catch (error) { await db.close(); throw new Error(`${file}: ${error.message}\n${error.where || ''}`); }
  }
  return db;
}

export async function asUser(db, id, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${id}',false);`);
  try { return await fn(); }
  finally { await db.exec("reset role; select set_config('request.jwt.claim.sub','',false);"); }
}
