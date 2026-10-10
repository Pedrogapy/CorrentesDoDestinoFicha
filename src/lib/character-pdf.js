import {
  ABILITY_CATEGORIES,
  ATTRIBUTES,
  SKILLS,
  attributeModifier,
  characterDerived,
} from './system.js';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 42;
const CONTENT_W = PAGE_W - MARGIN * 2;

const ACCENTS = [
  '#b81f2d', '#3f6fa3', '#4f7f68', '#7a5aa6', '#a26337', '#3e7f8f', '#8f496b', '#6f7938',
];

const WIN_ANSI = new Map(Object.entries({
  '€': 128, '‚': 130, 'ƒ': 131, '„': 132, '…': 133, '†': 134, '‡': 135, 'ˆ': 136,
  '‰': 137, 'Š': 138, '‹': 139, 'Œ': 140, 'Ž': 142, '‘': 145, '’': 146, '“': 147,
  '”': 148, '•': 149, '–': 150, '—': 151, '˜': 152, '™': 153, 'š': 154, '›': 155,
  'œ': 156, 'ž': 158, 'Ÿ': 159,
}));

function hashString(value = '') {
  let hash = 2166136261;
  for (const ch of String(value)) {
    hash ^= ch.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function characterAccent(character = {}) {
  const seed = character.id || [character.first_name, character.last_name, character.technique_name]
    .filter(Boolean).join('|');
  const hex = ACCENTS[hashString(seed) % ACCENTS.length];
  const rgb = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16));
  return { hex, rgb };
}

function normalizePrintable(value = '') {
  return String(value ?? '')
    .replace(/\r/g, '')
    .replace(/\t/g, ' ')
    .replace(/[^\S\n]+/g, ' ')
    .trim();
}

function byteForChar(ch) {
  if (WIN_ANSI.has(ch)) return WIN_ANSI.get(ch);
  const cp = ch.codePointAt(0) || 63;
  if (cp >= 32 && cp <= 255) return cp;
  return 63;
}

function pdfString(value = '') {
  let out = '(';
  for (const ch of normalizePrintable(value)) {
    const code = byteForChar(ch);
    if (code === 40 || code === 41 || code === 92) out += `\\${String.fromCharCode(code)}`;
    else if (code >= 32 && code <= 126) out += String.fromCharCode(code);
    else out += `\\${code.toString(8).padStart(3, '0')}`;
  }
  return `${out})`;
}

function rgbCmd(rgb) {
  return rgb.map(v => (Math.max(0, Math.min(255, Number(v) || 0)) / 255).toFixed(3)).join(' ');
}

function lighten(rgb, ratio = 0.8) {
  return rgb.map(v => Math.round(v + (255 - v) * ratio));
}

class PdfBuilder {
  constructor(accent = [184, 31, 45]) {
    this.accent = accent;
    this.pages = [];
  }

  addPage() {
    const page = [];
    this.pages.push(page);
    return page;
  }

  text(page, text, x, yFromTop, size = 10, { bold = false, color = [20, 20, 24] } = {}) {
    const y = PAGE_H - yFromTop;
    page.push(`BT ${rgbCmd(color)} rg /${bold ? 'F2' : 'F1'} ${Number(size).toFixed(2)} Tf 1 0 0 1 ${Number(x).toFixed(2)} ${Number(y).toFixed(2)} Tm ${pdfString(text)} Tj ET`);
  }

  line(page, x1, y1Top, x2, y2Top, { color = [80, 80, 88], width = 0.7 } = {}) {
    const y1 = PAGE_H - y1Top;
    const y2 = PAGE_H - y2Top;
    page.push(`${rgbCmd(color)} RG ${Number(width).toFixed(2)} w ${Number(x1).toFixed(2)} ${Number(y1).toFixed(2)} m ${Number(x2).toFixed(2)} ${Number(y2).toFixed(2)} l S`);
  }

  rect(page, x, yTop, w, h, { fill = null, stroke = null, width = 0.7 } = {}) {
    const y = PAGE_H - yTop - h;
    if (fill) page.push(`${rgbCmd(fill)} rg`);
    if (stroke) page.push(`${rgbCmd(stroke)} RG ${Number(width).toFixed(2)} w`);
    const op = fill && stroke ? 'B' : fill ? 'f' : 'S';
    page.push(`${Number(x).toFixed(2)} ${Number(y).toFixed(2)} ${Number(w).toFixed(2)} ${Number(h).toFixed(2)} re ${op}`);
  }

