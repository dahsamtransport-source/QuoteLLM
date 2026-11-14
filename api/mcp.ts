/**
 * Remote MCP server — Direct Assurance mutuelle santé
 * Protocol: MCP over Streamable HTTP (JSON-RPC 2.0, POST)
 * Returns rich markdown + SVG image widgets for ChatGPT rendering
 */
import { boundedBody, inputResponse, record } from '../lib/api-input.js';
export const config = { runtime: 'edge' };

// ─── Pricing logic ────────────────────────────────────────────────────────────

const FORMULA_CONFIG = [
  {
    id: 'essentielle', name: 'Essentielle', color: '#64748b',
    tagline: 'Les garanties juste au cas où',
    coverage: { soins: 'Soins courants 100% BR', hospitalisation: 'Hospitalisation 100% BR', optique: 'Optique 100% (plafond SS)', dentaire: 'Dentaire 100% BR' },
  },
  {
    id: 'essentielle_plus', name: 'Essentielle +', color: '#475569',
    tagline: "L'essentiel + bonne couverture optique",
    coverage: { soins: 'Soins courants 100% BR', hospitalisation: 'Chambre individuelle incluse', optique: "Optique jusqu'a 200 EUR/an", dentaire: 'Dentaire jusqu a 125% BR' },
  },
  {
    id: 'equilibre', name: 'Equilibre', color: '#E30613',
    tagline: 'La formule complete et confortable',
    coverage: { soins: 'Soins courants 120% BR', hospitalisation: 'Clinique privee + 120% BR', optique: "Optique jusqu'a 300 EUR/an", dentaire: 'Dentaire jusqu a 150% BR' },
  },
];

const BASE: Record<string, number>        = { essentielle: 30, essentielle_plus: 45, equilibre: 62 };
const REGIME_MULT: Record<string, number> = { general: 1.0, independent: 1.15, agriculture: 0.95, student: 0.8, alsace_moselle: 0.9, other: 1.0 };
const FAMILY_MULT: Record<string, number> = { single: 1.0, couple: 1.85, family: 2.15, parent: 1.3 };

function getAge(dob: string): number {
  const [d, m, y] = dob.split('/').map(Number);
  const date = new Date(y, m - 1, d);
  const now  = new Date();
  let age = now.getFullYear() - date.getFullYear();
  if (now < new Date(now.getFullYear(), date.getMonth(), date.getDate())) age--;
  return Math.max(0, age);
}

function getRecommendedId(hospit: string, optics: string, dental: string): string {
  let score = 0;
  if (hospit === 'premium') score += 3; else if (hospit === 'comfort') score += 2;
  if (optics === 'enhanced') score += 2; else if (optics === 'standard') score += 1;
  if (dental === 'orthodontics') score += 2; else if (dental === 'prosthetics') score += 1;
  return score >= 5 ? 'equilibre' : score >= 2 ? 'essentielle_plus' : 'essentielle';
}

function calcFormulas(a: Record<string, any>) {
  const recommendedId = getRecommendedId(a.hospitalization_need, a.optics_need, a.dental_need);
  const age     = getAge(a.date_of_birth);
  const ageLoad = 1 + Math.max(0, age - 30) * 0.005;
  const regMult = REGIME_MULT[a.regime] ?? 1.0;
  const famMult = FAMILY_MULT[a.family_composition] ?? 1.0;
  const curP    = a.current_price ? parseFloat(a.current_price) : undefined;
  return {
    age,
    recommendedId,
    formulas: FORMULA_CONFIG.map(c => {
      const monthly = Math.round(BASE[c.id] * ageLoad * regMult * famMult * 100) / 100;
      return { ...c, recommended: c.id === recommendedId, monthlyPremium: monthly,
        annualPremium: Math.round(monthly * 12 * 100) / 100,
        monthlySaving: curP !== undefined ? Math.round((curP - monthly) * 10) / 10 : undefined };
    }),
  };
}

// ─── Reimbursement data ───────────────────────────────────────────────────────

