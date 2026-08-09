/**
 * Correntes do Destino - regras mecânicas do sistema.
 *
 * IMPORTANTE PARA CONTINUAÇÃO EM OUTRO CHAT:
 * - A UI consome estas definições em vez de repetir descrições em vários lugares.
 * - O banco também recebe uma cópia editável pelo mestre para compêndio e condições.
 * - Fórmulas centrais devem permanecer centralizadas aqui e nas funções SQL equivalentes.
 * - "Crítico" e "Kokusen" são conceitos separados. Só 20 NATURAL é elegível a Kokusen.
 * - Não expor sistemas narrativamente secretos em telas de jogador apenas por estarem implementados no banco.
 */

export const SYSTEM_VERSION = '0.6.0';

export const ATTRIBUTES = [
  {
    key: 'strength',
    name: 'Força',
    description:
      'Capacidade de produzir e aplicar força física através do corpo. Influencia potência muscular, combate físico e ações baseadas em força bruta.',
  },
  {
    key: 'dexterity',
    name: 'Destreza',
    description:
      'Coordenação, precisão corporal, equilíbrio e velocidade de resposta física.',
  },
  {
    key: 'resistance',
    name: 'Resistência',
    description:
      'Capacidade física de suportar esforço, dano, desgaste e alterações impostas ao corpo.',
  },
  {
    key: 'intelligence',
    name: 'Inteligência',
    description:
      'Capacidade de aprender, analisar, raciocinar e aplicar conhecimentos técnicos ou teóricos.',
  },
  {
    key: 'perception',
    name: 'Percepção',
    description:
      'Capacidade de captar, distinguir e interpretar informações provenientes do ambiente e do comportamento ao redor.',
  },
  {
    key: 'will',
    name: 'Vontade',
    description:
      'Estabilidade mental e espiritual, disciplina interna e capacidade de manter controle sobre si mesmo.',
  },
  {
    key: 'presence',
    name: 'Presença',
    description:
      'Capacidade de influenciar outras pessoas através de comunicação, comportamento, autoridade ou expressão.',
  },
  {
    key: 'cursed_control',
    name: 'Controle Amaldiçoado',
    description:
      'Precisão e domínio com que o personagem manipula sua própria Energia Amaldiçoada. Não representa o tamanho de sua reserva.',
  },
];