  build() {
    const pageCount = Math.max(1, this.pages.length);
    if (!this.pages.length) this.addPage();
    const objects = new Array(4 + pageCount * 2 + 1);
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    const pageIds = this.pages.map((_, i) => 6 + i * 2);
    objects[2] = `<< /Type /Pages /Count ${pageCount} /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] >>`;
    objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    this.pages.forEach((commands, i) => {
      const contentId = 5 + i * 2;
      const pageId = 6 + i * 2;
      const stream = commands.join('\n');
      objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
      objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W.toFixed(2)} ${PAGE_H.toFixed(2)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    });

    let output = '%PDF-1.4\n% Correntes do Destino\n';
    const offsets = new Array(objects.length).fill(0);
    for (let id = 1; id < objects.length; id += 1) {
      offsets[id] = output.length;
      output += `${id} 0 obj\n${objects[id]}\nendobj\n`;
    }
    const xrefOffset = output.length;
    output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for (let id = 1; id < objects.length; id += 1) {
      output += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
    }
    output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return new TextEncoder().encode(output);
  }
}

function wrapText(text, maxWidth, fontSize = 10, bold = false) {
  const source = normalizePrintable(text);
  if (!source) return [];
  const approxCharWidth = fontSize * (bold ? 0.56 : 0.51);
  const maxChars = Math.max(10, Math.floor(maxWidth / approxCharWidth));
  const paragraphs = source.split(/\n+/);
  const lines = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); continue; }
    let line = '';
    for (const word of words) {
      if (word.length > maxChars) {
        if (line) { lines.push(line); line = ''; }
        for (let i = 0; i < word.length; i += maxChars) lines.push(word.slice(i, i + maxChars));
        continue;
      }
      const next = line ? `${line} ${word}` : word;
      if (next.length > maxChars && line) { lines.push(line); line = word; }
      else line = next;
    }
    if (line) lines.push(line);
  }
  return lines;
}

function safeName(character = {}) {
  return [character.first_name, character.last_name].filter(Boolean).join(' ').trim() || character.nickname || 'Personagem';
}

function abilityCategoryName(key) {
  return ABILITY_CATEGORIES.find(item => item.key === key)?.name || key || 'Habilidade';
}

function statusLabel(status = '') {
  return ({ approved: 'Aprovada', pending: 'Pendente', rejected: 'Rejeitada', disabled: 'Desativada', draft: 'Rascunho' })[status] || status || 'Sem estado';
}

function sanitizeFilename(value = 'ficha') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'ficha';
}

class SheetLayout {
  constructor(pdf, character) {
    this.pdf = pdf;
    this.character = character;
    this.accent = characterAccent(character).rgb;
    this.accentSoft = lighten(this.accent, 0.88);
    this.page = null;
    this.y = MARGIN;
    this.pageNumber = 0;
    this.newPage();
  }

  newPage() {
    this.page = this.pdf.addPage();
    this.pageNumber += 1;
    this.y = MARGIN;
    this.pdf.rect(this.page, 0, 0, PAGE_W, 7, { fill: this.accent });
    this.pdf.text(this.page, 'CORRENTES DO DESTINO', MARGIN, 29, 8, { bold: true, color: this.accent });
    this.pdf.text(this.page, `Ficha de ${safeName(this.character)}`, 360, 29, 8, { color: [96, 96, 104] });
    this.pdf.text(this.page, String(this.pageNumber).padStart(2, '0'), PAGE_W - MARGIN - 14, PAGE_H - 24, 8, { bold: true, color: [128, 128, 136] });
    this.y = 48;
  }

  ensure(height = 30) {
    if (this.y + height > PAGE_H - 44) this.newPage();
  }

  title(text, subtitle = '') {
    this.ensure(70);
    this.pdf.text(this.page, text.toUpperCase(), MARGIN, this.y + 17, 25, { bold: true, color: [18, 18, 22] });
    if (subtitle) this.pdf.text(this.page, subtitle, MARGIN, this.y + 38, 9, { color: [94, 94, 102] });
    this.pdf.line(this.page, MARGIN, this.y + 48, PAGE_W - MARGIN, this.y + 48, { color: this.accent, width: 1.4 });
    this.y += 62;
  }

  section(text) {
    this.ensure(32);
    this.pdf.rect(this.page, MARGIN, this.y, 5, 18, { fill: this.accent });
    this.pdf.text(this.page, text.toUpperCase(), MARGIN + 12, this.y + 13, 11, { bold: true, color: [28, 28, 33] });
    this.y += 28;
  }