const SCENARIOS: Record<string, { icon: string; label: string; cost: number }> = {
  dental_crown:   { icon: '🦷', label: 'Couronne dentaire',       cost: 900  },
  optician_prog:  { icon: '👓', label: 'Lunettes progressives',   cost: 400  },
  specialist:     { icon: '👨‍⚕️', label: 'Specialiste secteur 2',   cost: 50   },
  gp_visit:       { icon: '🩺', label: 'Medecin generaliste',     cost: 25   },
  hospital_3d:    { icon: '🏥', label: 'Hospitalisation 3 nuits', cost: 1200 },
  dental_implant: { icon: '🦷', label: 'Implant dentaire',        cost: 1500 },
};

const REIMB: Record<string, Record<string, { secu: number; mutuelle: number; remaining: number }>> = {
  gp_visit: {
    essentielle:      { secu: 17, mutuelle: 7,   remaining: 1   },
    essentielle_plus: { secu: 17, mutuelle: 7,   remaining: 1   },
    equilibre:        { secu: 17, mutuelle: 7,   remaining: 1   },
  },
  specialist: {
    essentielle:      { secu: 16, mutuelle: 7,   remaining: 27  },
    essentielle_plus: { secu: 16, mutuelle: 15,  remaining: 19  },
    equilibre:        { secu: 16, mutuelle: 28,  remaining: 6   },
  },
  dental_crown: {
    essentielle:      { secu: 84, mutuelle: 36,  remaining: 780 },
    essentielle_plus: { secu: 84, mutuelle: 66,  remaining: 750 },
    equilibre:        { secu: 84, mutuelle: 96,  remaining: 720 },
  },
  optician_prog: {
    essentielle:      { secu: 5,  mutuelle: 15,  remaining: 380 },
    essentielle_plus: { secu: 5,  mutuelle: 195, remaining: 200 },
    equilibre:        { secu: 5,  mutuelle: 295, remaining: 100 },
  },
  hospital_3d: {
    essentielle:      { secu: 900, mutuelle: 120, remaining: 180 },
    essentielle_plus: { secu: 900, mutuelle: 240, remaining: 60  },
    equilibre:        { secu: 900, mutuelle: 290, remaining: 10  },
  },
  dental_implant: {
    essentielle:      { secu: 0, mutuelle: 0,   remaining: 1500 },
    essentielle_plus: { secu: 0, mutuelle: 100, remaining: 1400 },
    equilibre:        { secu: 0, mutuelle: 350, remaining: 1150 },
  },
};

// ─── Rich text helpers ────────────────────────────────────────────────────────

function pb(pct: number, w = 14): string {
  const n = Math.max(0, Math.min(w, Math.round(pct / 100 * w)));
  return '█'.repeat(n) + '░'.repeat(w - n);
}

function fmt(n: number): string {
  return n.toFixed(2).replace('.', ',');
}

const FORMULA_LABELS: Record<string, { icon: string; color: string }> = {
  essentielle:      { icon: '⚪', color: '' },
  essentielle_plus: { icon: '🟡', color: '' },
  equilibre:        { icon: '🔴', color: '' },
};

const EXAMPLES: Record<string, Array<{ icon: string; scenario: string; remaining: number }>> = {
  essentielle:      [
    { icon: '🦷', scenario: 'Couronne dentaire (900 EUR)', remaining: 780 },
    { icon: '👓', scenario: 'Lunettes progressives (400 EUR)', remaining: 380 },
    { icon: '🏥', scenario: 'Hospit. 3 nuits (1200 EUR)', remaining: 180 },
  ],
  essentielle_plus: [
    { icon: '🦷', scenario: 'Couronne dentaire (900 EUR)', remaining: 750 },
    { icon: '👓', scenario: 'Lunettes progressives (400 EUR)', remaining: 200 },
    { icon: '🏥', scenario: 'Hospit. 3 nuits (1200 EUR)', remaining: 60  },
  ],
  equilibre: [
    { icon: '🦷', scenario: 'Couronne dentaire (900 EUR)', remaining: 720  },
    { icon: '👓', scenario: 'Lunettes progressives (400 EUR)', remaining: 100 },
    { icon: '🏥', scenario: 'Hospit. 3 nuits (1200 EUR)', remaining: 10  },
  ],
};

// ─── Chart URL builder ────────────────────────────────────────────────────────

