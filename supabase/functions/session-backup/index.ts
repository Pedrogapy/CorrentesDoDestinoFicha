import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function toBase64Utf8(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const githubToken = Deno.env.get('GITHUB_TOKEN');
    const githubRepo = Deno.env.get('GITHUB_REPO');
    const githubBranch = Deno.env.get('GITHUB_BRANCH') || 'main';
    const githubPath = Deno.env.get('GITHUB_BACKUP_PATH') || 'backups/latest.json';

    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    if (!jwt) throw new Error('Sessão ausente.');

    const admin = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await admin.auth.getUser(jwt);
    if (userError || !userData.user) throw new Error('Sessão inválida.');

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('role, display_name')
      .eq('id', userData.user.id)
      .single();
    if (profileError || profile?.role !== 'master') throw new Error('Apenas o mestre pode gerar backup completo.');

    const body = await req.json().catch(() => ({}));
    const reason = body?.reason || 'manual';

    const tableNames = [
      'campaigns',
      'profiles',
      'system_attributes',
      'system_skills',
      'system_conditions',
      'characters',
      'character_master_secrets',
      'master_progress_tracks',
      'abilities',
      'vows',
      'equipment',
      'transformations',
      'sessions',
      'free_time_balances',
      'training_tickets',
      'master_requests',
      'combat_encounters',
      'combat_participants',
      'roll_logs',
      'audit_logs',
    ];

    const snapshot: Record<string, unknown> = {
      format: 'correntes-do-destino-backup',
      schema_version: 1,
      generated_at: new Date().toISOString(),
      reason,
      generated_by: profile.display_name || userData.user.id,
      tables: {},
    };

    for (const table of tableNames) {
      const { data, error } = await admin.from(table).select('*');
      if (error) throw new Error(`Falha ao ler ${table}: ${error.message}`);
      (snapshot.tables as Record<string, unknown>)[table] = data;
    }

    if (!githubToken || !githubRepo) {
      return new Response(
        JSON.stringify({
          ok: true,
          skipped_github: true,
          message: 'Snapshot gerado, mas GITHUB_TOKEN/GITHUB_REPO não estão configurados.',
          snapshot,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Este repositório deve ser PRIVADO: o snapshot inclui segredos do mestre.
    const apiUrl = `https://api.github.com/repos/${githubRepo}/contents/${githubPath}`;
    const ghHeaders = {
      Authorization: `Bearer ${githubToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'correntes-do-destino-backup',
      'Content-Type': 'application/json',
    };

    let sha: string | undefined;
    const existing = await fetch(`${apiUrl}?ref=${encodeURIComponent(githubBranch)}`, { headers: ghHeaders });
    if (existing.ok) {
      const existingJson = await existing.json();
      sha = existingJson.sha;
    } else if (existing.status !== 404) {
      throw new Error(`GitHub GET falhou: ${existing.status} ${await existing.text()}`);
    }

    const content = JSON.stringify(snapshot, null, 2);
    const commitBody: Record<string, unknown> = {
      message: `backup: ${reason} ${new Date().toISOString()}`,
      content: toBase64Utf8(content),
      branch: githubBranch,
    };
    if (sha) commitBody.sha = sha;

    const saved = await fetch(apiUrl, {
      method: 'PUT',
      headers: ghHeaders,
      body: JSON.stringify(commitBody),
    });
    if (!saved.ok) throw new Error(`GitHub PUT falhou: ${saved.status} ${await saved.text()}`);

    return new Response(
      JSON.stringify({ ok: true, github_path: githubPath, reason }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
