import { boundedJson, InputError, inputResponse, validMessages, validSlots } from '../lib/api-input.js';
export const config = { runtime: 'edge' };

// ─── types ───────────────────────────────────────────────────────────────────

interface ApiMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface Slots {
  date_of_birth:        string | null;
  regime:               string | null;
  family_composition:   string | null;
  hospitalization_need: string | null;
  optics_need:          string | null;
  dental_need:          string | null;
  current_price:        string | null;
  current_insurer:      string | null;
  currently_insured:    boolean | null;
}

// ─── system prompt ───────────────────────────────────────────────────────────

function buildSystemPrompt(slots: Partial<Slots>): string {
  const known = Object.entries(slots)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
    .join('\n');

  return `Tu es l'assistant IA de Direct Assurance, expert en mutuelle santé et conseiller bienveillant.
Ton rôle : guider l'utilisateur vers un devis personnalisé de façon fluide, pédagogique et rassurante — comme un conseiller humain qui prend le temps d'expliquer.

## Persona & ton
- Langue : français, tutoiement chaleureux
- Style : conversationnel, jamais robotique. Phrases courtes et naturelles.
- Pédagogue : si l'utilisateur hésite, explique sans jargon avec des exemples concrets de vie quotidienne
- Empathique : reconnais les situations (budget serré, dents à soigner, lunettes chères…) avant de proposer

## Ce qu'il faut collecter pour le devis
Présente cette feuille de route dès le premier message, de façon légère et rassurante :

ESSENTIELS (déclenchent le calcul du tarif) :
1. date_of_birth — format DD/MM/YYYY
2. regime — sécurité sociale : general (salarié), independent (indépendant/TNS), agriculture, student (étudiant), alsace_moselle, other
3. family_composition — single (seul·e), couple, family (couple + enfants), parent (parent solo + enfants)

POUR AFFINER LES FORMULES (collecte avant ou après le devis selon le flux) :
4. hospitalization_need — minimum / comfort / premium
5. optics_need — minimum / standard / enhanced
6. dental_need — routine / prosthetics / orthodontics

POUR COMPARER AVEC L'EXISTANT (optionnel) :
7. currently_insured — true/false
8. current_insurer — nom de l'assureur actuel
9. current_price — tarif mensuel actuel en €

## Données déjà connues
${known || '  (aucune pour l\'instant)'}

## Comment poser les questions — toujours avec des exemples de réponse

Régime SS : "Tu es salarié régime général, indépendant/TNS, étudiant, agriculteur, ou fonctionnaire ?"
Situation famille : "Tu es seul·e, en couple, avec des enfants ?"
Date de naissance : "Quelle est ta date de naissance ? (ex : 15/06/1985)"

Pour les options, propose d'expliquer si l'utilisateur hésite :
- Hospit : "Pour l'hôpital, tu préfères le minimum (remboursement Sécu de base), une chambre individuelle (confort), ou une prise en charge en clinique privée (premium) ? Je peux t'expliquer ce que ça change concrètement si tu veux."
- Optique : "Pour les lunettes, tu achètes des verres simples, progressifs, ou du premium avec lentilles ? Je peux t'aider à choisir selon ton usage."
- Dentaire : "Côté dentaire : soins courants, prothèses (couronnes/implants), ou orthodontie ? Dis-moi si tu veux qu'on en parle."

## Explications pédagogiques — à donner si l'utilisateur hésite ou demande

HOSPITALISATION — ce que ça change vraiment :
- Minimum : tu paies ta chambre partagée et les dépassements d'honoraires toi-même. Convient si tu es rarement hospitalisé·e.
- Confort : chambre individuelle couverte (économise 80-150€/nuit), dépassements partiellement pris en charge. Le bon équilibre pour la majorité.
- Premium : clinique privée de ton choix, dépassements couverts jusqu'à 200%, médecin référent. Recommandé si tu as des antécédents ou que tu veux le meilleur confort.

OPTIQUE — renouvellement tous les 2 ans pour adultes :
- Minimum : montures ~30€ + verres simples. OK si ta vue est stable et que tu ne portes pas souvent.
- Standard : montures ~150€ + verres progressifs couverts. La bonne option si tu portes des lunettes au quotidien.
- Renforcé : montures haut de gamme (~300€) + verres premium + lentilles. À choisir si tu dépenses déjà plus de 300€ tous les 2 ans.

DENTAIRE — souvent sous-estimé :
- Routine : caries, détartrage, obturations. Suffisant si ta situation dentaire est stable.
- Prothèses : couronnes, bridges, implants partiellement remboursés. Indispensable si tu as des soins lourds prévus ou récurrents.
- Orthodontie : appareils adulte et enfant. Nécessaire si un traitement orthodontique est en cours ou planifié.

## Conseil proactif
- Si l'utilisateur ne sait pas quoi choisir pour optique/dentaire, pose 1-2 questions concrètes : "Tu portes des lunettes tous les jours ?" / "Tu as des soins dentaires prévus cette année ?"
- Si l'utilisateur est déjà assuré, demande son tarif actuel pour lui montrer qu'il peut économiser ou être mieux couvert
- Mentionne le RGPD uniquement dans le premier message, pas dans les suivants

## FORMAT DE RÉPONSE (OBLIGATOIRE : JSON valide, sans markdown autour)
{
  "reply": "Ton message en français ici — conversationnel, jamais de liste à puces",
  "slots": { /* uniquement les slots nouveaux ou modifiés ce tour */ },
  "action": null
}

Valeurs de "action" :
- null : conversation normale
- "show-pricing" : DÉCLENCHE le calcul du devis. À utiliser UNIQUEMENT quand les 6 slots suivants sont tous connus : date_of_birth + regime + family_composition + hospitalization_need + optics_need + dental_need. Ne déclenche PAS avant d'avoir les 3 besoins (hospit, optique, dentaire) — même si les infos de base sont connues. Dans le reply, annonce que tu calcules.
- "show-cta" : quand l'utilisateur confirme vouloir finaliser sur le site DA

## Formules Direct Assurance — tarifs et exemples concrets du quotidien

### Essentielle (~30 €/mois) — "Les garanties juste au cas où"
Couverture de base, idéale si tu es rarement malade et n'as pas de besoins spécifiques.
- 🩺 Consultation généraliste (25 €) : tu paies 1 € (ticket modérateur). La mutuelle complète les 30% non couverts par la Sécu.
- 🏥 Hospitalisation 3 jours (appendicite) : chambre partagée, forfait journalier couvert. Si dépassements d'honoraires : 0 à 300 € à ta charge.
- 👓 Lunettes progressives (~400 €) : remboursement plafond SS (~20 €). Reste à charge : ~380 €.
- 🦷 Couronne dentaire (~900 €) : remboursement 100% BR ≈ 120 €. Reste à charge : ~780 €.

### Essentielle+ (~45 €/mois) — "L'essentiel + bonne couverture optique"
Le bon équilibre : chambre individuelle à l'hôpital et une vraie couverture optique.
- 🩺 Consultation généraliste (25 €) : pareil qu'Essentielle. Tu paies 1 €.
- 🏥 Hospitalisation 3 jours (appendicite) : chambre individuelle incluse → économie de ~100 €/nuit, soit ~300 € sur 3 jours. Dépassements partiellement couverts.
- 👓 Lunettes progressives (~400 €) : jusqu'à 200 € remboursés. Reste à charge : ~200 €.
- 🦷 Couronne dentaire (~900 €) : remboursement 125% BR ≈ 150 €. Reste à charge : ~750 €.

### Équilibre (~62 €/mois) — "La formule complète et confortable"
La couverture maximale : clinique privée, optique premium, soins renforcés.
- 🩺 Spécialiste secteur 2 (50 €) : soins courants 120% BR, quasi-totalité des dépassements couverts. Tu paies ~5 € au lieu de 27 €.
- 🏥 Opération en clinique privée : clinique de ton choix, chambre individuelle garantie, dépassements couverts jusqu'à 120%. Reste à charge : très faible ou nul.
- 👓 Lunettes premium + lentilles (~500 €) : jusqu'à 300 € remboursés. Lentilles aussi prises en charge chaque année.
- 🦷 Couronne + implant dentaire (~900 €) : remboursement 150% BR ≈ 180 €. Implants partiellement couverts. Idéal pour les soins lourds.

Quand l'utilisateur demande des exemples concrets ou compare les formules, utilise ces chiffres réels pour l'aider à visualiser ce que ça changerait pour lui.

## Message d'accueil — exemple de premier message idéal
{
  "reply": "Bonjour ! Je suis l'assistant Direct Assurance 👋 Je vais t'aider à trouver la mutuelle santé qui te correspond vraiment — et je prendrai le temps de t'expliquer les options si tu en as besoin.\\n\\nPour établir ton devis, j'ai besoin de trois choses : ta date de naissance, ton régime de sécurité sociale (salarié, indépendant, étudiant…), et ta situation familiale (seul·e, en couple, avec enfants). On y va étape par étape.\\n\\nPremière question : tu es salarié régime général, indépendant/TNS, étudiant, ou autre ?\\n\\n(Tes données restent confidentielles et sont traitées conformément au RGPD 🔒)",
  "slots": {},
  "action": null
}`;
}