function chartUrl(base: string, type: string, params: Record<string, string | undefined>): string {
  const u = new URL(`${base}/api/chart`);
  u.searchParams.set('type', type);
  for (const [k, v] of Object.entries(params)) { if (v != null) u.searchParams.set(k, v); }
  return u.toString();
}

// ─── Markdown renderers ───────────────────────────────────────────────────────

function renderQuoteMd(a: Record<string, any>, baseUrl = 'https://quote-llm-six.vercel.app'): string {
  const { age, recommendedId, formulas } = calcFormulas(a);
  const REGIME_FR: Record<string, string> = {
    general: 'Salarie', independent: 'TNS', agriculture: 'Agriculteur',
    student: 'Etudiant', alsace_moselle: 'Alsace-Moselle', other: 'Autre',
  };
  const FAM_FR: Record<string, string> = {
    single: 'Seul(e)', couple: 'Couple', family: 'Famille', parent: 'Parent solo',
  };

  const lines: string[] = [
    `## Devis Direct Assurance`,
    `**Profil :** ${age} ans · ${REGIME_FR[a.regime] ?? a.regime} · ${FAM_FR[a.family_composition] ?? a.family_composition}${a.current_insurer ? ` · Actuel : ${a.current_insurer}` : ''}`,
    '',
  ];

  for (const f of formulas) {
    const fl   = FORMULA_LABELS[f.id];
    const star = f.recommended ? ' — ⭐ **RECOMMANDEE**' : '';
    lines.push(`---`);
    lines.push(`### ${fl.icon} ${f.name}${star}`);
    lines.push(`**${fmt(f.monthlyPremium)} EUR/mois** · ${fmt(f.annualPremium)} EUR/an`);
    if (f.monthlySaving !== undefined) {
      const sign = f.monthlySaving >= 0 ? '+ ' : '';
      const emoji = f.monthlySaving >= 5 ? '💰' : f.monthlySaving < -5 ? '📈' : '≈';
      lines.push(`${emoji} ${sign}${f.monthlySaving} EUR/mois vs contrat actuel`);
    }
    lines.push('');
    lines.push(`| Garantie | Couverture |`);
    lines.push(`|---|---|`);
    lines.push(`| 🩺 Soins | ${f.coverage.soins} |`);
    lines.push(`| 🏥 Hospit. | ${f.coverage.hospitalisation} |`);
    lines.push(`| 👓 Optique | ${f.coverage.optique} |`);
    lines.push(`| 🦷 Dentaire | ${f.coverage.dentaire} |`);
    lines.push('');
    lines.push(`**Exemples concrets :**`);
    for (const ex of (EXAMPLES[f.id] ?? [])) {
      const cost = parseInt(ex.scenario.match(/\((\d+)/)?.[1] ?? '0');
      const pct  = cost > 0 ? Math.round(((cost - ex.remaining) / cost) * 100) : 0;
      lines.push(`- ${ex.icon} ${ex.scenario} → reste **${ex.remaining} EUR** \`${pb(pct, 12)}\` ${pct}%`);
    }
    lines.push('');
  }

  lines.push(`---`);
  lines.push(`> Devis complet et souscription : https://quote-llm-six.vercel.app`);
  lines.push(`> _Tarifs indicatifs · Non contractuels · Delai de carence applicable_`);

  const url = chartUrl(baseUrl, 'quote', {
    dob:    a.date_of_birth,
    regime: a.regime,
    family: a.family_composition,
    hospit: a.hospitalization_need,
    optics: a.optics_need,
    dental: a.dental_need,
    price:   a.current_price != null ? String(a.current_price) : undefined,
    insurer: a.current_insurer ?? undefined,
  });
  lines.push('', `![Votre devis Direct Assurance](${url})`);
  return lines.join('\n');
}

function renderSimulateMd(scenario: string, formulaFilter?: string, baseUrl = 'https://quote-llm-six.vercel.app'): string {
  const sc = SCENARIOS[scenario];
  if (!sc) return `Scenario inconnu : ${scenario}. Disponibles : ${Object.keys(SCENARIOS).join(', ')}`;

  const formulas = formulaFilter
    ? FORMULA_CONFIG.filter(f => f.id === formulaFilter)
    : FORMULA_CONFIG;

  const lines: string[] = [
    `## ${sc.icon} Simulation : ${sc.label}`,
    `**Cout total estime :** ${sc.cost} EUR`,
    '',
    `| Formule | Secu | Mutuelle | **Reste a charge** | Couverture |`,
    `|---|---|---|---|---|`,
  ];

  for (const f of formulas) {
    const row  = REIMB[scenario]?.[f.id];
    if (!row) continue;
    const pct  = Math.round(((sc.cost - row.remaining) / sc.cost) * 100);
    const star = f.id === 'equilibre' ? ' ⭐' : '';
    const remColor = row.remaining < 50 ? '✅' : row.remaining < 300 ? '⚠️' : '🔴';
    lines.push(`| ${f.name}${star} | ${row.secu} EUR | ${row.mutuelle} EUR | ${remColor} **${row.remaining} EUR** | \`${pb(pct, 10)}\` ${pct}% |`);
  }

  lines.push('');
  lines.push(`_Valeurs indicatives · tarifs conventionnels 2024 · Non contractuelles_`);

  const url = chartUrl(baseUrl, 'simulate', {
    scenario,
    formula: formulaFilter,
  });
  lines.push('', `![Simulation remboursement](${url})`);
  return lines.join('\n');
}

// ─── SVG widget generators ────────────────────────────────────────────────────

function xe(s: string | number): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/EUR/g, '&#8364;').replace(/\./g, ',');
}