  paragraph(text, { size = 9, color = [45, 45, 50], gap = 7, bold = false } = {}) {
    const lines = wrapText(text, CONTENT_W, size, bold);
    if (!lines.length) return;
    const lineHeight = size * 1.38;
    for (const line of lines) {
      this.ensure(lineHeight + 2);
      this.pdf.text(this.page, line, MARGIN, this.y + size, size, { bold, color });
      this.y += lineHeight;
    }
    this.y += gap;
  }

  labelValue(label, value, { x = MARGIN, width = CONTENT_W, size = 9 } = {}) {
    const labelW = Math.min(width * 0.35, 145);
    const valueText = normalizePrintable(value || '—');
    const lines = wrapText(valueText, width - labelW - 8, size, false);
    if (lines.length <= 8) {
      const height = Math.max(18, lines.length * size * 1.35 + 5);
      this.ensure(height + 2);
      this.pdf.text(this.page, label.toUpperCase(), x, this.y + 11, 7.5, { bold: true, color: [112, 112, 120] });
      lines.forEach((line, index) => this.pdf.text(this.page, line, x + labelW, this.y + 10 + index * size * 1.35, size, { color: [30, 30, 35] }));
      this.pdf.line(this.page, x, this.y + height, x + width, this.y + height, { color: [222, 222, 226], width: 0.5 });
      this.y += height + 3;
      return;
    }
    this.ensure(24);
    this.pdf.text(this.page, label.toUpperCase(), x, this.y + 11, 7.5, { bold: true, color: [112, 112, 120] });
    this.y += 18;
    for (const line of lines) {
      this.ensure(size * 1.4 + 2);
      this.pdf.text(this.page, line, x, this.y + size, size, { color: [30, 30, 35] });
      this.y += size * 1.38;
    }
    this.y += 5;
  }

  twoColumnRows(rows = []) {
    const colGap = 18;
    const colW = (CONTENT_W - colGap) / 2;
    for (let i = 0; i < rows.length; i += 2) {
      this.ensure(23);
      for (let col = 0; col < 2; col += 1) {
        const row = rows[i + col];
        if (!row) continue;
        const x = MARGIN + col * (colW + colGap);
        this.pdf.rect(this.page, x, this.y, colW, 19, { fill: [248, 248, 249], stroke: [224, 224, 228], width: 0.45 });
        this.pdf.text(this.page, row.label, x + 7, this.y + 12, 8.2, { bold: true, color: [35, 35, 40] });
        const valueText=String(row.value ?? '—');
        const valueWidth=Math.min(colW * 0.42, valueText.length * 8.2 * 0.56);
        const valueX=Math.max(x + colW * 0.58, x + colW - 7 - valueWidth);
        this.pdf.text(this.page, valueText, valueX, this.y + 12, 8.2, { bold: true, color: row.accent ? this.accent : [72, 72, 80] });
      }
      this.y += 24;
    }
    this.y += 4;
  }

  item(title, meta = '', body = '') {
    const metaLines = wrapText(meta, CONTENT_W - 20, 7.4);
    const bodyLines = wrapText(body, CONTENT_W - 20, 8.6);
    this.ensure(36 + metaLines.length * 10);
    this.pdf.rect(this.page, MARGIN, this.y, CONTENT_W, 28 + metaLines.length * 10, { fill: [249, 249, 250], stroke: [222, 222, 226], width: 0.5 });
    this.pdf.rect(this.page, MARGIN, this.y, 3, 28 + metaLines.length * 10, { fill: this.accent });
    this.pdf.text(this.page, title, MARGIN + 10, this.y + 14, 9.3, { bold: true, color: [25, 25, 30] });
    let yy = this.y + 25;
    for (const line of metaLines) { this.pdf.text(this.page, line, MARGIN + 10, yy, 7.4, { color: [102, 102, 110] }); yy += 10; }
    this.y += 32 + metaLines.length * 10;
    for (const line of bodyLines) {
      this.ensure(14);
      this.pdf.text(this.page, line, MARGIN + 10, this.y + 8.6, 8.6, { color: [48, 48, 54] });
      this.y += 11.2;
    }
    this.y += 9;
  }

}