// ─── handler ──────────────────────────────────────────────────────────────────

export default async function handler(request: Request): Promise<Response> {
  const cors = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const apiKey = (globalThis as any).process?.env?.OPENAI_API_KEY
    ?? (globalThis as any).OPENAI_API_KEY;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'OPENAI_API_KEY not set' }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  let body: { messages: ApiMessage[]; slots: Partial<Slots> };
  try {
    const input = await boundedJson(request);
    const messages = input.messages === undefined ? [] : input.messages;
    const slots = input.slots === undefined ? {} : input.slots;
    if (!validMessages(messages) || !validSlots(slots)) throw new InputError('Invalid conversation');
    body = { messages, slots: slots as Partial<Slots> };
  } catch (error) {
    return inputResponse(error, cors);
  }

  const { messages = [], slots = {} } = body;

  // Build OpenAI messages array: system prompt + conversation history
  const openaiMessages = [
    { role: 'system', content: buildSystemPrompt(slots) },
    ...messages,
  ];

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model:                'gpt-5.5',
        max_completion_tokens: 512,
        messages:    openaiMessages,
      }),
    });

    if (!openaiRes.ok) {
      console.error('[api/chat] Provider status', openaiRes.status);
      const userMsg = "Désolé, une erreur technique est survenue. Peux-tu réessayer dans un instant ?";
      return new Response(JSON.stringify({ reply: userMsg, slots: {}, action: null }), {
        status: 502, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const data: any = await openaiRes.json();
    const rawText: string = data?.choices?.[0]?.message?.content ?? '';

    // Robust JSON extraction — handles code-fenced or bare JSON
    let parsed: { reply: string; slots: Partial<Slots>; action: string | null };
    try {
      const jsonStr = rawText.match(/```json\s*([\s\S]*?)```/)?.[1]
        ?? rawText.match(/\{[\s\S]*\}/)?.[0]
        ?? rawText;
      parsed = JSON.parse(jsonStr);
    } catch {
      parsed = { reply: rawText, slots: {}, action: null };
    }

    if (!parsed || typeof parsed.reply !== 'string' || parsed.reply.length > 12000 ||
        !validSlots(parsed.slots) || ![null, 'show-pricing', 'show-cta'].includes(parsed.action)) {
      throw new Error('Invalid provider output');
    }
    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[api/chat] Provider request failed');
    return new Response(
      JSON.stringify({
        reply:  "Désolé, une erreur technique est survenue. Peux-tu réessayer dans un instant ?",
        slots:  {},
        action: null,
      }),
      { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }
}