function svgToBase64(svg: string): string {
  const enc = new TextEncoder();
  const bytes = enc.encode(svg);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode(...bytes.slice(i, i + 8192));
  }
  return btoa(bin);
}

function generateQuoteSVG(a: Record<string, any>): string {
  const { age, formulas } = calcFormulas(a);
  const W = 720; const H = 440;
  const CW = 220; const CH = 370; const GAP = 11; const TOP = 58; const LEFT = 14;

  let cards = '';
  formulas.forEach((f, i) => {
    const x = LEFT + i * (CW + GAP);
    const y = TOP;
    const isRec = f.recommended;
    const col = f.color;

    // Card shadow / border
    cards += `<rect x="${x+2}" y="${y+2}" width="${CW}" height="${CH}" fill="rgba(0,0,0,0.06)" rx="14"/>`;
    cards += `<rect x="${x}" y="${y}" width="${CW}" height="${CH}" fill="white" rx="14" stroke="${isRec ? '#E30613' : '#e5e7eb'}" stroke-width="${isRec ? 2 : 1}"/>`;

    // Recommended banner
    let hTop = y;
    if (isRec) {
      cards += `<rect x="${x}" y="${y}" width="${CW}" height="22" fill="${col}" rx="14"/>`;
      cards += `<rect x="${x}" y="${y+10}" width="${CW}" height="12" fill="${col}"/>`;
      cards += `<text x="${x + CW/2}" y="${y+15}" text-anchor="middle" fill="white" font-size="10" font-weight="700" font-family="system-ui,sans-serif">&#9733; RECOMMANDEE</text>`;
      hTop = y + 22;
    }

    // Header
    const hH = 44;
    cards += `<rect x="${x}" y="${hTop}" width="${CW}" height="${hH}" fill="${col}" rx="${isRec ? 0 : 14}"/>`;
    if (!isRec) cards += `<rect x="${x}" y="${hTop + hH - 14}" width="${CW}" height="14" fill="${col}"/>`;
    cards += `<text x="${x + CW/2}" y="${hTop + 18}" text-anchor="middle" fill="white" font-size="13" font-weight="700" font-family="system-ui,sans-serif">${xe(f.name)}</text>`;
    cards += `<text x="${x + CW/2}" y="${hTop + 33}" text-anchor="middle" fill="rgba(255,255,255,0.85)" font-size="9" font-family="system-ui,sans-serif">${xe(f.tagline.substring(0, 34))}</text>`;

    const priceY = hTop + hH + 6;

    // Price
    cards += `<text x="${x + CW/2}" y="${priceY + 24}" text-anchor="middle" fill="${col}" font-size="24" font-weight="800" font-family="system-ui,sans-serif">${xe(fmt(f.monthlyPremium))} &#8364;</text>`;
    cards += `<text x="${x + CW/2}" y="${priceY + 38}" text-anchor="middle" fill="#9ca3af" font-size="10" font-family="system-ui,sans-serif">/mois &#8226; ${xe(fmt(f.annualPremium))} &#8364;/an</text>`;

    // Saving badge
    let nextY = priceY + 46;
    if (f.monthlySaving !== undefined) {
      const sc2 = f.monthlySaving >= 0 ? '#16a34a' : '#ea580c';
      const sb2 = f.monthlySaving >= 0 ? '#f0fdf4' : '#fff7ed';
      const sign = f.monthlySaving >= 0 ? '+' : '';
      cards += `<rect x="${x+20}" y="${nextY}" width="${CW-40}" height="18" fill="${sb2}" rx="9" stroke="${sc2}" stroke-width="0.5"/>`;
      cards += `<text x="${x + CW/2}" y="${nextY+12}" text-anchor="middle" fill="${sc2}" font-size="10" font-weight="600" font-family="system-ui,sans-serif">${sign}${xe(String(f.monthlySaving))} &#8364;/mois vs actuel</text>`;
      nextY += 22;
    }

    // Divider
    cards += `<line x1="${x+12}" y1="${nextY + 4}" x2="${x+CW-12}" y2="${nextY + 4}" stroke="#f3f4f6" stroke-width="1"/>`;

    // Coverage rows
    const cov = [
      ['&#128138;', 'Soins',    f.coverage.soins.substring(0, 26)],
      ['&#127973;', 'Hospit.',  f.coverage.hospitalisation.substring(0, 26)],
      ['&#128083;', 'Optique',  f.coverage.optique.substring(0, 26)],
      ['&#129463;', 'Dentaire', f.coverage.dentaire.substring(0, 26)],
    ];
    let cy = nextY + 18;
    for (const [ico, lbl, val] of cov) {
      cards += `<text x="${x+14}" y="${cy}" fill="#6b7280" font-size="13" font-family="system-ui,sans-serif">${ico}</text>`;
      cards += `<text x="${x+30}" y="${cy}" fill="#374151" font-size="10" font-weight="600" font-family="system-ui,sans-serif">${lbl}</text>`;
      cards += `<text x="${x+30}" y="${cy+12}" fill="#9ca3af" font-size="9" font-family="system-ui,sans-serif">${xe(val)}</text>`;
      cy += 30;
    }

    // Button
    const btnY = y + CH - 38;
    cards += `<rect x="${x+12}" y="${btnY}" width="${CW-24}" height="28" fill="${isRec ? col : 'white'}" stroke="${isRec ? col : '#e5e7eb'}" stroke-width="1" rx="14"/>`;
    cards += `<text x="${x+CW/2}" y="${btnY+18}" text-anchor="middle" fill="${isRec ? 'white' : '#6b7280'}" font-size="11" font-weight="600" font-family="system-ui,sans-serif">Selectionner</text>`;
  });

  const curInfo = a.current_insurer ? ` &#8226; Actuel : ${xe(a.current_insurer)}` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#F5F5F5" rx="16"/>
  <text x="14" y="26" fill="#111827" font-size="15" font-weight="700" font-family="system-ui,sans-serif">Devis Direct Assurance</text>
  <text x="14" y="44" fill="#6b7280" font-size="11" font-family="system-ui,sans-serif">${age} ans${curInfo}</text>
  <text x="${W-14}" y="44" text-anchor="end" fill="#E30613" font-size="11" font-weight="600" font-family="system-ui,sans-serif">quote-llm-six.vercel.app</text>
  ${cards}
</svg>`;
}

function generateReimbursementSVG(scenario: string, formulaFilter?: string): string {
  const sc = SCENARIOS[scenario];
  if (!sc) return '';
  const fmts = formulaFilter
    ? FORMULA_CONFIG.filter(f => f.id === formulaFilter)
    : FORMULA_CONFIG;

  const W = 620; const BAR_W = 310; const BAR_X = 164; const BAR_H = 18;
  const ROW_H = 72; const TOP = 66;
  const H = TOP + fmts.length * ROW_H + 46;

  let rows = '';
  fmts.forEach((f, i) => {
    const row  = REIMB[scenario]?.[f.id];
    if (!row) return;
    const y    = TOP + i * ROW_H;
    const tot  = sc.cost;
    const sW   = Math.round((row.secu     / tot) * BAR_W);
    const mW   = Math.round((row.mutuelle / tot) * BAR_W);
    const rW   = Math.max(0, BAR_W - sW - mW);
    const pct  = Math.round(((row.secu + row.mutuelle) / tot) * 100);
    const isRec = f.id === 'equilibre';
    const nc   = isRec ? '#E30613' : '#374151';

    rows += `<text x="14" y="${y+14}" fill="${nc}" font-size="12" font-weight="${isRec ? '700' : '500'}" font-family="system-ui,sans-serif">${xe(f.name)}${isRec ? ' &#9733;' : ''}</text>`;
    rows += `<text x="14" y="${y+28}" fill="#9ca3af" font-size="10" font-family="system-ui,sans-serif">Secu ${row.secu}&#8364;  Mutuelle ${row.mutuelle}&#8364;</text>`;

    // Bar background
    rows += `<rect x="${BAR_X}" y="${y}" width="${BAR_W}" height="${BAR_H}" fill="#f3f4f6" rx="9"/>`;
    // Secu portion (green)
    if (sW > 0) rows += `<rect x="${BAR_X}" y="${y}" width="${sW}" height="${BAR_H}" fill="#22c55e" rx="${mW + rW > 0 ? '9 0 0 9' : '9'}"/>`;
    // Mutuelle portion (blue)
    if (mW > 0) rows += `<rect x="${BAR_X+sW}" y="${y}" width="${mW}" height="${BAR_H}" fill="#3b82f6" rx="${rW > 0 ? 0 : '0 9 9 0'}"/>`;
    // Remaining portion (red)
    if (rW > 0) rows += `<rect x="${BAR_X+sW+mW}" y="${y}" width="${rW}" height="${BAR_H}" fill="#ef4444" rx="${sW+mW > 0 ? '0 9 9 0' : '9'}"/>`;

    // Labels right of bar
    const remC = row.remaining === 0 ? '#16a34a' : row.remaining < 100 ? '#ea580c' : '#dc2626';
    rows += `<text x="${BAR_X+BAR_W+10}" y="${y+13}" fill="#6b7280" font-size="11" font-family="system-ui,sans-serif">${pct}% couvert</text>`;
    rows += `<text x="${BAR_X+BAR_W+10}" y="${y+28}" fill="${remC}" font-size="11" font-weight="600" font-family="system-ui,sans-serif">Reste : ${row.remaining}&#8364;</text>`;

    if (i < fmts.length - 1)
      rows += `<line x1="14" y1="${y+ROW_H-4}" x2="${W-14}" y2="${y+ROW_H-4}" stroke="#f3f4f6" stroke-width="1"/>`;
  });

  // Legend
  const lY = H - 22;
  const legend = [
    { x: 14,  color: '#22c55e', label: 'Securite sociale' },
    { x: 148, color: '#3b82f6', label: 'Mutuelle' },
    { x: 230, color: '#ef4444', label: 'Reste a charge' },
  ];
  for (const l of legend) {
    rows += `<rect x="${l.x}" y="${lY}" width="10" height="10" fill="${l.color}" rx="2"/>`;
    rows += `<text x="${l.x+14}" y="${lY+9}" fill="#6b7280" font-size="10" font-family="system-ui,sans-serif">${l.label}</text>`;
  }
  rows += `<text x="${W-14}" y="${lY+9}" text-anchor="end" fill="#9ca3af" font-size="9" font-family="system-ui,sans-serif">Indicatif 2024</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#F5F5F5" rx="16"/>
  <text x="14" y="26" fill="#111827" font-size="15" font-weight="700" font-family="system-ui,sans-serif">Simulation : ${xe(sc.label)}</text>
  <text x="14" y="46" fill="#6b7280" font-size="12" font-family="system-ui,sans-serif">Cout total estime : ${sc.cost}&#8364;</text>
  ${rows}
</svg>`;
}

