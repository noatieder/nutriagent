/**
 * ============================================================
 * NUTRIAGENT — groqclient.js
 * Groq API Client & Prompt Engineering Engine
 *
 * Provider:  Groq Cloud (groq.com)
 * Endpoint:  https://api.groq.com/openai/v1/chat/completions
 * Format:    OpenAI-compatible chat completions
 * Auth:      Authorization: Bearer gsk_...
 * Storage:   sessionStorage['GROQ_API_KEY'] (cleared on tab close)
 *
 * Responsibilities:
 *  - API key management (sessionStorage)
 *  - Core sendGroqRequest(systemPrompt, history, model, isJson)
 *  - Prompt compilation from FSM profile data
 *  - JSON enforcement via response_format + explicit prompt
 *  - Dietary compliance validation + automatic retry
 *  - Follow-up contextual chat (TC-06 off-domain detection)
 *  - 429 rate-limit handling with Retry-After header
 *
 * Models (free tier):
 *  llama-3.3-70b-versatile  — best JSON/instruction, 12K TPM
 *  llama-3.1-8b-instant     — fastest, 14,400 RPD
 *  llama-3.3-70b-specdec    — speculative decoding variant
 * ============================================================
 */

'use strict';

/* ============================================================
   SECTION 1 — CONFIGURATION
============================================================ */

const PROVIDERS = Object.freeze({
  groq: {
    baseUrl:      'https://api.groq.com/openai/v1/chat/completions',
    storageKey:   'GROQ_API_KEY',
    defaultModel: 'llama-3.3-70b-versatile',
    label:        'Groq',
    keyLink:      'https://console.groq.com/keys',
    keyPlaceholder: 'gsk_...',
    keyLabel:     'מפתח Groq API',
  },
  openai: {
    baseUrl:      'https://api.openai.com/v1/chat/completions',
    storageKey:   'OPENAI_API_KEY',
    defaultModel: 'gpt-4o-mini',
    label:        'OpenAI',
    keyLink:      'https://platform.openai.com/api-keys',
    keyPlaceholder: 'sk-...',
    keyLabel:     'מפתח OpenAI API',
  },
});

const AI_MODELS = Object.freeze([
  // Groq
  { id: 'llama-3.3-70b-versatile', provider: 'groq',   label: 'Llama 3.3 70B ⭐',    description: 'מומלץ — הטוב ביותר ל-JSON ולהוראות מורכבות', tpm: 12000, rpd: 1000 },
  { id: 'llama-3.1-8b-instant',    provider: 'groq',   label: 'Llama 3.1 8B ⚡',      description: 'הכי מהיר — 500K טוקן/יום', tpm: 6000, rpd: 14400 },
  { id: 'llama-3.3-70b-specdec',   provider: 'groq',   label: 'Llama 3.3 70B SpDec', description: 'Speculative Decoding — מהיר ביחס לגודלו', tpm: 6000, rpd: 1000 },
  // OpenAI
  { id: 'gpt-4o-mini',             provider: 'openai', label: 'GPT-4o Mini',          description: 'מהיר וחסכוני' },
  { id: 'gpt-4o',                  provider: 'openai', label: 'GPT-4o',               description: 'חכם ומדויק' },
  { id: 'gpt-4.1',                 provider: 'openai', label: 'GPT-4.1',              description: 'הדגם המתקדם של OpenAI' },
  { id: 'gpt-5',                   provider: 'openai', label: 'GPT-5 🚀',             description: 'הדגם החדש ביותר' },
]);

// Backward-compat alias used internally for Groq-only logic
const GROQ_MODELS = AI_MODELS.filter(m => m.provider === 'groq');

const GROQ_CONFIG = Object.freeze({
  defaultModel: 'llama-3.3-70b-versatile',
  baseUrl:      PROVIDERS.groq.baseUrl,
  temperature:  0.4,
  maxRetries:   3,
  retryDelayMs: 800,
  storageKey:   'GROQ_API_KEY',
});

/* ============================================================
   SECTION 2 — API KEY MANAGEMENT
   Key stored only in sessionStorage (cleared on tab close).
   Groq keys start with "gsk_" and are 56 characters.
============================================================ */