export const SKILLS = [
  // Força
  ['athletics', 'Atletismo', 'strength', 'Capacidade de executar esforços físicos ligados a deslocamento, levantamento, corrida, salto, escalada e outras ações atléticas.'],
  ['fight', 'Lutar', 'strength', 'Treinamento e eficiência em combate corpo a corpo, desarmado ou utilizando armas de combate próximo.'],
  ['grapple', 'Agarrar', 'strength', 'Capacidade de prender, conter ou controlar fisicamente outro corpo e de disputar agarrões.'],
  ['impact', 'Impacto', 'strength', 'Capacidade de aplicar força de maneira concentrada para quebrar, empurrar, deslocar ou afetar fisicamente objetos e estruturas.'],

  // Destreza
  ['acrobatics', 'Acrobacia', 'dexterity', 'Controle corporal durante movimentos complexos, equilíbrio, aterrissagens e reposicionamentos físicos.'],
  ['reflexes', 'Reflexos', 'dexterity', 'Capacidade de responder rapidamente a ameaças, movimentos e acontecimentos repentinos.'],
  ['stealth', 'Furtividade', 'dexterity', 'Capacidade de ocultar presença física, reduzir sinais de movimentação e evitar ser percebido.'],
  ['aim', 'Pontaria', 'dexterity', 'Precisão ao direcionar ataques, projéteis, objetos ou efeitos que dependam de mira.'],

  // Resistência
  ['defend', 'Defender', 'resistance', 'Capacidade de bloquear, aparar ou interceptar fisicamente ataques utilizando postura, corpo, arma ou meio apropriado.'],
  ['fortitude', 'Fortitude', 'resistance', 'Capacidade do corpo de suportar dano, dor, exaustão, agentes nocivos e outras formas de desgaste físico.'],
  ['steadiness', 'Firmeza', 'resistance', 'Capacidade de manter posição, equilíbrio e controle corporal contra efeitos que tentem deslocar, derrubar ou desestabilizar.'],
  ['survival', 'Sobrevivência', 'resistance', 'Capacidade de preservar o próprio corpo e operar adequadamente em ambientes hostis ou situações prolongadas de privação.'],

  // Inteligência
  ['investigation', 'Investigação', 'intelligence', 'Capacidade de analisar evidências, identificar relações, reconstruir acontecimentos e encontrar informações por busca deliberada.'],
  ['occultism', 'Ocultismo', 'intelligence', 'Conhecimento teórico sobre fenômenos sobrenaturais, Energia Amaldiçoada, maldições, objetos e tradições relacionadas à feitiçaria.'],
  ['technical_sorcery', 'Feitiçaria Técnica', 'intelligence', 'Conhecimento técnico empregado na construção, análise e manipulação de estruturas amaldiçoadas, incluindo selos, barreiras, cortinas, delimitações, condições, rituais e estruturas semelhantes.'],
  ['medicine', 'Medicina', 'intelligence', 'Conhecimento sobre anatomia, ferimentos, doenças, estabilização, diagnóstico e tratamento do corpo.'],
  ['technology', 'Tecnologia', 'intelligence', 'Conhecimento e capacidade prática envolvendo computadores, eletrônica, dispositivos e sistemas tecnológicos.'],

  // Percepção
  ['attention', 'Atenção', 'perception', 'Capacidade de detectar conscientemente detalhes, sons, movimentos, alterações e outros estímulos perceptíveis.'],
  ['intuition', 'Intuição', 'perception', 'Capacidade de interpretar sinais sutis, comportamentos e sensações para perceber intenções, riscos ou inconsistências.'],
  ['tracking', 'Rastreamento', 'perception', 'Capacidade de identificar e seguir vestígios físicos, energéticos ou ambientais deixados por um alvo ou acontecimento.'],
  ['combat_reading', 'Leitura de Combate', 'perception', 'Capacidade de observar e compreender padrões, ritmos, posturas, intenções e mudanças ocorridas durante um confronto.'],

  // Vontade
  ['concentration', 'Concentração', 'will', 'Capacidade de manter foco e continuidade mental mesmo diante de distração, pressão, dor ou interferência.'],
  ['self_control', 'Autocontrole', 'will', 'Capacidade de regular conscientemente emoções, impulsos e respostas comportamentais.'],
  ['mental_resistance', 'Resistência Mental', 'will', 'Capacidade de resistir a interferências que afetem pensamento, percepção, emoção ou funcionamento da mente.'],
  ['spiritual_resistance', 'Resistência Espiritual', 'will', 'Capacidade de proteger identidade, alma e estrutura espiritual contra interferências sobrenaturais.'],

  // Presença
  ['persuasion', 'Persuasão', 'presence', 'Capacidade de influenciar decisões e opiniões através de argumentação e comunicação.'],
  ['deception', 'Enganação', 'presence', 'Capacidade de transmitir deliberadamente informações ou impressões falsas de maneira convincente.'],
  ['intimidation', 'Intimidação', 'presence', 'Capacidade de exercer pressão e provocar receio através da presença, comportamento ou comunicação.'],
  ['leadership', 'Liderança', 'presence', 'Capacidade de coordenar, orientar e influenciar coletivamente outras pessoas.'],
  ['performance', 'Performance', 'presence', 'Capacidade de executar apresentações, interpretações e formas deliberadas de expressão artística ou pública.'],

  // Controle Amaldiçoado
  ['channeling', 'Canalização', 'cursed_control', 'Capacidade de conduzir, concentrar, transferir e manipular diretamente o fluxo de Energia Amaldiçoada.'],
  ['reinforcement', 'Reforço', 'cursed_control', 'Capacidade de aplicar Energia Amaldiçoada para fortalecer corpo, objetos, armas ou estruturas. Também representa a aplicação defensiva dessa energia.'],
  ['technique_control', 'Controle de Técnica', 'cursed_control', 'Capacidade de operar com precisão os fenômenos e efeitos produzidos pela própria Técnica Amaldiçoada.'],
  ['cursed_suppression', 'Supressão Amaldiçoada', 'cursed_control', 'Capacidade de reduzir, ocultar ou controlar deliberadamente a manifestação e assinatura da própria Energia Amaldiçoada.'],
].map(([key, name, attribute, description]) => ({ key, name, attribute, description }));