// ─── Explanations ─────────────────────────────────────────────────────────────

const EXPLANATIONS: Record<string, Record<string, string>> = {
  hospitalisation: {
    minimum: "Niveau Minimum : chambre partagee, remboursement Secu uniquement. Les depassements d'honoraires restent a votre charge. Convient si vous etes rarement hospitalise(e).",
    comfort:  "Niveau Confort : chambre individuelle (economie de 80-150 EUR/nuit), prise en charge partielle des depassements. Le bon equilibre pour la majorite des assures.",
    premium:  "Niveau Premium : clinique privee au choix, depassements couverts jusqu'a 200%, chambre individuelle garantie. Recommande si vous avez des antecedents medicaux.",
  },
  optique: {
    minimum:  "Niveau Minimum : verres simples et montures ~30 EUR, dans la limite du remboursement Secu. Adapte si vous ne portez pas de lunettes ou rarement.",
    standard: "Niveau Standard : montures jusqu'a ~150 EUR, verres progressifs couverts, renouvellement tous les 2 ans. Ideal si vous portez des lunettes au quotidien.",
    enhanced: "Niveau Renforce : montures haut de gamme (~300 EUR), verres premium, lentilles de contact incluses. A choisir si vous depensez plus de 300 EUR tous les 2 ans.",
  },
  dentaire: {
    routine:      "Niveau Courant : caries, detartrage, obturations. Suffit si votre situation dentaire est stable.",
    prosthetics:  "Niveau Protheses : couronnes, bridges, implants partiels rembourses. Indispensable si des soins lourds sont prevus (couts > 1 000 EUR).",
    orthodontics: "Niveau Orthodontie : appareils adulte et enfant inclus, en plus des protheses. Necessaire si un traitement orthodontique est en cours.",
  },
};