const HARDCODED_GROQ_KEY   = '__GROQ_API_KEY__';
const HARDCODED_OPENAI_KEY = '__OPENAI_API_KEY__';

function getProviderForModel(modelId) {
  return AI_MODELS.find(m => m.id === modelId)?.provider || 'groq';
}

const APIKeyManager = Object.freeze({

  getForProvider(provider) {
    const cfg = PROVIDERS[provider];
    if (!cfg) return null;
    const hardcoded = provider === 'openai' ? HARDCODED_OPENAI_KEY : HARDCODED_GROQ_KEY;
    try { return sessionStorage.getItem(cfg.storageKey) || hardcoded; }
    catch { return hardcoded; }
  },

  // Groq backward-compat
  get() { return this.getForProvider('groq'); },

  validate(key) {
    if (!key || typeof key !== 'string') return false;
    return key.trim().length > 20;
  },

  saveForProvider(provider, key) {
    if (!this.validate(key)) return false;
    const cfg = PROVIDERS[provider];
    if (!cfg) return false;
    try { sessionStorage.setItem(cfg.storageKey, key.trim()); return true; }
    catch { return false; }
  },

  save(key) { return this.saveForProvider('groq', key); },

  clearForProvider(provider) {
    const cfg = PROVIDERS[provider];
    if (!cfg) return;
    try { sessionStorage.removeItem(cfg.storageKey); } catch { /* silent */ }
  },

  clear() { this.clearForProvider('groq'); },

  isSet() { return true; },

  isSetForProvider(provider) {
    const key = this.getForProvider(provider);
    if (!key || key.length <= 20) return false;
    // If key is still the build-time placeholder (not yet injected), treat as unset
    if (/^__[A-Z_]+__$/.test(key)) return false;
    return true;
  },
});

/* ============================================================
   SECTION 3 — SYSTEM PROMPT BUILDER
   IMPORTANT: Groq requires the word "JSON" to appear in the
   system prompt when using response_format: {type:"json_object"}.
============================================================ */

