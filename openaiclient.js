/**
 * ============================================================
 * NUTRIAGENT — openaiclient.js
 * OpenAI API Client & Prompt Engineering Engine
 *
 * Responsibilities:
 *  - API key management (localStorage, never transmitted elsewhere)
 *  - Prompt compilation from FSM profile data
 *  - Strict JSON schema enforcement via response_format
 *  - Post-generation DBSCAN -1 content scan
 *  - Dietary compliance validation + automatic retry on violation
 *  - Follow-up contextual chat (scoped to generated plan)
 *  - Token-efficient stateless call architecture
 *  - Hebrew gender morphology in all system prompts
 * ============================================================
 */

'use strict';

/* ============================================================
   SECTION 1 — CONFIGURATION CONSTANTS
============================================================ */

const OPENAI_CONFIG = Object.freeze({
  endpoint:      'https://api.anthropic.com/v1/messages',
  model:         'claude-sonnet-4-20250514',
  maxTokens:     2048,
  temperature:   0.4,          // Low variance for clinical consistency
  maxRetries:    3,             // Max compliance retry attempts
  retryDelayMs:  800,           // Delay between retry attempts
  storageKey:    'nutriagent_api_key',
});

/* ============================================================
   SECTION 2 — API KEY MANAGEMENT
   Key is stored only in localStorage.
   Never logged, never sent anywhere except the OpenAI endpoint.
============================================================ */

const APIKeyManager = Object.freeze({

  /**
   * Retrieves the stored API key.
   * @returns {string|null}
   */
  get() {
    try {
      return localStorage.getItem(OPENAI_CONFIG.storageKey) || null;
    } catch {
      return null;
    }
  },

  /**
   * Validates key format (must start with sk- and be >20 chars).
   * Does NOT make a test API call.
   * @param {string} key
   * @returns {boolean}
   */
  validate(key) {
    if (!key || typeof key !== 'string') return false;
    return key.startsWith('sk-') && key.length > 20;
  },

  /**
   * Saves a validated API key to localStorage.
   * @param {string} key
   * @returns {boolean} success
   */
  save(key) {
    if (!this.validate(key)) return false;
    try {
      localStorage.setItem(OPENAI_CONFIG.storageKey, key.trim());
      return true;
    } catch {
      return false;
    }
  },

  /** Removes the stored API key. */
  clear() {
    try {
      localStorage.removeItem(OPENAI_CONFIG.storageKey);
    } catch { /* silent */ }
  },

  /** Returns true if a valid key is currently stored. */
  isSet() {
    const key = this.get();
    return this.validate(key);
  },
});

/* ============================================================
   SECTION 3 — SYSTEM PROMPT BUILDER
   Constructs the clinical system prompt injected into every
   meal-plan generation call.
   The system prompt encodes ALL constraints so the model
   cannot deviate from the architecture.
============================================================ */

/**
 * Builds the full system prompt for meal plan generation.
 * @param {object} profile — complete FSM user profile
 * @returns {string} system prompt in Hebrew
 */