// ─── Tools ────────────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'calculate_da_quote',
    description: "Calcule un devis Direct Assurance mutuelle sante. Retourne les 3 formules avec tarifs, couverture, exemples concrets du quotidien, et un widget visuel SVG.",
    inputSchema: {
      type: 'object',
      properties: {
        date_of_birth:        { type: 'string',  description: 'Date de naissance DD/MM/YYYY' },
        regime:               { type: 'string',  enum: ['general','independent','agriculture','student','alsace_moselle','other'] },
        family_composition:   { type: 'string',  enum: ['single','couple','family','parent'] },
        hospitalization_need: { type: 'string',  enum: ['minimum','comfort','premium'] },
        optics_need:          { type: 'string',  enum: ['minimum','standard','enhanced'] },
        dental_need:          { type: 'string',  enum: ['routine','prosthetics','orthodontics'] },
        current_price:        { type: 'number',  description: 'Tarif mensuel actuel en EUR (optionnel)' },
        current_insurer:      { type: 'string',  description: 'Assureur actuel (optionnel)' },
      },
      required: ['date_of_birth','regime','family_composition','hospitalization_need','optics_need','dental_need'],
    },
  },
  {
    name: 'simulate_reimbursement',
    description: "Simule le remboursement d'un soin par chaque formule DA (Secu + mutuelle + reste a charge). Retourne un tableau et un widget visuel SVG avec barres colorees.",
    inputSchema: {
      type: 'object',
      properties: {
        scenario: {
          type: 'string',
          enum: ['dental_crown','optician_prog','specialist','gp_visit','hospital_3d','dental_implant'],
          description: "dental_crown (couronne ~900EUR), optician_prog (lunettes ~400EUR), specialist (sect.2 ~50EUR), gp_visit (generaliste ~25EUR), hospital_3d (hospit. ~1200EUR), dental_implant (implant ~1500EUR)",
        },
        formula: {
          type: 'string',
          enum: ['essentielle','essentielle_plus','equilibre'],
          description: "Formule specifique (optionnel — si absent, compare les 3)",
        },
      },
      required: ['scenario'],
    },
  },
  {
    name: 'explain_da_coverage',
    description: "Retourne une explication pedagogique detaillee d'un niveau de couverture.",
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['hospitalisation','optique','dentaire'] },
        level:    { type: 'string', description: 'minimum|comfort|premium / minimum|standard|enhanced / routine|prosthetics|orthodontics' },
      },
      required: ['category','level'],
    },
  },
  {
    name: 'chat_da_advisor',
    description: "Envoie un message au conseiller IA Direct Assurance (GPT). Pour les questions ouvertes ou la collecte d'infos manquantes.",
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        history: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' }, content: { type: 'string' } }, required: ['role','content'] } },
        slots:   { type: 'object' },
      },
      required: ['message'],
    },
  },
];