function buildSystemPrompt(profile) {
  const genderLabel    = profile.gender === 'male' ? 'זכר' : 'נקבה';
  const genderPronoun  = profile.gender === 'male' ? 'המשתמש' : 'המשתמשת';
  const detectedGender = profile.detectedGender || profile.gender;

  const allergiesStr = profile.allergies?.length > 0 ? profile.allergies.join(', ') : 'אין';
  const dislikesStr  = profile.dislikes?.length  > 0 ? profile.dislikes.join(', ')  : 'אין';

  const activityLabel = profile.activityLevel === 'high'     ? 'גבוהה'
                      : profile.activityLevel === 'moderate'  ? 'בינונית'
                      : 'נמוכה';

  // Derive active allergen flags (used to adapt building rules)
  const noDairy = profile.allergies?.some(a => ['חלב','dairy','לקטוז','lactose'].includes(a.toLowerCase()))
               || profile.restrictions?.some(r => r.includes('לקטוז') || r.includes('טבעוני') || r.toLowerCase().includes('vegan') || r.toLowerCase().includes('lactose'));
  const noEggs  = profile.allergies?.some(a => ['ביצים','eggs'].includes(a.toLowerCase()))
               || profile.restrictions?.some(r => r.includes('טבעוני') || r.toLowerCase().includes('vegan'));
  const noFish  = profile.restrictions?.some(r => r.includes('טבעוני') || r.includes('צמחוני') || r.toLowerCase().includes('vegan') || r.toLowerCase().includes('vegetarian'));

  // Build restriction rules block
  const rules = [];
  if (profile.restrictions?.some(r => r.includes('גלוטן') || r.toLowerCase().includes('gluten')))
    rules.push('⛔ ללא גלוטן: אסור — לחם רגיל, פיתה, חיטה, שיבולת שועל, פסטה, בורגול, קוסקוס, עוגות, קרקרים');
  if (profile.restrictions?.some(r => r.includes('לקטוז') || r.toLowerCase().includes('lactose')))
    rules.push('⛔ ללא לקטוז: אסור — חלב, גבינה, יוגורט, שמנת, חמאה, גלידה, קוטג׳');
  if (profile.restrictions?.some(r => r.includes('טבעוני') || r.toLowerCase().includes('vegan')))
    rules.push('⛔ טבעוני: אסור — בשר, עוף, הודו, דגים, שרימפס, ביצים, חלב, גבינה, יוגורט, שמנת, דבש');
  if (profile.restrictions?.some(r => r.includes('צמחוני') || r.toLowerCase().includes('vegetarian')))
    rules.push('⛔ צמחוני: אסור — בשר, עוף, הודו, דגים, שרימפס. מותר — ביצים, מוצרי חלב');
  if (profile.allergies?.length > 0)
    rules.push(`⛔ אלרגיות (קריטי — אסור בכל ארוחה): ${allergiesStr}`);
  if (profile.dislikes?.length > 0)
    rules.push(`⚠️ דחיות: ${dislikesStr} — אל תכלול בשום ארוחה`);

  // Breakfast rule adapted to active allergens/restrictions
  const breakfastOptions = [
    ...(!noEggs  ? ['ביצים'] : []),
    ...(!noDairy ? ['גבינה לבנה','יוגורט'] : []),
    'טחינה','אבוקדו','שיבולת שועל',
  ].join('/');
  const breakfastForbidden = [
    'עוף','בשר','אורז',
    ...(noDairy ? ['גבינה','יוגורט','חלב'] : []),
    ...(noEggs  ? ['ביצים'] : []),
  ].join(', ');

  // Dinner rule adapted to restrictions
  const dinnerOptions = [
    ...(!noFish ? ['דג'] : []),
    ...(!noEggs ? ['ביצים','שקשוקה'] : []),
    'טופו','קטניות',
  ].join('/');

  return `אתה NutriAgent — מערכת תזונה מקצועית. צור תוכנית ארוחות יומית ב-JSON בלבד עבור ${genderPronoun}.

## פרופיל
גיל: ${profile.age} | מין: ${genderLabel} | משקל: ${profile.weight} ק"ג | גובה: ${profile.height} ס"מ
BMI: ${profile.bmi} (${profile.bmiCategory}) | פעילות: ${activityLabel} | יעד: ${profile.caloricTarget} קק"ל/יום

## אילוצים תזונתיים — הפרה = retry אוטומטי
${rules.length > 0 ? rules.join('\n') : '✅ אין הגבלות מיוחדות'}

## כללי בנייה חובה
1. **שמות ספציפיים בלבד** — אסור: "פרי/ירק/דג/חלבון". חובה: "בננה 100g / גזר 60g / סלמון 150g"
2. **גיוון חלבונים** — אותו חלבון עיקרי — מקסימום ארוחה אחת ביום
3. **בוקר** — ${breakfastOptions} + לחם + פרי. ❌ אסור: ${breakfastForbidden}
4. **חטיפים** — פרי/אגוזים/ירק בלבד${!noDairy ? '/יוגורט' : ''}. ❌ לא ארוחות מבושלות
5. **ערב** — קל מהצהריים: ${dinnerOptions} + ירקות
6. **כמויות** — גרמים מדויקים לכל פריט (לדוגמה: "חזה עוף 130g")

## שפה ופורמט
- עברית תקנית בלבד
- ${detectedGender === 'female' ? 'לשון נקבה' : 'לשון זכר'} בשדה summary
- JSON בלבד — ללא טקסט לפני/אחרי`;
}

/* ============================================================
   SECTION 4 — USER PROMPT BUILDER
============================================================ */