export const ATTRIBUTE_BY_KEY = Object.fromEntries(ATTRIBUTES.map((item) => [item.key, item]));
export const SKILL_BY_KEY = Object.fromEntries(SKILLS.map((item) => [item.key, item]));

export const ABILITY_CATEGORIES = [
  { key: 'technique', name: 'Extensão de Técnica' },
  { key: 'general', name: 'Habilidade Geral' },
  { key: 'manifestation', name: 'Manifestação / Invocação' },
  { key: 'transformation', name: 'Transformação' },
  { key: 'domain', name: 'Expansão de Domínio' },
];

export const ENTITY_TYPES = [
  { key: 'player', name: 'Personagem de Jogador' },
  { key: 'npc', name: 'NPC' },
  { key: 'curse', name: 'Maldição' },
  { key: 'enemy', name: 'Inimigo' },
  { key: 'summon', name: 'Invocação' },
];

export const GRADE_OPTIONS = ['Sem Grau', 'Grau 4', 'Grau 3', 'Grau 2', 'Grau 1', 'Grau Especial'];


// ============================================================
// EQUIPAMENTOS / FERRAMENTAS AMALDIÇOADAS
// ============================================================

export const EQUIPMENT_CATEGORIES = [
  { key: 'weapon', name: 'Arma' },
  { key: 'accessory', name: 'Amuleto / Acessório' },
  { key: 'armor', name: 'Roupa / Armadura' },
  { key: 'consumable', name: 'Consumível' },
  { key: 'other', name: 'Outro' },
];

/**
 * Slots físicos. Mão principal e secundária são apenas posições ocupadas:
 * nenhuma delas dá bônus ou penalidade de acerto.
 */
export const EQUIPMENT_SLOTS = [
  { key: 'main_hand', name: 'Mão principal' },
  { key: 'off_hand', name: 'Mão secundária' },
  { key: 'head', name: 'Cabeça' },
  { key: 'neck', name: 'Pescoço' },
  { key: 'body', name: 'Corpo' },
  { key: 'arms', name: 'Braços / pulsos' },
  { key: 'waist', name: 'Cintura' },
  { key: 'feet', name: 'Pés' },
  { key: 'accessory_1', name: 'Acessório 1' },
  { key: 'accessory_2', name: 'Acessório 2' },
];

/**
 * Local corporal preferencial de itens não-arma.
 * "Acessório genérico" ocupa um dos dois slots de acessório.
 */
export const EQUIPMENT_WEAR_LOCATIONS = [
  { key: 'none', name: 'Não vestível' },
  { key: 'head', name: 'Cabeça' },
  { key: 'neck', name: 'Pescoço' },
  { key: 'body', name: 'Corpo' },
  { key: 'arms', name: 'Braços / pulsos' },
  { key: 'waist', name: 'Cintura' },
  { key: 'feet', name: 'Pés' },
  { key: 'accessory', name: 'Acessório genérico' },
];

/**
 * Sintonia limita quantos itens amaldiçoados podem ficar ATIVOS ao mesmo tempo.
 * O limite acompanha os mesmos grandes marcos de PA para ser fácil de lembrar.
 * Itens comuns não gastam Sintonia. Consumíveis não ficam sintonizados.
 */
export function equipmentAttunementCapacity(level) {
  const lv = Math.max(1, Math.min(100, Number(level) || 1));
  if (lv >= 100) return 7;
  if (lv >= 75) return 6;
  if (lv >= 50) return 5;
  if (lv >= 25) return 4;
  return 3;
}

export function equipmentAttunementUsed(items = []) {
  return (Array.isArray(items) ? items : []).filter((item) =>
    item?.equipped && item?.status === 'approved' && item?.is_cursed && item?.category !== 'consumable'
  ).length;
}

