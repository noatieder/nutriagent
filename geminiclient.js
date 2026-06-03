/**
 * ============================================================
 * NUTRIAGENT — geminiclient.js
 * Google Gemini API Client & Prompt Engineering Engine
 *
 * Responsibilities:
 *  - API key management (sessionStorage, never transmitted elsewhere)
 *  - Core sendGeminiRequest() with X-goog-api-key header auth
 *  - Prompt compilation from FSM profile data
 *  - Strict JSON schema enforcement via responseMimeType + generationConfig
 *  - Post-generation DBSCAN -1 content scan
 *  - Dietary compliance validation + automatic retry on violation
 *  - Follow-up contextual chat (scoped to generated plan)
 *  - Off-domain request detection via [OFF_DOMAIN] marker (TC-06)
 *  - Hebrew gender morphology in all system prompts
 *
 * Model: gemini-flash-latest
 * Auth:  X-goog-api-key header (per Google AI REST spec)
 * ============================================================
 */

'use strict';

/* ============================================================
   SECTION 1 — CONFIGURATION CONSTANTS
============================================================ */

const GEMINI_CONFIG = Object.freeze({
  model:        'gemini-2.5-flash',
  baseUrl:      'https://generativelanguage.googleapis.com/v1beta/models',
  maxTokens:    65536,
  temperature:  0.4,          // Low variance for clinical consistency
  maxRetries:   3,             // Max compliance retry attempts
  retryDelayMs: 800,           // Delay between retry attempts
  storageKey:   'GEMINI_API_KEY',  // sessionStorage key (cleared on tab close)
});

/* ============================================================
   SECTION 2 — API KEY MANAGEMENT
   Key stored only in sessionStorage (cleared when tab closes).
   Never logged, never sent anywhere except via X-goog-api-key header.
============================================================ */

const APIKeyManager = Object.freeze({

  get() {
    try {
      return sessionStorage.getItem(GEMINI_CONFIG.storageKey) || null;
    } catch {
      return null;
    }
  },

  /**
   * Gemini keys are long alphanumeric strings (no fixed prefix).
   * Accept any key longer than 20 characters.
   */
  validate(key) {
    if (!key || typeof key !== 'string') return false;
    return key.trim().length > 20;
  },

  save(key) {
    if (!this.validate(key)) return false;
    try {
      sessionStorage.setItem(GEMINI_CONFIG.storageKey, key.trim());
      return true;
    } catch {
      return false;
    }
  },

  clear() {
    try {
      sessionStorage.removeItem(GEMINI_CONFIG.storageKey);
    } catch { /* silent */ }
  },

  isSet() {
    return this.validate(this.get());
  },
});

/* ============================================================
   SECTION 3 — SYSTEM PROMPT BUILDER
============================================================ */