function buildUserPrompt(profile, retryCount = 0, retryViolations = []) {
  let retryHeader = '';
  if (retryCount > 0 && retryViolations.length > 0) {
    retryHeader =
      `⚠️ ניסיון ${retryCount} — הפרות שנמצאו בתגובה הקודמת:\n` +
      retryViolations.map(v => `  • ${v}`).join('\n') +
      '\n\nתקן את כל ההפרות לפני שתחזיר תגובה חדשה.\n\n';
  }

  const t = {
    breakfast:       Math.round(profile.caloricTarget * 0.25),
    morning_snack:   Math.round(profile.caloricTarget * 0.10),
    lunch:           Math.round(profile.caloricTarget * 0.30),
    afternoon_snack: Math.round(profile.caloricTarget * 0.10),
    dinner:          Math.round(profile.caloricTarget * 0.20),
    evening_snack:   Math.round(profile.caloricTarget * 0.05),
  };

  return `${retryHeader}צור תוכנית ארוחות יומית — יעד ${profile.caloricTarget} קק"ל.

החזר JSON בדיוק בסכמה הבאה (ללא שדות נוספים):

{"total_calories":${profile.caloricTarget},"meal_plan":{"breakfast":{"name":"...","description":"פריט-ספציפי Xg + פריט-ספציפי Yg","calories":${t.breakfast}},"morning_snack":{"name":"...","description":"פריט-ספציפי Xg","calories":${t.morning_snack}},"lunch":{"name":"...","description":"פריט-ספציפי Xg + פריט-ספציפי Yg","calories":${t.lunch}},"afternoon_snack":{"name":"...","description":"פריט-ספציפי Xg","calories":${t.afternoon_snack}},"dinner":{"name":"...","description":"פריט-ספציפי Xg + פריט-ספציפי Yg","calories":${t.dinner}},"evening_snack":{"name":"...","description":"פריט-ספציפי Xg","calories":${t.evening_snack}}},"summary":"מסר אישי קצר ומעודד"}`;
}

/* ============================================================
   SECTION 5 — FOLLOW-UP SYSTEM PROMPT (TC-06 off-domain)
============================================================ */

function buildFollowupSystemPrompt(profile, planJson) {
  const genderPronoun  = profile.gender === 'male' ? 'המשתמש' : 'המשתמשת';
  const detectedGender = profile.detectedGender || profile.gender;

  const mealSummary = Object.entries(planJson.meal_plan || {})
    .map(([slot, meal]) => `• ${slot}: ${meal.name} (${meal.calories} קק"ל)`)
    .join('\n');

  return `אתה NutriAgent — עוזר תזונתי המתמחה בתוכנית הארוחות שנוצרה עבור ${genderPronoun}.

## תוכנית הארוחות שנוצרה
${mealSummary}
סה"כ: ${planJson.total_calories} קק"ל/יום

## הגבלות תגובה — קריטי
1. ענה אך ורק על שאלות הקשורות לתוכנית הארוחות שלעיל.
2. אם הבקשה אינה קשורה לתזונה, לתפריט, לארוחות, או לאחד מהמאכלים שנבחרו — החזר את הטקסט הבא בדיוק:
   [OFF_DOMAIN] שאלתך חורגת מתחום הייעוץ התזונתי. אשמח לעזור בנושאי תזונה ותפריט בלבד.
3. תקשר תמיד בעברית תקנית בלבד.
4. השתמש בנטייה מגדרית: ${detectedGender === 'female' ? 'לשון נקבה' : 'לשון זכר'}.
5. אל תמציא מידע תזונתי שאינו מבוסס על הנתונים שסופקו.
6. אם שאלה דורשת ייעוץ רפואי — הפנה לאיש מקצוע מוסמך.
7. תגובות תמציתיות ומקצועיות — עד 3 פסקאות.`;
}

/* ============================================================
   SECTION 6 — CORE API FUNCTION: sendGroqRequest
   OpenAI-compatible endpoint with JSON enforcement.
   Returns: parsed JS object (isJsonOutput=true) or raw string (false).
   Throws on API error, quota, network failure, or JSON parse failure.
============================================================ */