/**
 * O dano básico de uma arma é parte do perfil físico da arma e NÃO consome VP.
 * A arma Padrão é versátil: 1d8 com uma mão ou 1d10 no ataque quando usada
 * com duas mãos e a mão secundária estiver livre.
 */
export const WEAPON_PROFILES = {
  light: {
    name: 'Leve',
    damageDiceCount: 1,
    damageDie: 6,
    paCost: 1,
    handsMin: 1,
    handsMax: 1,
    description: '1d6 + modificador. 1 PA. Uma mão.',
  },
  standard: {
    name: 'Padrão',
    damageDiceCount: 1,
    damageDie: 8,
    twoHandedDamageDiceCount: 1,
    twoHandedDamageDie: 10,
    paCost: 1,
    handsMin: 1,
    handsMax: 2,
    description: '1d8 + modificador com uma mão; 1d10 + modificador quando empunhada com duas mãos. 1 PA.',
  },
  heavy: {
    name: 'Pesada',
    damageDiceCount: 1,
    damageDie: 12,
    paCost: 1,
    handsMin: 2,
    handsMax: 2,
    description: '1d12 + modificador. 1 PA. Exige duas mãos.',
  },
  very_heavy: {
    name: 'Muito pesada',
    damageDiceCount: 2,
    damageDie: 10,
    paCost: 2,
    handsMin: 2,
    handsMax: 2,
    description: '2d10 + modificador. 2 PA. Exige duas mãos. É uma opção de impacto concentrado, não de eficiência por PA.',
  },
};

export function weaponDamageProfile(profile = 'standard', twoHanded = false) {
  const p = WEAPON_PROFILES[profile] || WEAPON_PROFILES.standard;
  if (profile === 'standard' && twoHanded) {
    return {
      damageDiceCount: p.twoHandedDamageDiceCount,
      damageDie: p.twoHandedDamageDie,
      paCost: p.paCost,
      handsUsed: 2,
    };
  }
  return {
    damageDiceCount: p.damageDiceCount,
    damageDie: p.damageDie,
    paCost: p.paCost,
    handsUsed: p.handsMin,
  };
}

export const EQUIPMENT_GRADE_VP = {
  'Sem Grau': 0,
  'Grau 4': 2,
  'Grau 3': 4,
  'Grau 2': 6,
  'Grau 1': 9,
  'Grau Especial': 12,
};

export function equipmentVpBudget(grade, isCursed = true) {
  if (!isCursed) return 0;
  return EQUIPMENT_GRADE_VP[grade] ?? 0;
}

export function equipmentEffectsVp(effects = []) {
  return (Array.isArray(effects) ? effects : []).reduce((sum, effect) => sum + Math.max(0, Number(effect?.vp) || 0), 0);
}

export function equipmentCategoryName(key) {
  return EQUIPMENT_CATEGORIES.find((item) => item.key === key)?.name || key || 'Outro';
}

export function equipmentSlotName(key) {
  return EQUIPMENT_SLOTS.find((item) => item.key === key)?.name || key || 'Não equipado';
}

export function equipmentWearLocationName(key) {
  return EQUIPMENT_WEAR_LOCATIONS.find((item) => item.key === key)?.name || key || 'Não vestível';
}

