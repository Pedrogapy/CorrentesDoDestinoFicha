import { supabase } from './supabase.js';

/**
 * O jogador enxerga apenas "nome do personagem" + "sobrenome/senha".
 * Supabase Auth exige uma identidade do tipo e-mail/telefone para login por senha,
 * entÃ£o usamos um e-mail tÃ©cnico determinÃ­stico que nunca Ã© mostrado como requisito ao jogador.
 */
export function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
}

export function authEmailFromCharacter(fullName) {
  const slug = normalizeName(fullName);
  return `${slug || 'personagem'}@example.com`;
}

export function authPasswordFromVisiblePassword(password) {
  // Supabase normalmente exige um mÃ­nimo de caracteres. Para sobrenomes muito curtos,
  // o sufixo Ã© interno e determinÃ­stico; a tela continua aceitando apenas o sobrenome.
  const raw = String(password || '');
  return raw.length >= 6 ? raw : `${raw}::CD`;
}

export async function signInCharacter(fullName, surnamePassword) {
  const email = authEmailFromCharacter(fullName);
  const password = authPasswordFromVisiblePassword(surnamePassword);
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signUpCharacter(fullName, surnamePassword) {
  const parts = String(fullName || '').trim().split(/\s+/);
  const firstName = parts.shift() || 'Personagem';
  const lastName = parts.join(' ') || String(surnamePassword || '').trim();
  const email = authEmailFromCharacter(fullName);
  const password = authPasswordFromVisiblePassword(surnamePassword);

  return supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: fullName,
        character_first_name: firstName,
        character_last_name: lastName,
      },
    },
  });
}

export async function signOut() {
  return supabase.auth.signOut();
}