async function sendGroqRequest(systemPrompt, conversationHistory, selectedModel, isJsonOutput = true) {
  const model    = selectedModel || GROQ_CONFIG.defaultModel;
  const provider = getProviderForModel(model);
  const cfg      = PROVIDERS[provider];
  const apiKey   = APIKeyManager.getForProvider(provider);
  if (!apiKey || /^__[A-Z_]+__$/.test(apiKey)) throw new Error('API_KEY_MISSING');

  // Build messages array (OpenAI format)
  const messages = [
    { role: 'system', content: systemPrompt },
    ...(conversationHistory || []).map(m => ({
      role:    m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })),
  ];

  const body = {
    model,
    messages,
    temperature: GROQ_CONFIG.temperature,
    ...(isJsonOutput ? { response_format: { type: 'json_object' }, max_tokens: 700 } : {}),
  };

  const L = window.NutriLogger;
  L?.info('API', `→ POST ${cfg.label} ${model}`, { isJsonOutput, messages: messages.length });

  let response;
  try {
    response = await fetch(cfg.baseUrl, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    L?.error('API', `Network error: ${networkErr.message}`);
    throw new Error(`NETWORK_ERROR: ${networkErr.message}`);
  }

  L?.info('API', `← HTTP ${response.status} ${response.statusText}`);

  if (!response.ok) {
    let errorMsg = `HTTP ${response.status}`;
    try {
      const errBody = await response.json();
      errorMsg = errBody?.error?.message || errorMsg;
      L?.error('API', 'API error body', errBody);
    } catch { /* ignore */ }

    // 429 — check Retry-After header, then parse message
    if (response.status === 429) {
      const retryHeader = response.headers.get('Retry-After') || response.headers.get('retry-after') || '60';
      const retryMatch  = errorMsg.match(/try again in ([\d.]+)s/i) ||
                          errorMsg.match(/retry.{0,10}([\d.]+)\s*s/i);
      const seconds = retryMatch
        ? Math.ceil(parseFloat(retryMatch[1]))
        : Math.ceil(parseFloat(retryHeader)) || 60;
      throw new Error(`QUOTA_EXCEEDED:${seconds}`);
    }

    throw new Error(`API_ERROR: ${errorMsg}`);
  }

  const data    = await response.json();
  const rawText = data?.choices?.[0]?.message?.content || '';
  const finishReason = data?.choices?.[0]?.finish_reason || '';

  L?.debug('API', `Response length: ${rawText.length} chars | finish_reason: ${finishReason} | first 400:`, rawText.slice(0, 400));

  if (!isJsonOutput) return rawText;

  // JSON mode: parse and return
  try {
    let clean = rawText.trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/,      '')
      .replace(/\s*```$/,      '');
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) clean = match[0];
    const parsed = JSON.parse(clean);
    L?.info('API', 'JSON parsed OK', { keys: Object.keys(parsed) });
    return parsed;
  } catch (parseErr) {
    L?.error('API', 'JSON parse failed', { error: parseErr.message, raw: rawText.slice(0, 400) });
    throw new Error(`JSON_PARSE_FAILED: ${parseErr.message} | raw: ${rawText.slice(0, 120)}`);
  }
}

/* ============================================================
   SECTION 7 — POST-PROCESSING: FOOD ITEM MATCHING
   After LLM generation, match meal descriptions to the food database
   by Hebrew name similarity. This replaces the unreliable LLM-generated
   food_item_ids and cluster_tags.
============================================================ */

function postProcessMealPlan(planJson) {
  const db = window.NutriAgent?.FOOD_DATABASE;
  const clusters = window.NutriAgent?.KMEANS_CLUSTERS;
  if (!db || !clusters || !planJson?.meal_plan) return planJson;

  for (const meal of Object.values(planJson.meal_plan)) {
    const searchText = `${meal.name || ''} ${meal.description || ''}`.toLowerCase();

    // Track best match per cluster so we can prefer lean protein (cluster 1) for swaps.
    const bestByCluster = {};
    for (const item of db) {
      const words    = item.name.toLowerCase().split(/[\s,+|]+/).filter(w => w.length > 1);
      const hitCount = words.filter(w => searchText.includes(w)).length;
      const ratio    = words.length > 0 ? hitCount / words.length : 0;
      const score    = hitCount * ratio; // penalises partial matches, rewards multi-word exact hits
      const c = item.cluster;
      if (!bestByCluster[c] || score > bestByCluster[c].score) {
        bestByCluster[c] = { id: item.id, score };
      }
    }

    const allMatches  = Object.values(bestByCluster).filter(m => m.score > 0);
    const overallBest = allMatches.reduce((a, b) => b.score > a.score ? b : a, { id: null, score: 0 });
    const proteinBest = bestByCluster[1]; // cluster 1 = lean protein
    // Prefer lean protein when it scores ≥60% of the overall best — keeps the swap engine useful.
    const chosen = (proteinBest && overallBest.score > 0 && proteinBest.score >= overallBest.score * 0.6)
      ? proteinBest : overallBest;

    const bestId    = chosen.id;
    const bestScore = chosen.score;

    if (bestId && bestScore >= 0.4) {
      const matched = db.find(f => f.id === bestId);
      meal.food_item_ids = [bestId];
      meal.cluster_tags  = matched ? [clusters[matched.cluster].nameShort] : [];
    } else {
      // fallback: cluster 0 (volume)
      meal.food_item_ids = [];
      meal.cluster_tags  = [clusters[0].nameShort];
    }
  }

  return planJson;
}

/* ============================================================
   SECTION 7B — JSON STRUCTURE VALIDATION
============================================================ */

function validateMealPlanStructure(json) {
  const required      = ['total_calories', 'meal_plan', 'summary'];
  const requiredMeals = ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack'];
  const mealFields    = ['name', 'description', 'calories'];
  const missingFields = [];

  for (const field of required) {
    if (!(field in json)) missingFields.push(field);
  }
  if (json.meal_plan) {
    for (const meal of requiredMeals) {
      if (!(meal in json.meal_plan)) {
        missingFields.push(`meal_plan.${meal}`);
      } else {
        for (const mf of mealFields) {
          if (!(mf in json.meal_plan[meal])) missingFields.push(`meal_plan.${meal}.${mf}`);
        }
      }
    }
  }
  return { valid: missingFields.length === 0, missingFields };
}

/* ============================================================
   SECTION 8 — MEAL PLAN GENERATION PIPELINE
============================================================ */

async function generateMealPlan(profile, selectedModel, onProgress = () => {}) {
  let retryCount     = 0;
  let lastViolations = [];

  const { validateMealPlanCompliance } = window.NutriAgent;

  while (retryCount <= GROQ_CONFIG.maxRetries) {

    onProgress('building', `🧬 בונה פרומפט${retryCount > 0 ? ` (ניסיון ${retryCount + 1})` : ''}…`);

    const systemPrompt = buildSystemPrompt(profile);
    const userPrompt   = buildUserPrompt(profile, retryCount, lastViolations);
    const messages     = [{ role: 'user', content: userPrompt }];

    // Use 70B when: (a) profile has constraints, (b) this is a retry, (c) selectedModel is 8B on retry
    const hasConstraints = (profile.allergies?.length > 0)
      || profile.restrictions?.some(r => r !== 'אין' && r.trim() !== '');
    const use8B = !hasConstraints && retryCount === 0
      && (!selectedModel || selectedModel === 'llama-3.1-8b-instant');
    const effectiveModel  = use8B
      ? 'llama-3.1-8b-instant'
      : (selectedModel && selectedModel !== 'llama-3.1-8b-instant' ? selectedModel : GROQ_CONFIG.defaultModel);
    const providerLabel   = getProviderForModel(effectiveModel) === 'openai' ? 'OpenAI' : 'Groq';
    onProgress('calling', `🤖 שולח בקשה ל-${providerLabel} (${effectiveModel})…`);

    let planJson;
    try {
      planJson = await sendGroqRequest(systemPrompt, messages, effectiveModel, true);
    } catch (err) {
      if (err.message === 'API_KEY_MISSING') {
        return { success: false, error: 'API_KEY_MISSING', message: 'מפתח API חסר. אנא הגדר מפתח תקין.' };
      }
      if (err.message.startsWith('QUOTA_EXCEEDED')) {
        const seconds = parseInt(err.message.split(':')[1], 10) || 60;
        return {
          success: false,
          error: 'QUOTA_EXCEEDED',
          retryAfterSeconds: seconds,
          message: `⏳ חריגה ממגבלת קצב Groq API.\nאנא המתן **${seconds} שניות** ונסה שוב.`,
        };
      }
      if (err.message.startsWith('JSON_PARSE_FAILED')) {
        if (retryCount < GROQ_CONFIG.maxRetries) {
          onProgress('retry', '⚠️ תגובה לא תקינה. מנסה שוב…');
          await delay(GROQ_CONFIG.retryDelayMs);
          retryCount++;
          continue;
        }
        return { success: false, error: 'JSON_PARSE_ERROR', message: 'המערכת לא הצליחה לפענח את תגובת ה-AI. אנא נסה שוב.' };
      }
      if (retryCount < GROQ_CONFIG.maxRetries) {
        onProgress('retry', `⚠️ שגיאת רשת. מנסה שוב…`);
        await delay(GROQ_CONFIG.retryDelayMs);
        retryCount++;
        continue;
      }
      return { success: false, error: 'NETWORK_ERROR', message: `שגיאת רשת: ${err.message}.` };
    }

    onProgress('validating', '🔍 מאמת מבנה תוכנית…');

    const { valid: structureValid, missingFields } = validateMealPlanStructure(planJson);
    if (!structureValid) {
      if (retryCount < GROQ_CONFIG.maxRetries) {
        lastViolations = missingFields.map(f => `שדה חסר: ${f}`);
        onProgress('retry', `⚠️ מבנה חסר (${missingFields.length} שדות). מנסה שוב…`);
        await delay(GROQ_CONFIG.retryDelayMs);
        retryCount++;
        continue;
      }
    }

    // Match food items from database (replaces unreliable LLM-generated IDs)
    postProcessMealPlan(planJson);

    onProgress('compliance', '✅ בודק ציות לאילוצים תזונתיים…');

    const { valid: complianceValid, violations } = validateMealPlanCompliance(planJson, profile);

    if (!complianceValid) {
      if (retryCount < GROQ_CONFIG.maxRetries) {
        lastViolations = violations;
        onProgress('retry', `⚠️ נמצאו ${violations.length} הפרות ציות. מנסה שוב (${retryCount + 1}/${GROQ_CONFIG.maxRetries})…`);
        await delay(GROQ_CONFIG.retryDelayMs);
        retryCount++;
        continue;
      }
      return {
        success: true, planJson, violations, retryCount,
        warning: 'הגרסה הזמינה עשויה להכיל חריגות קלות. מומלץ לאמת עם איש מקצוע.',
      };
    }

    onProgress('complete', '🌿 תוכנית הארוחות מוכנה!');
    return { success: true, planJson, violations: [], retryCount };
  }

  return { success: false, error: 'MAX_RETRIES_EXCEEDED', message: 'הגעת למספר הניסיונות המרבי. אנא נסה שוב.' };
}

/* ============================================================
   SECTION 10 — FOLLOW-UP CHAT HANDLER (TC-06 off-domain)
============================================================ */

async function sendFollowupMessage(userQuery, profile, planJson, chatHistory = [], selectedModel = null) {
  const { isNonHebrew, NON_HEBREW_RESPONSE } = window.NutriAgent;

  if (isNonHebrew(userQuery)) {
    return { success: true, reply: NON_HEBREW_RESPONSE };
  }

  const systemPrompt = buildFollowupSystemPrompt(profile, planJson);

  const historyMessages = chatHistory.slice(-6).flatMap(turn => [
    { role: 'user',      content: turn.question },
    { role: 'assistant', content: turn.answer   },
  ]);
  const messages = [
    ...historyMessages,
    { role: 'user', content: userQuery },
  ];

  try {
    const reply = (await sendGroqRequest(systemPrompt, messages, selectedModel, false)).trim();

    if (reply.startsWith('[OFF_DOMAIN]')) {
      return { success: true, reply: reply.replace('[OFF_DOMAIN]', '').trim(), isOffDomain: true };
    }
    return { success: true, reply };

  } catch (err) {
    if (err.message === 'API_KEY_MISSING') {
      return { success: false, error: 'API_KEY_MISSING', reply: 'מפתח API חסר.' };
    }
    if (err.message.startsWith('QUOTA_EXCEEDED')) {
      const seconds = parseInt(err.message.split(':')[1], 10) || 60;
      return {
        success: true,
        reply: `⏳ **חריגה ממגבלת קצב (429)**\n\nGroq API מוגבל כרגע. אנא המתן **${seconds} שניות** ונסה לשאול שוב.`,
        isQuotaError: true,
      };
    }
    return { success: false, error: 'NETWORK_ERROR', reply: 'מצטער, אירעה שגיאת רשת. אנא נסה שוב.' };
  }
}

/* ============================================================
   SECTION 11 — API KEY LIVE VALIDATION
============================================================ */

async function validateAPIKey(key, provider = 'groq') {
  if (!APIKeyManager.validate(key)) {
    const cfg = PROVIDERS[provider] || PROVIDERS.groq;
    return { valid: false, error: `פורמט מפתח לא תקין. מפתח ${cfg.label} מתחיל ב-${cfg.keyPlaceholder.replace('...', '')} ואורכו לפחות 20 תווים.` };
  }

  const previous = APIKeyManager.getForProvider(provider);
  APIKeyManager.saveForProvider(provider, key);

  const testModel = PROVIDERS[provider]?.defaultModel || GROQ_CONFIG.defaultModel;

  try {
    const reply = await sendGroqRequest(
      'You are a helpful assistant. Answer very briefly.',
      [{ role: 'user', content: 'Reply with exactly one word: שלום' }],
      testModel,
      false
    );
    if (reply?.length > 0) return { valid: true };
    return { valid: false, error: 'המפתח לא החזיר תגובה תקינה.' };
  } catch (err) {
    if (previous) { APIKeyManager.saveForProvider(provider, previous); }
    else { APIKeyManager.clearForProvider(provider); }
    const msg = err.message || '';
    if (msg.includes('401') || msg.includes('invalid_api_key') || msg.includes('Invalid API Key') || msg.includes('Incorrect API key')) {
      return { valid: false, error: `מפתח ${PROVIDERS[provider]?.label || ''} API לא תקין.` };
    }
    if (msg.startsWith('QUOTA_EXCEEDED')) {
      return { valid: false, error: 'חריגה ממגבלת קצב (429). אנא המתן מספר שניות ונסה שוב.' };
    }
    return { valid: false, error: `שגיאת API: ${msg}` };
  }
}

/* ============================================================
   SECTION 12 — UTILITY HELPERS
============================================================ */

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function mealSlotToHebrew(slot) {
  const map = {
    breakfast:       'ארוחת בוקר',
    morning_snack:   'חטיף בוקר',
    lunch:           'ארוחת צהריים',
    afternoon_snack: 'חטיף אחה"צ',
    dinner:          'ארוחת ערב',
    evening_snack:   'חטיף לילה',
  };
  return map[slot] || slot;
}

function sumMealCalories(mealPlan) {
  return Object.values(mealPlan || {})
    .reduce((sum, meal) => sum + (Number(meal.calories) || 0), 0);
}

function extractClusterIndex(tagStr) {
  const match = tagStr?.match(/אשכול\s+(\d)/);
  return match ? parseInt(match[1], 10) : null;
}

/* ============================================================
   SECTION 13 — GLOBAL EXPORTS
============================================================ */

window.NutriAgentAPI = Object.freeze({
  APIKeyManager,
  validateAPIKey,
  generateMealPlan,
  buildSystemPrompt,
  buildUserPrompt,
  sendFollowupMessage,
  mealSlotToHebrew,
  sumMealCalories,
  extractClusterIndex,
  validateMealPlanStructure,
  getProviderForModel,
  AI_MODELS,
  PROVIDERS,
  GROQ_MODELS,  // backward-compat
  delay,
});

console.log(
  '%c⚡ NutriAgent Groq Client Loaded',
  'color:#f0abfc;font-weight:bold;font-size:14px',
  '| Default model:', GROQ_CONFIG.defaultModel,
  '| Auth: Bearer gsk_...',
  '| Storage: sessionStorage',
);