export function buildCharacterPdf(snapshot = {}) {
  const character = snapshot.character || snapshot;
  const abilities = Array.isArray(snapshot.abilities) ? snapshot.abilities : [];
  const equipment = Array.isArray(snapshot.equipment) ? snapshot.equipment : [];
  const vows = Array.isArray(snapshot.vows) ? snapshot.vows : [];
  const derived = characterDerived(character);
  const accent = characterAccent(character);
  const pdf = new PdfBuilder(accent.rgb);
  const layout = new SheetLayout(pdf, character);
  const name = safeName(character);
  const subtitle = [character.nickname ? `“${character.nickname}”` : '', `Nível ${character.level || 1}`, character.grade || 'Sem Grau'].filter(Boolean).join('  •  ');

  layout.title(name, subtitle);
  layout.section('Identidade de combate');
  layout.twoColumnRows([
    { label: 'PS Máximo', value: String(derived.ps), accent: true },
    { label: 'EA Máxima', value: String(derived.ea), accent: true },
    { label: 'CA', value: String(derived.ca), accent: true },
    { label: 'PA por ciclo', value: String(derived.pa), accent: true },
  ]);
  layout.labelValue('Técnica Amaldiçoada', character.technique_name || 'Não registrada');
  if (character.technique_description) layout.paragraph(character.technique_description, { size: 9 });

  layout.section('Atributos');
  layout.twoColumnRows(ATTRIBUTES.map(attr => {
    const value = Number(character.attributes?.[attr.key] || 0);
    return { label: attr.name, value: `${value}  (Mod. +${attributeModifier(value)})` };
  }));

  layout.section('Perícias');
  layout.twoColumnRows(SKILLS.map(skill => ({ label: skill.name, value: String(Number(character.skills?.[skill.key] || 0)) })));

  layout.section('Crescimento');
  layout.twoColumnRows([
    { label: 'Vigor', value: String(Number(character.growth_vigor || 0)) },
    { label: 'Reserva', value: String(Number(character.growth_reserve || 0)) },
  ]);

  layout.section('Habilidades');
  if (!abilities.length) layout.paragraph('Nenhuma habilidade registrada.');
  abilities.forEach(ability => {
    const cfg = ability.config || {};
    const costs = [Number(cfg.pa_cost || 0) ? `${Number(cfg.pa_cost)} PA` : '', Number(cfg.ea_cost || 0) ? `${Number(cfg.ea_cost)} EA` : ''].filter(Boolean).join(' • ');
    const meta = [abilityCategoryName(ability.category), statusLabel(ability.status), costs, ability.vp_approved != null ? `VP ${ability.vp_approved}` : ability.vp_estimated != null ? `VP est. ${ability.vp_estimated}` : ''].filter(Boolean).join(' • ');
    const body = [ability.description, ability.mechanics].filter(Boolean).join(' — ');
    layout.item(ability.name || 'Habilidade', meta, body);
  });

  layout.section('Equipamentos');
  if (!equipment.length) layout.paragraph('Nenhum equipamento registrado.');
  equipment.forEach(item => {
    const meta = [item.grade, item.equipped ? 'Equipado' : 'Inventário', item.status ? statusLabel(item.status) : ''].filter(Boolean).join(' • ');
    const body = [item.description, item.mechanics].filter(Boolean).join(' — ');
    layout.item(item.name || 'Equipamento', meta, body);
  });

  if (vows.length) {
    layout.section('Votos Vinculativos');
    vows.forEach(vow => layout.item(
      vow.name || 'Voto',
      statusLabel(vow.status),
      [`Restrição: ${vow.restriction || '—'}`, `Benefício: ${vow.benefit || '—'}`, `Quebra: ${vow.break_condition || '—'}`].join(' | '),
    ));
  }

  layout.section('Personagem');
  layout.labelValue('Objetivos', character.goals || '—');
  layout.labelValue('Personalidade', character.personality || '—');
  layout.labelValue('História', character.biography || '—');
  layout.labelValue('Aparência', character.appearance || '—');
  if (character.notes) layout.labelValue('Notas', character.notes);

  layout.ensure(34);
  layout.pdf.line(layout.page, MARGIN, layout.y + 5, PAGE_W - MARGIN, layout.y + 5, { color: accent.rgb, width: 0.9 });
  layout.pdf.text(layout.page, 'Correntes do Destino • ficha gerada pela aplicação', MARGIN, layout.y + 20, 7.5, { color: [120, 120, 126] });
  return pdf.build();
}

export function downloadCharacterPdf(snapshot = {}) {
  const character = snapshot.character || snapshot;
  const bytes = buildCharacterPdf(snapshot);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${sanitizeFilename(safeName(character)) || 'ficha'}.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return bytes;
}