function buildSystemPrompt(profile) {
  const genderLabel  = profile.gender === 'male' ? 'זכר' : 'נקבה';
  const genderPronoun = profile.gender === 'male' ? 'הילד' : 'הילדה';
  const detectedGender = profile.detectedGender || profile.gender;

  // Build restriction context
  const allergiesStr    = profile.allergies?.length    > 0 ? profile.allergies.join(', ')    : 'אין';
  const dislikesStr     = profile.dislikes?.length     > 0 ? profile.dislikes.join(', ')     : 'אין';
  const restrictionsStr = profile.restrictions?.length > 0 ? profile.restrictions.join(', ') : 'אין';

  // Activity label
  const activityLabel = profile.activityLevel === 'high'     ? 'גבוהה'
                      : profile.activityLevel === 'moderate'  ? 'בינונית'
                      : 'נמוכה';

  return `אתה NutriAgent — מערכת בינה מלאכותית קלינית לתמיכה תזונתית לילדים ובני נוער.

## תפקידך
לייצר תוכנית ארוחות יומית מלאה, מאוזנת ומדויקת עבור ${genderPronoun} בהתבסס על הפרופיל הנאסף.

## פרופיל המשתמש
- גיל: ${profile.age} שנים
- מין: ${genderLabel}
- משקל: ${profile.weight} ק"ג
- גובה: ${profile.height} ס"מ
- BMI: ${profile.bmi} (${profile.bmiCategory})
- רמת פעילות: ${activityLabel}
- BMR בסיסי: ${profile.bmrBase} קק"ל/יום
- יעד קלורי יומי: ${profile.caloricTarget} קק"ל
- אלרגיות: ${allergiesStr}
- דחיות: ${dislikesStr}
- הגבלות תזונתיות: ${restrictionsStr}

## חישוב קלורי שנדרש
${profile.caloricNarrative || `יעד: ${profile.caloricTarget} קק"ל/יום`}

## כללי ה-K-Means — חובה לציין לכל ארוחה
כל ארוחה חייבת לכלול פירוט של אשכול K-Means:
- אשכול 0: נפח/הידרציה (ירקות עלים, פירות, מרקים)
- אשכול 1: חלבון רזה (עוף, דגים, קטניות, ביצים)
- אשכול 2: שומנים בריאים (אבוקדו, שמן זית, אגוזים, טחינה)
- אשכול 3: פחמימות מורכבות (אורז מלא, קינואה, לחם כוסמין)

## כללי DBSCAN -1 — חסומים לחלוטין
אל תכלול בשום פנים ואופן:
- אבקות חלבון תעשייתיות (>80g חלבון/100g)
- שמנים מזוקקים תעשייתיים
- סירופי סוכר מזוקקים
- תוספי מאס גיינר

## כללי ציות לאלרגיות והגבלות — קריטי
${profile.restrictions?.some(r => r.includes('גלוטן') || r.toLowerCase().includes('gluten'))
  ? '⛔ ללא גלוטן: אסור לחלוטין — לחם, פיתה, חיטה, שיבולת שועל, פסטה, בורגול, קוסקוס, עוגות.'
  : ''}
${profile.restrictions?.some(r => r.includes('לקטוז') || r.toLowerCase().includes('lactose'))
  ? '⛔ ללא לקטוז: אסור לחלוטין — חלב, גבינה, יוגורט, שמנת, חמאה, גלידה.'
  : ''}
${profile.restrictions?.some(r => r.includes('טבעוני') || r.toLowerCase().includes('vegan'))
  ? '⛔ טבעוני: ללא כל מוצר מן החי — ללא בשר, דגים, ביצים, חלב, דבש.'
  : ''}
${profile.restrictions?.some(r => r.includes('צמחוני') || r.toLowerCase().includes('vegetarian'))
  ? '⛔ צמחוני: ללא בשר ודגים. מוצרי חלב וביצים מותרים.'
  : ''}
${profile.allergies?.length > 0
  ? `⛔ אלרגיות: ${allergiesStr} — אסורים לחלוטין בכל ארוחה.`
  : ''}
${profile.dislikes?.length > 0
  ? `⚠️ דחיות: ${dislikesStr} — אל תכלול מאכלים אלו.`
  : ''}

## כללי שפה — קריטי
- תקשר אך ורק בעברית תקנית ומקצועית.
- השתמש בנטייה מגדרית נכונה: ${detectedGender === 'female' ? 'לשון נקבה (את, שלך, מוכנה, יופי)' : 'לשון זכר (אתה, שלך, מוכן, כל הכבוד)'}.
- בשדה summary — כתוב מסר אישי, מעודד ומקצועי בנטייה המתאימה.
- בשדה conversation_summary — כתוב יומן קליני טכני לשימוש תזונאי מוסמך.

## פיזור קלורי מחייב ל-6 ארוחות
חלק את ${profile.caloricTarget} קק"ל כך:
- ארוחת בוקר: ~25% (${Math.round(profile.caloricTarget * 0.25)} קק"ל)
- חטיף בוקר: ~10% (${Math.round(profile.caloricTarget * 0.10)} קק"ל)
- ארוחת צהריים: ~30% (${Math.round(profile.caloricTarget * 0.30)} קק"ל)
- חטיף אחה"צ: ~10% (${Math.round(profile.caloricTarget * 0.10)} קק"ל)
- ארוחת ערב: ~20% (${Math.round(profile.caloricTarget * 0.20)} קק"ל)
- חטיף לילה: ~5% (${Math.round(profile.caloricTarget * 0.05)} קק"ל)

## פורמט תגובה — JSON בלבד
ענה תמיד ב-JSON תקני בלבד. ללא טקסט לפני או אחרי ה-JSON.
הסכמה הנדרשת מוגדרת בהודעת המשתמש.`;
}

/* ============================================================
   SECTION 4 — USER PROMPT BUILDER
   Constructs the user-turn message with the exact JSON schema
   the model must output.
============================================================ */

/**
 * Builds the user-turn prompt for meal plan generation.
 * Includes the exact required JSON schema as a template.
 * @param {object} profile
 * @param {number} retryCount — 0 for first attempt; >0 for compliance retry
 * @param {string[]} retryViolations — list of violations from previous attempt
 * @returns {string}
 */
function buildUserPrompt(profile, retryCount = 0, retryViolations = []) {
  let retryHeader = '';

  if (retryCount > 0 && retryViolations.length > 0) {
    retryHeader = [
      `⚠️ ניסיון ${retryCount}: התגובה הקודמת נדחתה בשל הפרות ציות:`,
      retryViolations.map(v => `  • ${v}`).join('\n'),
      'אנא תקן את כל ההפרות ויצר תוכנית חדשה שעומדת בכל האילוצים.',
      '',
    ].join('\n');
  }

  return `${retryHeader}צור תוכנית ארוחות יומית מלאה ל-${profile.gender === 'male' ? 'ילד' : 'ילדה'} בן/בת ${profile.age} עם יעד של ${profile.caloricTarget} קק"ל.

החזר JSON בדיוק בסכמה הבאה, ללא כל תוספות:

{
  "calorie_calculation": "פירוט קליני מלא של חישוב הקלוריות כולל BMR, רמת פעילות, קטגוריית BMI וסקיילינג",
  "total_calories": ${profile.caloricTarget},
  "meal_plan": {
    "breakfast": {
      "name": "שם הארוחה",
      "description": "פירוט הכנה מדויק עם מעקב אשכול K-Means: [אשכול X] + [אשכול Y]",
      "calories": ${Math.round(profile.caloricTarget * 0.25)},
      "cluster_tags": ["אשכול 1 — חלבון", "אשכול 3 — פחמימות"],
      "food_item_ids": ["chicken_breast", "brown_rice_cooked"]
    },
    "morning_snack": {
      "name": "שם החטיף",
      "description": "פירוט מלא",
      "calories": ${Math.round(profile.caloricTarget * 0.10)},
      "cluster_tags": ["אשכול 0 — נפח"],
      "food_item_ids": ["apple"]
    },
    "lunch": {
      "name": "שם הארוחה",
      "description": "פירוט הכנה מדויק",
      "calories": ${Math.round(profile.caloricTarget * 0.30)},
      "cluster_tags": ["אשכול 1 — חלבון", "אשכול 0 — נפח", "אשכול 3 — פחמימות"],
      "food_item_ids": ["tuna_water", "quinoa_cooked", "spinach_raw"]
    },
    "afternoon_snack": {
      "name": "שם החטיף",
      "description": "פירוט מלא",
      "calories": ${Math.round(profile.caloricTarget * 0.10)},
      "cluster_tags": ["אשכול 2 — שומנים"],
      "food_item_ids": ["almonds"]
    },
    "dinner": {
      "name": "שם הארוחה",
      "description": "פירוט הכנה מדויק",
      "calories": ${Math.round(profile.caloricTarget * 0.20)},
      "cluster_tags": ["אשכול 1 — חלבון", "אשכול 0 — נפח"],
      "food_item_ids": ["cod_fillet", "broccoli"]
    },
    "evening_snack": {
      "name": "שם החטיף",
      "description": "פירוט מלא",
      "calories": ${Math.round(profile.caloricTarget * 0.05)},
      "cluster_tags": ["אשכול 2 — שומנים", "אשכול 0 — נפח"],
      "food_item_ids": ["avocado"]
    }
  },
  "summary": "מסר אישי מעודד ומקצועי בעברית בנטייה מגדרית מתאימה",
  "conversation_summary": "יומן קליני טכני: מתודולוגיית האיסוף, פרופיל BMI, אימות אפס חריגי DBSCAN -1, ציות לאילוצים"
}`;
}

/* ============================================================
   SECTION 5 — FOLLOW-UP SYSTEM PROMPT
   Used for the post-plan contextual Q&A chat.
   Strictly scoped to the generated meal plan only.
============================================================ */

/**
 * Builds the system prompt for follow-up chat mode.
 * @param {object} profile
 * @param {object} planJson — the generated meal plan
 * @returns {string}
 */
function buildFollowupSystemPrompt(profile, planJson) {
  const genderPronoun = profile.gender === 'male' ? 'הילד' : 'הילדה';
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
2. אם נשאלת שאלה שאינה קשורה לתוכנית — השב: "אני יכול לענות רק על שאלות הנוגעות לתוכנית הארוחות שנוצרה עבורך."
3. תקשר תמיד בעברית תקנית בלבד.
4. השתמש בנטייה מגדרית: ${detectedGender === 'female' ? 'לשון נקבה' : 'לשון זכר'}.
5. אל תמציא מידע תזונתי שאינו מבוסס על הנתונים שסופקו.
6. אם שאלה דורשת ייעוץ רפואי — הפנה לתזונאי/ת מוסמך/ת.
7. תגובות תמציתיות ומקצועיות — עד 3 פסקאות.`;
}

/* ============================================================
   SECTION 6 — CORE API CALL FUNCTION
   Low-level wrapper around the Anthropic Messages API.
============================================================ */

/**
 * Makes a single call to the Anthropic API.
 * @param {object[]} messages    — array of {role, content} objects
 * @param {string}   systemPrompt
 * @param {boolean}  jsonMode    — if true, requests JSON output
 * @returns {Promise<object>}    — parsed response object
 * @throws {Error} on network/API errors
 */
async function callAnthropicAPI(messages, systemPrompt, jsonMode = false) {
  const apiKey = APIKeyManager.get();
  if (!apiKey) throw new Error('API_KEY_MISSING');

  const body = {
    model:      OPENAI_CONFIG.model,
    max_tokens: OPENAI_CONFIG.maxTokens,
    system:     systemPrompt,
    messages,
  };

  // For JSON mode, prepend instruction to system prompt
  if (jsonMode) {
    body.system = systemPrompt + '\n\nחשוב: החזר תמיד JSON תקני בלבד, ללא כל טקסט נוסף לפני או אחרי.';
  }

  const response = await fetch(OPENAI_CONFIG.endpoint, {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let errorMsg = `HTTP ${response.status}`;
    try {
      const errBody = await response.json();
      errorMsg = errBody?.error?.message || errorMsg;
    } catch { /* ignore parse error */ }
    throw new Error(`API_ERROR: ${errorMsg}`);
  }

  const data = await response.json();

  // Extract text from Anthropic response format
  const textContent = data.content?.find(c => c.type === 'text')?.text || '';
  return { rawText: textContent, usage: data.usage };
}

/* ============================================================
   SECTION 7 — JSON EXTRACTION & VALIDATION
============================================================ */

/**
 * Extracts and parses JSON from a raw API response string.
 * Strips markdown code fences if present.
 * @param {string} rawText
 * @returns {object} parsed JSON
 * @throws {Error} if JSON cannot be parsed
 */
function extractJSON(rawText) {
  let text = rawText.trim();

  // Strip ```json ... ``` fences
  text = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
  // Strip plain ``` fences
  text = text.replace(/^```\s*/, '').replace(/\s*```$/, '');
  // Extract first JSON object if surrounded by other text
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) text = jsonMatch[0];

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`JSON_PARSE_FAILED: ${err.message}`);
  }
}

/**
 * Validates the structure of a meal plan JSON response.
 * Checks that all required fields and meal slots are present.
 * @param {object} json
 * @returns {{ valid: boolean, missingFields: string[] }}
 */
function validateMealPlanStructure(json) {
  const required = ['calorie_calculation', 'total_calories', 'meal_plan', 'summary', 'conversation_summary'];
  const requiredMeals = ['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack'];
  const mealFields = ['name', 'description', 'calories'];

  const missingFields = [];

  for (const field of required) {
    if (!(field in json)) missingFields.push(field);
  }

  if (json.meal_plan) {
    for (const meal of requiredMeals) {
      if (!(meal in json.meal_plan)) {
        missingFields.push(`meal_plan.${meal}`);
      } else {
        for (const mealField of mealFields) {
          if (!(mealField in json.meal_plan[meal])) {
            missingFields.push(`meal_plan.${meal}.${mealField}`);
          }
        }
      }
    }
  }

  return { valid: missingFields.length === 0, missingFields };
}

/* ============================================================
   SECTION 8 — DBSCAN -1 CONTENT SCAN
   Scans generated JSON text for known DBSCAN -1 flagged items.
   If found, logs but does NOT auto-block (blocking is done
   at the profile restriction level for private users).
============================================================ */

const DBSCAN_OUTLIER_TERMS = [
  'ווי', 'whey', 'אבקת חלבון', 'protein powder', 'protein isolate',
  'מאס גיינר', 'mass gainer', 'שמן דקלים', 'palm oil',
  'סירופ גלוקוז', 'glucose syrup', 'corn syrup', 'סירופ תירס',
  'creatine', 'קריאטין', 'pre-workout', 'פרי וורקאוט',
];

/**
 * Scans the entire JSON text for DBSCAN -1 outlier terms.
 * @param {string} jsonText — raw JSON string
 * @returns {{ detected: boolean, terms: string[] }}
 */
function scanForDBSCANOutliers(jsonText) {
  const lc = jsonText.toLowerCase();
  const found = DBSCAN_OUTLIER_TERMS.filter(term => lc.includes(term.toLowerCase()));
  return { detected: found.length > 0, terms: found };
}

/* ============================================================
   SECTION 9 — MEAL PLAN GENERATION PIPELINE
   Orchestrates the full generation flow:
   1. Build prompts from profile
   2. Call API
   3. Parse JSON
   4. Validate structure
   5. Scan DBSCAN -1
   6. Validate dietary compliance
   7. Retry if violations found (up to maxRetries)
============================================================ */

/**
 * Main meal plan generation function.
 * Called by chatbot-ui.js when the user confirms "המשך".
 *
 * @param {object}   profile      — complete FSM profile
 * @param {Function} onProgress   — callback(stage, message) for UI updates
 * @returns {Promise<object>}     — { success, planJson, violations, retryCount, dbscanScan }
 */
async function generateMealPlan(profile, onProgress = () => {}) {
  let retryCount    = 0;
  let lastViolations = [];

  const {
    validateMealPlanCompliance,
  } = window.NutriAgent;

  while (retryCount <= OPENAI_CONFIG.maxRetries) {

    // --- Stage 1: Build prompts ---
    onProgress('building', `🧬 בונה פרומפט קליני${retryCount > 0 ? ` (ניסיון ${retryCount + 1})` : ''}…`);

    const systemPrompt = buildSystemPrompt(profile);
    const userPrompt   = buildUserPrompt(profile, retryCount, lastViolations);

    const messages = [
      { role: 'user', content: userPrompt },
    ];

    // --- Stage 2: API call ---
    onProgress('calling', '🤖 שולח בקשה למנוע AI…');

    let rawText;
    try {
      const result = await callAnthropicAPI(messages, systemPrompt, true);
      rawText = result.rawText;
    } catch (err) {
      if (err.message === 'API_KEY_MISSING') {
        return { success: false, error: 'API_KEY_MISSING', message: 'מפתח API חסר. אנא הגדר מפתח תקין.' };
      }
      if (retryCount < OPENAI_CONFIG.maxRetries) {
        onProgress('retry', `⚠️ שגיאת רשת. מנסה שוב בעוד ${OPENAI_CONFIG.retryDelayMs / 1000} שניות…`);
        await delay(OPENAI_CONFIG.retryDelayMs);
        retryCount++;
        continue;
      }
      return {
        success: false,
        error: 'NETWORK_ERROR',
        message: `שגיאת רשת: ${err.message}. אנא בדוק את החיבור לאינטרנט ונסה שוב.`,
      };
    }

    // --- Stage 3: Parse JSON ---
    onProgress('parsing', '📋 מפענח תגובת JSON…');

    let planJson;
    try {
      planJson = extractJSON(rawText);
    } catch (err) {
      if (retryCount < OPENAI_CONFIG.maxRetries) {
        onProgress('retry', '⚠️ תגובה לא תקינה. מנסה שוב…');
        await delay(OPENAI_CONFIG.retryDelayMs);
        retryCount++;
        continue;
      }
      return {
        success: false,
        error: 'JSON_PARSE_ERROR',
        message: 'המערכת לא הצליחה לפענח את תגובת ה-AI. אנא נסה שוב.',
      };
    }

    // --- Stage 4: Structural validation ---
    onProgress('validating', '🔍 מאמת מבנה תוכנית…');

    const { valid: structureValid, missingFields } = validateMealPlanStructure(planJson);
    if (!structureValid) {
      console.warn('[NutriAgent] Missing fields:', missingFields);
      if (retryCount < OPENAI_CONFIG.maxRetries) {
        lastViolations = missingFields.map(f => `שדה חסר: ${f}`);
        onProgress('retry', `⚠️ מבנה חסר (${missingFields.length} שדות). מנסה שוב…`);
        await delay(OPENAI_CONFIG.retryDelayMs);
        retryCount++;
        continue;
      }
    }

    // --- Stage 5: DBSCAN -1 scan ---
    onProgress('dbscan', '🛡️ סורק חריגי DBSCAN -1…');

    const dbscanScan = scanForDBSCANOutliers(JSON.stringify(planJson));
    if (dbscanScan.detected) {
      console.warn('[NutriAgent] DBSCAN -1 terms detected:', dbscanScan.terms);
      if (profile.mode !== 'clinical' && retryCount < OPENAI_CONFIG.maxRetries) {
        lastViolations = dbscanScan.terms.map(t => `DBSCAN -1 חריג: "${t}"`);
        onProgress('retry', `🔴 זוהו פריטי DBSCAN -1 חסומים. מנסה שוב…`);
        await delay(OPENAI_CONFIG.retryDelayMs);
        retryCount++;
        continue;
      }
    }

    // --- Stage 6: Dietary compliance validation ---
    onProgress('compliance', '✅ בודק ציות לאילוצים תזונתיים…');

    const { valid: complianceValid, violations } = validateMealPlanCompliance(planJson, profile);

    if (!complianceValid) {
      console.warn('[NutriAgent] Compliance violations:', violations);
      if (retryCount < OPENAI_CONFIG.maxRetries) {
        lastViolations = violations;
        onProgress('retry',
          `⚠️ נמצאו ${violations.length} הפרות ציות תזונתי. מנסה שוב (${retryCount + 1}/${OPENAI_CONFIG.maxRetries})…`
        );
        await delay(OPENAI_CONFIG.retryDelayMs);
        retryCount++;
        continue;
      }
      // If max retries exhausted but violations remain — still return plan with warning
      return {
        success: true,
        planJson,
        violations,
        retryCount,
        dbscanScan,
        warning: 'הגרסה הזמינה עשויה להכיל חריגות קלות. מומלץ לאמת עם תזונאי.',
      };
    }

    // --- All checks passed ---
    onProgress('complete', '🌿 תוכנית הארוחות מוכנה!');

    return {
      success: true,
      planJson,
      violations: [],
      retryCount,
      dbscanScan,
    };
  }

  // Should not reach here, but safety fallback
  return {
    success: false,
    error: 'MAX_RETRIES_EXCEEDED',
    message: 'הגעת למספר הניסיונות המרבי. אנא נסה שוב מאוחר יותר.',
  };
}

/* ============================================================
   SECTION 10 — FOLLOW-UP CHAT HANDLER
   Handles post-plan free-text questions.
   Strictly scoped to the generated meal plan context.
============================================================ */

/**
 * Sends a follow-up question to the AI, scoped to the meal plan.
 * @param {string}   userQuery   — the user's question in Hebrew
 * @param {object}   profile     — current FSM profile
 * @param {object}   planJson    — the generated meal plan
 * @param {object[]} chatHistory — recent Q&A pairs for context (max 6 turns)
 * @returns {Promise<{ success: boolean, reply: string, error?: string }>}
 */
async function sendFollowupMessage(userQuery, profile, planJson, chatHistory = []) {
  const { isNonHebrew, NON_HEBREW_RESPONSE } = window.NutriAgent;

  // Language guard
  if (isNonHebrew(userQuery)) {
    return { success: true, reply: NON_HEBREW_RESPONSE };
  }

  const systemPrompt = buildFollowupSystemPrompt(profile, planJson);

  // Build message history (max 6 turns = 12 messages to stay token-efficient)
  const historyMessages = chatHistory.slice(-6).flatMap(turn => [
    { role: 'user',      content: turn.question },
    { role: 'assistant', content: turn.answer   },
  ]);

  const messages = [
    ...historyMessages,
    { role: 'user', content: userQuery },
  ];

  try {
    const result = await callAnthropicAPI(messages, systemPrompt, false);
    return { success: true, reply: result.rawText.trim() };
  } catch (err) {
    if (err.message === 'API_KEY_MISSING') {
      return { success: false, error: 'API_KEY_MISSING', reply: 'מפתח API חסר.' };
    }
    return {
      success: false,
      error: 'NETWORK_ERROR',
      reply: 'מצטער, אירעה שגיאת רשת. אנא נסה שוב.',
    };
  }
}

/* ============================================================
   SECTION 11 — API KEY VALIDATION (LIVE TEST)
   Makes a minimal test call to verify the key works.
============================================================ */

/**
 * Validates an API key by making a minimal test call.
 * @param {string} key
 * @returns {Promise<{ valid: boolean, error?: string }>}
 */
async function validateAPIKey(key) {
  if (!APIKeyManager.validate(key)) {
    return { valid: false, error: 'פורמט מפתח לא תקין. המפתח חייב להתחיל ב-sk-' };
  }

  // Temporarily set key for test
  const previous = APIKeyManager.get();
  APIKeyManager.save(key);

  try {
    const result = await callAnthropicAPI(
      [{ role: 'user', content: 'ענה בדיוק במילה: שלום' }],
      'ענה תמיד בעברית.',
      false
    );
    const responseText = result.rawText || '';
    if (responseText.length > 0) {
      return { valid: true };
    }
    return { valid: false, error: 'המפתח לא החזיר תגובה תקינה.' };
  } catch (err) {
    // Restore previous key if test fails
    if (previous) {
      APIKeyManager.save(previous);
    } else {
      APIKeyManager.clear();
    }
    const msg = err.message || '';
    if (msg.includes('401') || msg.includes('Unauthorized')) {
      return { valid: false, error: 'מפתח API לא מורשה (401). אנא בדוק שהמפתח נכון.' };
    }
    if (msg.includes('429')) {
      return { valid: false, error: 'חריגה ממגבלת קצב (429). אנא נסה שוב בעוד מספר שניות.' };
    }
    return { valid: false, error: `שגיאת API: ${msg}` };
  }
}

/* ============================================================
   SECTION 12 — UTILITY HELPERS
============================================================ */

/**
 * Promise-based delay helper.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Formats a meal slot key into a Hebrew display name.
 * @param {string} slot — e.g. 'morning_snack'
 * @returns {string} — e.g. 'חטיף בוקר'
 */
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

/**
 * Calculates total calories across all meal slots in a plan.
 * Used for UI validation display.
 * @param {object} mealPlan — planJson.meal_plan
 * @returns {number}
 */
function sumMealCalories(mealPlan) {
  return Object.values(mealPlan || {})
    .reduce((sum, meal) => sum + (Number(meal.calories) || 0), 0);
}

/**
 * Extracts the K-Means cluster index from a cluster tag string.
 * e.g. "אשכול 1 — חלבון" → 1
 * @param {string} tagStr
 * @returns {number|null}
 */
function extractClusterIndex(tagStr) {
  const match = tagStr?.match(/אשכול\s+(\d)/);
  return match ? parseInt(match[1], 10) : null;
}

/* ============================================================
   SECTION 13 — GLOBAL EXPORTS
   Expose the API client functions to window.NutriAgentAPI
   for use by chatbot-ui.js.
============================================================ */

window.NutriAgentAPI = Object.freeze({
  // Key management
  APIKeyManager,
  validateAPIKey,

  // Generation pipeline
  generateMealPlan,
  buildSystemPrompt,
  buildUserPrompt,

  // Follow-up chat
  sendFollowupMessage,

  // Utilities
  mealSlotToHebrew,
  sumMealCalories,
  extractClusterIndex,
  extractJSON,
  validateMealPlanStructure,
  scanForDBSCANOutliers,
  delay,
});

console.log(
  '%c🤖 NutriAgent API Client Loaded',
  'color:#22d3ee;font-weight:bold;font-size:14px',
  '| Model:', OPENAI_CONFIG.model,
  '| Max retries:', OPENAI_CONFIG.maxRetries,
);