// ─── JSON-RPC helpers ─────────────────────────────────────────────────────────

function ok(id: any, result: unknown)                { return { jsonrpc: '2.0', id, result }; }
function rpcErr(id: any, code: number, message: string) { return { jsonrpc: '2.0', id, error: { code, message } }; }

// ─── Tool execution ───────────────────────────────────────────────────────────

async function runTool(name: string, args: Record<string, any>, baseUrl: string) {
  if (name === 'calculate_da_quote') {
    const text = renderQuoteMd(args, baseUrl);
    const svg  = generateQuoteSVG(args);
    const content: any[] = [{ type: 'text', text }];
    if (svg) content.push({ type: 'image', data: svgToBase64(svg), mimeType: 'image/svg+xml' });
    return { content };
  }

  if (name === 'simulate_reimbursement') {
    const { scenario, formula } = args;
    const text = renderSimulateMd(scenario, formula, baseUrl);
    const svg  = generateReimbursementSVG(scenario, formula);
    const content: any[] = [{ type: 'text', text }];
    if (svg) content.push({ type: 'image', data: svgToBase64(svg), mimeType: 'image/svg+xml' });
    return { content };
  }

  if (name === 'explain_da_coverage') {
    const { category, level } = args;
    const text = EXPLANATIONS[category]?.[level];
    if (!text) return { content: [{ type: 'text', text: `Inconnu : ${category}/${level}` }], isError: true };
    return { content: [{ type: 'text', text: `## ${category} — ${level}\n\n${text}` }] };
  }

  if (name === 'chat_da_advisor') {
    const { message, history = [], slots = {} } = args;
    const messages = [...history, { role: 'user', content: message }];
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, slots }),
    });
    if (!res.ok) return { content: [{ type: 'text', text: `Erreur API ${res.status}` }], isError: true };
    const data: any = await res.json();
    const lines = [`**Reponse :** ${data.reply}`];
    const extracted = Object.entries(data.slots ?? {}).filter(([, v]) => v != null);
    if (extracted.length) { lines.push('', '**Infos extraites :**'); extracted.forEach(([k, v]) => lines.push(`- ${k}: ${JSON.stringify(v)}`)); }
    if (data.action) lines.push('', `**Action :** ${data.action}`);
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }

  return { content: [{ type: 'text', text: `Outil inconnu : ${name}` }], isError: true };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(request: Request): Promise<Response> {
  const cors = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
  };

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST')   return new Response('POST only', { status: 405, headers: cors });

  const baseUrl = new URL(request.url).origin;
  let body: any;
  try { body = JSON.parse(new TextDecoder().decode(await boundedBody(request, 65536))); }
  catch (error) { return inputResponse(error, cors); }

  const requests = Array.isArray(body) ? body : [body];
  if (requests.length === 0 || requests.length > 10) return new Response(JSON.stringify(rpcErr(null, -32600, 'Invalid batch size')), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  const responses = await Promise.all(requests.map(async (req) => {
    if (!record(req) || typeof req.method !== 'string' || (req.params !== undefined && !record(req.params))) return rpcErr(null, -32600, 'Invalid Request');
    const { id = null, method, params = {} } = req;

    if (method === 'initialize') {
      return ok(id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'direct-assurance-mcp', version: '2.0.0' } });
    }
    if (method?.startsWith('notifications/')) return null;
    if (method === 'tools/list')   return ok(id, { tools: TOOLS });
    if (method === 'ping')         return ok(id, {});

    if (method === 'tools/call') {
      const { name, arguments: args = {} } = params as Record<string, unknown>;
      if (typeof name !== 'string' || !record(args)) return rpcErr(id, -32602, 'Invalid params');
      try {
        return ok(id, await runTool(name, args, baseUrl));
      } catch (e: any) {
        return rpcErr(id, -32603, 'Internal error');
      }
    }

    return rpcErr(id, -32601, `Method not found: ${method}`);
  }));

  const filtered = responses.filter(Boolean);
  const payload  = Array.isArray(body) ? filtered : filtered[0];
  if (!filtered.length) return new Response(null, { status: 204, headers: cors });
  return new Response(JSON.stringify(payload), { status: 200, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