function buildSystemPrompt(profile) {
  const genderLabel   = profile.gender === 'male' ? 'זכר' : 'נקבה';
  const genderPronoun = profile.gender === 'male' ? 'המשתמש' : 'המשתמשת';
  const detectedGender = profile.detectedGender || profile.gender;

  const allergiesStr    = profile.allergies?.length    > 0 ? profile.allergies.join(', ')    : 'אין';
  const dislikesStr     = profile.dislikes?.length     > 0 ? profile.dislikes.join(', ')     : 'אין';
  const restrictionsStr = profile.restrictions?.length > 0 ? profile.restrictions.join(', ') : 'אין';

  const activityLabel = profile.activityLevel === 'high'     ? 'גבוהה'
                      : profile.activityLevel === 'moderate'  ? 'בינונית'
                      : 'נמוכה';

  return `אתה NutriAgent — מערכת בינה מלאכותית קלינית לתמיכה תזונתית למשתמשים בוגרים ודיאטניות קליניות.

## תפקידך
לייצר תוכנית ארוחות יומית מלאה, מאוזנת ומדויקת עבור ${genderPronoun} בהתבסס על הפרופיל הנאסף.

## פרופיל המשתמש
- גיל: ${profile.age} שנים
- מין: ${genderLabel}
- משקל: ${profile.weight} ק"ג
- גובה: ${profile.height} ס"מ
- BMI: ${profile.bmi} (${profile.bmiCategory})
- רמת פעילות: ${activityLabel}
- BMR (Mifflin-St Jeor): ${profile.bmrBase} קק"ל/יום
- יעד קלורי יומי: ${profile.caloricTarget} קק"ל
- אלרגיות: ${allergiesStr}
- דחיות: ${dislikesStr}
- הגבלות תזונתיות: ${restrictionsStr}

## חישוב קלורי (Mifflin-St Jeor)
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
- שמנים מזוקקים תעשייתיים (שמן דקלים, שומן צמחי מוקשה)
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
- השתמש בנטייה מגדרית נכונה: ${detectedGender === 'female' ? 'לשון נקבה (את, שלך, מוכנה)' : 'לשון זכר (אתה, שלך, מוכן)'}.
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
============================================================ */

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

  return `${retryHeader}צור תוכנית ארוחות יומית מלאה למשתמש/ת בגיל ${profile.age} עם יעד של ${profile.caloricTarget} קק"ל.

החזר JSON בדיוק בסכמה הבאה, ללא כל תוספות:

{
  "calorie_calculation": "פירוט קליני מלא של חישוב הקלוריות כולל BMR (Mifflin-St Jeor), רמת פעילות, קטגוריית BMI וסקיילינג",
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
  "conversation_summary": "יומן קליני טכני: מתודולוגיית האיסוף, פרופיל BMI, Mifflin-St Jeor BMR, אימות אפס חריגי DBSCAN -1, ציות לאילוצים"
}`;
}

/* ============================================================
   SECTION 5 — FOLLOW-UP SYSTEM PROMPT
   Off-domain requests must return a marked error string so the
   UI can display a styled error bubble (TC-06 failure scenario).
============================================================ */

function buildFollowupSystemPrompt(profile, planJson) {
  const genderPronoun  = profile.gender === 'male' ? 'המשתמש' : 'המשתמשת';
  const detectedGender = profile.detectedGender || profile.gender;

  const mealSummary = Object.entries(planJson.meal_plan || {})
    .map(([slot, meal]) => `• ${slot}: ${meal.name} (${meal.calories} קק"ל)`)
    .join('\n');

  return `אתה NutriAgent — עוזר תזונתי קליני המתמחה בתוכנית הארוחות שנוצרה עבור ${genderPronoun}.

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
6. אם שאלה דורשת ייעוץ רפואי — הפנה לתזונאי/ת מוסמך/ת.
7. תגובות תמציתיות ומקצועיות — עד 3 פסקאות.`;
}

/* ============================================================
   SECTION 6 — CORE API FUNCTION: sendGeminiRequest
   Uses the Gemini REST endpoint with X-goog-api-key header auth.
   - systemPrompt  → system_instruction block
   - conversationHistory → contents array (role: user/model)
   - isJsonOutput  → enables responseMimeType: application/json
   Returns: parsed JS object (isJsonOutput=true) or raw string (false).
   Throws on API error, network failure, or JSON parse failure.
============================================================ */

async function sendGeminiRequest(systemPrompt, conversationHistory, isJsonOutput = true) {
  const apiKey = APIKeyManager.get();
  if (!apiKey) throw new Error('API_KEY_MISSING');

  const url = `${GEMINI_CONFIG.baseUrl}/${GEMINI_CONFIG.model}:generateContent`;

  // Map conversationHistory [{role, content}] → Gemini contents format
  const contents = (conversationHistory || []).map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const body = {
    system_instruction: {
      parts: [{ text: systemPrompt }],
    },
    contents,
    generationConfig: {
      temperature: GEMINI_CONFIG.temperature,
      ...(isJsonOutput ? { responseMimeType: 'application/json' } : {}),
    },
  };

  const L = window.NutriLogger;
  L?.info('API', `→ POST ${GEMINI_CONFIG.model}`, { isJsonOutput, messageCount: (conversationHistory||[]).length });

  let response;
  try {
    response = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type':   'application/json',
        'X-goog-api-key': apiKey,
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
      L?.error('API', `API error body`, errBody);
    } catch { /* ignore parse error on error body */ }

    // 429 — extract retry-after seconds and surface as a distinct error type
    if (response.status === 429) {
      const retryMatch = errorMsg.match(/retry in ([\d.]+)s/i);
      const retrySeconds = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : 60;
      throw new Error(`QUOTA_EXCEEDED:${retrySeconds}`);
    }

    throw new Error(`API_ERROR: ${errorMsg}`);
  }

  const data = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

  L?.debug('API', `Raw response length: ${rawText.length} chars | first 500:`, rawText.slice(0, 500));
  L?.debug('API', `Full candidates structure`, data?.candidates?.[0]);

  if (!isJsonOutput) {
    return rawText;
  }

  // JSON mode: parse and return the object directly
  try {
    // Strip markdown fences if Gemini wraps output despite responseMimeType
    let clean = rawText.trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/,      '')
      .replace(/\s*```$/,      '');
    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    if (jsonMatch) clean = jsonMatch[0];
    const parsed = JSON.parse(clean);
    L?.info('API', 'JSON parsed OK', { keys: Object.keys(parsed) });
    return parsed;
  } catch (parseErr) {
    L?.error('API', `JSON parse failed`, { error: parseErr.message, raw: rawText.slice(0, 500) });
    throw new Error(`JSON_PARSE_FAILED: ${parseErr.message} | raw: ${rawText.slice(0, 120)}`);
  }
}

/* ============================================================
   SECTION 7 — JSON STRUCTURE VALIDATION
   (operates on already-parsed JS objects from sendGeminiRequest)
============================================================ */

function validateMealPlanStructure(json) {
  const required      = ['calorie_calculation', 'total_calories', 'meal_plan', 'summary', 'conversation_summary'];
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
============================================================ */

const DBSCAN_OUTLIER_TERMS = [
  'ווי', 'whey', 'אבקת חלבון', 'protein powder', 'protein isolate',
  'מאס גיינר', 'mass gainer', 'שמן דקלים', 'palm oil',
  'סירופ גלוקוז', 'glucose syrup', 'corn syrup', 'סירופ תירס',
  'creatine', 'קריאטין', 'pre-workout', 'פרי וורקאוט',
];

function scanForDBSCANOutliers(jsonText) {
  const lc    = jsonText.toLowerCase();
  const found = DBSCAN_OUTLIER_TERMS.filter(term => lc.includes(term.toLowerCase()));
  return { detected: found.length > 0, terms: found };
}

/* ============================================================
   SECTION 9 — MEAL PLAN GENERATION PIPELINE
   Calls sendGeminiRequest with isJsonOutput=true — receives a
   parsed JS object directly (no extractJSON step needed).
============================================================ */

async function generateMealPlan(profile, onProgress = () => {}) {
  let retryCount     = 0;
  let lastViolations = [];

  const { validateMealPlanCompliance } = window.NutriAgent;

  while (retryCount <= GEMINI_CONFIG.maxRetries) {

    onProgress('building', `🧬 בונה פרומפט קליני${retryCount > 0 ? ` (ניסיון ${retryCount + 1})` : ''}…`);

    const systemPrompt = buildSystemPrompt(profile);
    const userPrompt   = buildUserPrompt(profile, retryCount, lastViolations);
    const messages     = [{ role: 'user', content: userPrompt }];

    onProgress('calling', '🤖 שולח בקשה ל-Gemini Flash…');

    let planJson;
    try {
      // isJsonOutput=true → sendGeminiRequest returns parsed object directly
      planJson = await sendGeminiRequest(systemPrompt, messages, true);
    } catch (err) {
      if (err.message === 'API_KEY_MISSING') {
        return { success: false, error: 'API_KEY_MISSING', message: 'מפתח Gemini API חסר. אנא הגדר מפתח תקין בהגדרות.' };
      }
      // 429 Quota — never retry, surface the wait time immediately
      if (err.message.startsWith('QUOTA_EXCEEDED')) {
        const seconds = parseInt(err.message.split(':')[1], 10) || 60;
        return {
          success: false,
          error:   'QUOTA_EXCEEDED',
          retryAfterSeconds: seconds,
          message: `⏳ חריגה ממגבלת קצב Gemini API.\nאנא המתן **${seconds} שניות** ונסה שוב.`,
        };
      }
      if (err.message.startsWith('JSON_PARSE_FAILED')) {
        if (retryCount < GEMINI_CONFIG.maxRetries) {
          onProgress('retry', '⚠️ תגובה לא תקינה. מנסה שוב…');
          await delay(GEMINI_CONFIG.retryDelayMs);
          retryCount++;
          continue;
        }
        return { success: false, error: 'JSON_PARSE_ERROR', message: 'המערכת לא הצליחה לפענח את תגובת ה-AI. אנא נסה שוב.' };
      }
      // Network / API error
      if (retryCount < GEMINI_CONFIG.maxRetries) {
        onProgress('retry', `⚠️ שגיאת רשת. מנסה שוב בעוד ${GEMINI_CONFIG.retryDelayMs / 1000} שניות…`);
        await delay(GEMINI_CONFIG.retryDelayMs);
        retryCount++;
        continue;
      }
      return { success: false, error: 'NETWORK_ERROR', message: `שגיאת רשת: ${err.message}. אנא בדוק את החיבור לאינטרנט.` };
    }

    onProgress('validating', '🔍 מאמת מבנה תוכנית…');

    const { valid: structureValid, missingFields } = validateMealPlanStructure(planJson);
    if (!structureValid) {
      if (retryCount < GEMINI_CONFIG.maxRetries) {
        lastViolations = missingFields.map(f => `שדה חסר: ${f}`);
        onProgress('retry', `⚠️ מבנה חסר (${missingFields.length} שדות). מנסה שוב…`);
        await delay(GEMINI_CONFIG.retryDelayMs);
        retryCount++;
        continue;
      }
    }

    onProgress('dbscan', '🛡️ סורק חריגי DBSCAN -1…');

    const dbscanScan = scanForDBSCANOutliers(JSON.stringify(planJson));
    if (dbscanScan.detected && profile.mode !== 'clinical' && retryCount < GEMINI_CONFIG.maxRetries) {
      lastViolations = dbscanScan.terms.map(t => `DBSCAN -1 חריג: "${t}"`);
      onProgress('retry', '🔴 זוהו פריטי DBSCAN -1 חסומים. מנסה שוב…');
      await delay(GEMINI_CONFIG.retryDelayMs);
      retryCount++;
      continue;
    }

    onProgress('compliance', '✅ בודק ציות לאילוצים תזונתיים…');

    const { valid: complianceValid, violations } = validateMealPlanCompliance(planJson, profile);

    if (!complianceValid) {
      if (retryCount < GEMINI_CONFIG.maxRetries) {
        lastViolations = violations;
        onProgress('retry', `⚠️ נמצאו ${violations.length} הפרות ציות תזונתי. מנסה שוב (${retryCount + 1}/${GEMINI_CONFIG.maxRetries})…`);
        await delay(GEMINI_CONFIG.retryDelayMs);
        retryCount++;
        continue;
      }
      return {
        success: true,
        planJson,
        violations,
        retryCount,
        dbscanScan,
        warning: 'הגרסה הזמינה עשויה להכיל חריגות קלות. מומלץ לאמת עם תזונאי.',
      };
    }

    onProgress('complete', '🌿 תוכנית הארוחות מוכנה!');
    return { success: true, planJson, violations: [], retryCount, dbscanScan };
  }

  return { success: false, error: 'MAX_RETRIES_EXCEEDED', message: 'הגעת למספר הניסיונות המרבי. אנא נסה שוב.' };
}

/* ============================================================
   SECTION 10 — FOLLOW-UP CHAT HANDLER
   sendGeminiRequest with isJsonOutput=false returns raw text.
   TC-06: [OFF_DOMAIN] marker triggers styled error bubble in UI.
============================================================ */

async function sendFollowupMessage(userQuery, profile, planJson, chatHistory = []) {
  const { isNonHebrew, NON_HEBREW_RESPONSE } = window.NutriAgent;

  if (isNonHebrew(userQuery)) {
    return { success: true, reply: NON_HEBREW_RESPONSE };
  }

  const systemPrompt = buildFollowupSystemPrompt(profile, planJson);

  // Build conversation history: last 6 turns flattened to user/model pairs
  const historyMessages = chatHistory.slice(-6).flatMap(turn => [
    { role: 'user',      content: turn.question },
    { role: 'assistant', content: turn.answer   },
  ]);

  const messages = [
    ...historyMessages,
    { role: 'user', content: userQuery },
  ];

  try {
    // isJsonOutput=false → returns raw text string
    const reply = (await sendGeminiRequest(systemPrompt, messages, false)).trim();

    // TC-06: Detect off-domain marker injected by system prompt instruction
    if (reply.startsWith('[OFF_DOMAIN]')) {
      return {
        success:     true,
        reply:       reply.replace('[OFF_DOMAIN]', '').trim(),
        isOffDomain: true,
      };
    }

    return { success: true, reply };
  } catch (err) {
    if (err.message === 'API_KEY_MISSING') {
      return { success: false, error: 'API_KEY_MISSING', reply: 'מפתח Gemini API חסר.' };
    }
    if (err.message.startsWith('QUOTA_EXCEEDED')) {
      const seconds = parseInt(err.message.split(':')[1], 10) || 60;
      return {
        success: true,   // show as a styled message, not a crash
        reply: `⏳ **חריגה ממגבלת קצב (429)**\n\nGemini API מוגבל כרגע. אנא המתן **${seconds} שניות** ונסה לשאול שוב.`,
        isQuotaError: true,
      };
    }
    return { success: false, error: 'NETWORK_ERROR', reply: 'מצטער, אירעה שגיאת רשת. אנא נסה שוב.' };
  }
}

/* ============================================================
   SECTION 11 — API KEY LIVE VALIDATION
   Performs a minimal real API call to confirm the key works.
============================================================ */

async function validateAPIKey(key) {
  if (!APIKeyManager.validate(key)) {
    return { valid: false, error: 'פורמט מפתח לא תקין. המפתח חייב להיות ארוך מ-20 תווים.' };
  }

  const previous = APIKeyManager.get();
  APIKeyManager.save(key);

  try {
    const reply = await sendGeminiRequest(
      'ענה תמיד בעברית.',
      [{ role: 'user', content: 'ענה בדיוק במילה: שלום' }],
      false
    );
    if (reply?.length > 0) {
      return { valid: true };
    }
    return { valid: false, error: 'המפתח לא החזיר תגובה תקינה.' };
  } catch (err) {
    // Restore previous key on failure
    if (previous) {
      APIKeyManager.save(previous);
    } else {
      APIKeyManager.clear();
    }
    const msg = err.message || '';
    if (msg.includes('400') || msg.includes('API key not valid')) {
      return { valid: false, error: 'מפתח Gemini API לא תקין. אנא בדוק שהמפתח נכון.' };
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
   Same interface as openaiclient.js so chatbot-ui.js requires
   zero changes to its API calls.
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
  scanForDBSCANOutliers,
  delay,
});

console.log(
  '%c🤖 NutriAgent Gemini Client Loaded',
  'color:#22d3ee;font-weight:bold;font-size:14px',
  '| Model:', GEMINI_CONFIG.model,
  '| Auth: X-goog-api-key header',
  '| Storage: sessionStorage',
);