export function weaponAttackConfig({
  profile = 'standard',
  attackAttributeKey = 'strength',
  attackSkillKey = 'fight',
  damageAttributeKey = attackAttributeKey,
  range = 'melee',
} = {}) {
  const damage = weaponDamageProfile(profile, false);
  return {
    enabled: true,
    attack_attribute_key: attackAttributeKey,
    attack_skill_key: attackSkillKey,
    pa_cost: damage.paCost,
    ea_cost: 0,
    damage_die: damage.damageDie,
    damage_dice_count: damage.damageDiceCount,
    damage_flat_attribute_key: damageAttributeKey || null,
    uses_cursed_energy: false,
    critical_threshold: 20,
    forced_critical: false,
    range,
    allow_cursed_reinforcement: true,
  };
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

export function attributeModifier(attributeValue) {
  return Math.floor((Number(attributeValue) || 0) / 2);
}

export function attributePointBudget(level) {
  return 15 + clamp(level, 1, 100);
}

export function attributeCap(level) {
  return Math.min(20, 5 + Math.floor((clamp(level, 1, 100) - 1) / 6));
}

export function skillPointBudget(level) {
  return 9 + clamp(level, 1, 100);
}

export function skillCap(level) {
  return Math.min(10, 3 + Math.floor((clamp(level, 1, 100) - 1) / 12));
}

export function growthPointBudget(level) {
  return clamp(level, 1, 100);
}

export function actionPoints(level) {
  const lvl = clamp(level, 1, 100);
  if (lvl === 100) return 7;
  if (lvl >= 75) return 6;
  if (lvl >= 50) return 5;
  if (lvl >= 25) return 4;
  return 3;
}

export function xpForNextLevel(level) {
  const lvl = clamp(level, 1, 100);
  if (lvl >= 100) return null;
  return 100 + 25 * lvl;
}

export function calculatePS(character) {
  const level = clamp(character.level, 1, 100);
  const resistance = Number(character.attributes?.resistance || 1);
  const vigor = Number(character.growth_vigor || 0);
  const permanent = Number(character.permanent_ps_bonus || 0);
  return 18 + 2 * level + 2 * resistance + 2 * vigor + permanent;
}

export function calculateEA(character) {
  const level = clamp(character.level, 1, 100);
  const control = Number(character.attributes?.cursed_control || 1);
  const reserve = Number(character.growth_reserve || 0);
  const permanent = Number(character.permanent_ea_bonus || 0);
  return 18 + 2 * level + 2 * control + 2 * reserve + permanent;
}

export function defenseBreakdown(character) {
  const attrs = character.attributes || {};
  const skills = character.skills || {};
  const reflex = 10 + attributeModifier(attrs.dexterity) + Number(skills.reflexes || 0);
  const defend = 10 + attributeModifier(attrs.resistance) + Number(skills.defend || 0);
  const fortitude = 10 + attributeModifier(attrs.resistance) + Number(skills.fortitude || 0);
  const reinforcement = 10 + attributeModifier(attrs.cursed_control) + Number(skills.reinforcement || 0);
  return {
    reflex,
    defend,
    fortitude,
    reinforcement,
    ca: Math.max(reflex, defend, fortitude, reinforcement),
  };
}

export function characterDerived(character) {
  const defense = defenseBreakdown(character);
  return {
    ps: calculatePS(character),
    ea: calculateEA(character),
    pa: actionPoints(character.level),
    ...defense,
  };
}

export function sumObjectValues(object) {
  return Object.values(object || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

export function validateBuild(character) {
  const level = clamp(character.level, 1, 100);
  const errors = [];
  const attrs = character.attributes || {};
  const skills = character.skills || {};
  const attrCapValue = attributeCap(level);
  const skillCapValue = skillCap(level);

  const attrSum = ATTRIBUTES.reduce((sum, attr) => sum + Number(attrs[attr.key] || 0), 0);
  const skillSum = SKILLS.reduce((sum, skill) => sum + Number(skills[skill.key] || 0), 0);

  if (attrSum > attributePointBudget(level)) {
    errors.push(`Atributos excedem o limite: ${attrSum}/${attributePointBudget(level)} pontos.`);
  }
  for (const attr of ATTRIBUTES) {
    const value = Number(attrs[attr.key] || 0);
    if (value < 1 || value > attrCapValue) errors.push(`${attr.name} deve ficar entre 1 e ${attrCapValue}.`);
  }

  if (skillSum > skillPointBudget(level)) {
    errors.push(`Perícias excedem o limite: ${skillSum}/${skillPointBudget(level)} pontos.`);
  }
  for (const skill of SKILLS) {
    const value = Number(skills[skill.key] || 0);
    if (value < 0 || value > skillCapValue) errors.push(`${skill.name} deve ficar entre 0 e ${skillCapValue}.`);
  }

  const growth = Number(character.growth_vigor || 0) + Number(character.growth_reserve || 0);
  if (growth > growthPointBudget(level)) {
    errors.push(`Crescimento excede o limite: ${growth}/${growthPointBudget(level)} pontos entre Vigor e Reserva.`);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Gera uma distribuição neutra e válida para o nível informado.
 * É usada só para abrir o editor sem deixar uma entidade em estado matematicamente inválido.
 * A intenção NÃO é sugerir uma build ideal.
 */
export function createBalancedBuild(level = 5) {
  const lvl = clamp(level, 1, 100);
  const attributes = Object.fromEntries(ATTRIBUTES.map((a) => [a.key, 1]));
  let remainingAttributes = attributePointBudget(lvl) - ATTRIBUTES.length;
  const capA = attributeCap(lvl);
  let i = 0;
  while (remainingAttributes > 0) {
    const key = ATTRIBUTES[i % ATTRIBUTES.length].key;
    if (attributes[key] < capA) {
      attributes[key] += 1;
      remainingAttributes -= 1;
    }
    i += 1;
  }

  const skills = Object.fromEntries(SKILLS.map((s) => [s.key, 0]));
  const preferred = ['reflexes', 'defend', 'fortitude', 'reinforcement', 'fight', 'attention', 'channeling', 'technique_control', 'concentration', 'intuition'];
  const skillOrder = [...preferred, ...SKILLS.map(s => s.key).filter(key => !preferred.includes(key))];
  let remainingSkills = skillPointBudget(lvl);
  const capS = skillCap(lvl);
  i = 0;
  while (remainingSkills > 0) {
    const key = skillOrder[i % skillOrder.length];
    if (skills[key] < capS) {
      skills[key] += 1;
      remainingSkills -= 1;
    }
    i += 1;
  }

  const vigor = Math.ceil(growthPointBudget(lvl) / 2);
  const reserve = growthPointBudget(lvl) - vigor;
  return { attributes, skills, growth_vigor: vigor, growth_reserve: reserve };
}

export function slotBudget(level) {
  const lvl = clamp(level, 1, 100);
  return {
    technique: {
      slots: 3 + Math.floor((lvl - 1) / 10),
      vp: 7 + Math.ceil(lvl / 5),
      maxSingle: Math.min(10, 4 + Math.floor((lvl - 1) / 15)),
    },
    general: {
      slots: 3 + Math.floor((lvl - 1) / 15),
      vp: 5 + Math.ceil(lvl / 5),
      maxSingle: Math.min(8, 3 + Math.floor((lvl - 1) / 18)),
    },
    manifestation: {
      slots: 1 + Math.floor((lvl - 1) / 25),
      vp: 7 + Math.ceil(lvl / 5),
      maxSingle: Math.min(12, 5 + Math.floor((lvl - 1) / 12)),
    },
    transformation: {
      slots: 1 + Math.floor((lvl - 1) / 25),
      vp: 4 + Math.ceil(lvl / 5),
      maxSingle: Math.min(12, 5 + Math.floor((lvl - 1) / 12)),
    },
    domain: {
      slots: 0,
      vp: 0,
      maxSingle: 0,
      note: 'Domínios dependem de desenvolvimento narrativo, domínio técnico e aprovação do mestre. Não são concedidos automaticamente por nível.',
    },
  };
}

export const VP_OPTIONS = {
  range: {
    self: { label: 'Próprio', vp: 0 },
    touch: { label: 'Toque', vp: 0 },
    near: { label: 'Perto', vp: 0 },
    far: { label: 'Longe', vp: 1 },
  },
  targets: {
    self: { label: 'Próprio', vp: 0 },
    one: { label: 'Um alvo', vp: 0 },
    few: { label: 'Poucos alvos', vp: 1 },
    area: { label: 'Área', vp: 2 },
  },
  duration: {
    instant: { label: 'Instantâneo', vp: 0 },
    one_round: { label: '1 rodada', vp: 1 },
    few_rounds: { label: 'Algumas rodadas', vp: 2 },
    scene: { label: 'Cena', vp: 4 },
  },
  conditionSeverity: {
    none: { label: 'Nenhuma', vp: 0 },
    minor: { label: 'Leve', vp: 1 },
    moderate: { label: 'Moderada', vp: 2 },
    severe: { label: 'Severa', vp: 3 },
  },
};

/**
 * Estimador v0.1 de VP.
 * O valor é uma triagem, não uma aprovação automática. O mestre sempre tem a palavra final.
 * Foi deixado isolado justamente para ser recalibrado após criar/testar NPCs pelo próprio site.
 */
export function estimateAbilityVP(config = {}) {
  let vp = 1;
  const diceCount = clamp(config.damage_dice_count || 0, 0, 12);
  const die = clamp(config.damage_die || 0, 0, 20);
  if (diceCount && die) {
    const average = diceCount * ((die + 1) / 2);
    vp += Math.ceil(average / 6);
  }

  vp += VP_OPTIONS.range[config.range]?.vp || 0;
  vp += VP_OPTIONS.targets[config.targets]?.vp || 0;
  vp += VP_OPTIONS.duration[config.duration]?.vp || 0;
  vp += VP_OPTIONS.conditionSeverity[config.condition_severity]?.vp || 0;

  if (config.no_attack_or_save) vp += 2;
  if (config.mobility) vp += 1;
  if (config.healing) vp += 2;
  if (config.damage_reduction) vp += 1;
  if (config.resource_generation) vp += 2;
  if (config.summon_sheet) vp += 2;

  const paCost = clamp(config.pa_cost || 1, 0, 7);
  const eaCost = clamp(config.ea_cost || 0, 0, 100);
  if (paCost >= 2) vp -= paCost - 1;
  vp -= Math.floor(eaCost / 6);

  if (config.once_per_combat) vp -= 1;
  if (config.once_per_mission) vp -= 2;
  if (config.requires_preparation) vp -= 1;
  if (config.meaningful_drawback) vp -= 1;

  // Configurações de execução também alteram o orçamento. Um efeito ofensivo sem
  // teste para acertar é mais confiável; crítico forçado e margem ampliada são
  // benefícios relevantes, mas não tornam o golpe elegível a Kokusen.
  const hasOffensivePayload = Number(config.damage_dice_count || 0) > 0 || Boolean(config.condition_key);
  if (hasOffensivePayload && config.requires_attack === false) vp += 2;
  if (config.forced_critical) vp += 2;
  const threshold = clamp(config.critical_threshold || 20, 2, 20);
  if (threshold < 20) vp += Math.ceil((20 - threshold) / 2);

  return Math.max(1, Math.round(vp));
}

export const DEFAULT_CONDITIONS = [
  {
    key: 'bleeding',
    name: 'Sangramento',
    description: 'O alvo está perdendo sangue de forma relevante. A origem do efeito define duração, dano ou método de encerramento quando aplicável.',
  },
  {
    key: 'burning',
    name: 'Queimadura',
    description: 'O alvo sofre os efeitos de uma queimadura ativa ou residual. A fonte define intensidade, duração e eventuais danos adicionais.',
  },
  {
    key: 'immobilized',
    name: 'Imobilizado',
    description: 'O alvo não consegue mudar voluntariamente de posição enquanto a condição permanecer. Outras ações continuam possíveis salvo indicação da fonte.',
  },
  {
    key: 'stunned',
    name: 'Atordoado',
    description: 'O alvo está temporariamente desorientado e com dificuldade de agir. A fonte define exatamente quais ações ou reações são afetadas.',
  },
  {
    key: 'blind',
    name: 'Cego',
    description: 'O alvo não pode utilizar visão para perceber, mirar ou interpretar o ambiente. Outros sentidos continuam funcionando normalmente.',
  },
  {
    key: 'silenced',
    name: 'Silenciado',
    description: 'O alvo não consegue produzir ou utilizar fala de maneira funcional enquanto a condição permanecer.',
  },
  {
    key: 'prone',
    name: 'Caído',
    description: 'O alvo está no chão ou em posição equivalente e precisa se reposicionar antes de agir como se estivesse plenamente de pé.',
  },
];

export function skillTest(character, skillKey, attributeOverride = null) {
  const skill = SKILL_BY_KEY[skillKey];
  if (!skill) throw new Error('Perícia desconhecida.');
  const attributeKey = attributeOverride || skill.attribute;
  return attributeModifier(character.attributes?.[attributeKey]) + Number(character.skills?.[skillKey] || 0);
}
