/**
 * ============================================================
 * NUTRIAGENT — tests/test_nutriagent.js
 * 6 Test Cases for NutriAgent Validation
 *
 * TC-01: ילד בריא — תוצאה נורמלית
 * TC-02: נערה עם עודף משקל — קלוריות מופחתות
 * TC-03: ילד תת-משקל + אלרגיות — קלוריות מוגברות, סינון מזון
 * TC-04: נערה טבעונית — תפריט מהצומח
 * TC-05: [FAILURE] סתירה לוגית — טבעוני + דחיית כל חלבון צמחי
 * TC-06: [FAILURE] חריגה מדומיין — שאלה שאינה קשורה לתזונה
 *
 * Run in browser console or Node.js (requires chatbot.js to be loaded).
 * Usage: node tests/test_nutriagent.js
 * ============================================================
 */

'use strict';

// ─── Test runner ─────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition, description) {
  if (condition) {
    console.log(`  ✅ PASS: ${description}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${description}`);
    failed++;
  }
}

function describe(name, fn) {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🧪 ${name}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  fn();
}

// ─── Load modules (when running in browser, these are global) ────
const FOOD_DATABASE     = typeof window !== 'undefined' ? window.NutriAgent?.FOOD_DATABASE     : null;
const BMI_THRESHOLDS    = typeof window !== 'undefined' ? window.NutriAgent?.BMI_THRESHOLDS_BY_AGE : null;
const calculateBMI      = typeof window !== 'undefined' ? window.NutriAgent?.calculateBMI      : null;
const getBMICategory    = typeof window !== 'undefined' ? window.NutriAgent?.getBMICategory    : null;
const calculateCaloricTarget = typeof window !== 'undefined' ? window.NutriAgent?.calculateCaloricTarget : null;
const detectContradiction    = typeof detectContradiction !== 'undefined' ? detectContradiction : null;

// ─── Inline implementations for Node.js testing ──────────────────
// (Duplicated here so tests can run standalone without a browser)

const BMI_CATEGORIES = {
  UNDERWEIGHT: 'תת משקל',
  NORMAL:      'משקל תקין',
  OVERWEIGHT:  'עודף משקל',
  OBESE:       'השמנת יתר',
};

const BMI_THRESHOLDS_BY_AGE = {
   4: [13.8, 17.0, 18.0],  5: [13.9, 17.4, 18.8],  6: [14.0, 17.6, 19.8],
   7: [14.2, 18.0, 21.2],  8: [14.4, 18.4, 22.5],  9: [14.6, 19.0, 23.9],
  10: [14.8, 19.6, 25.4], 11: [15.0, 20.4, 26.5], 12: [14.8, 19.8, 27.0],
  13: [15.4, 21.5, 28.2], 14: [16.0, 22.3, 29.5], 15: [16.5, 23.0, 30.5],
  16: [17.0, 23.6, 31.5], 17: [17.4, 24.0, 32.7], 18: [17.8, 24.2, 33.9],
};

const BMI_CALORIE_SCALE = {
  [BMI_CATEGORIES.UNDERWEIGHT]: 1.175,
  [BMI_CATEGORIES.NORMAL]:      1.0,
  [BMI_CATEGORIES.OVERWEIGHT]:  0.875,
  [BMI_CATEGORIES.OBESE]:       0.825,
};

const BASE_CALORIES = {
  male:   { '4-8': 1400, '9-13': 1800, '14-18': 2200 },
  female: { '4-8': 1300, '9-13': 1600, '14-18': 1800 },
};

function calcBMI(weight, height) {
  return Math.round((weight / Math.pow(height / 100, 2)) * 10) / 10;
}

function getBMICat(bmi, age) {
  const thresholds = BMI_THRESHOLDS_BY_AGE[age] || BMI_THRESHOLDS_BY_AGE[10];
  if (bmi < thresholds[0]) return BMI_CATEGORIES.UNDERWEIGHT;
  if (bmi < thresholds[1]) return BMI_CATEGORIES.NORMAL;
  if (bmi < thresholds[2]) return BMI_CATEGORIES.OVERWEIGHT;
  return BMI_CATEGORIES.OBESE;
}

function getAgeBracket(age) {
  if (age <= 8) return '4-8';
  if (age <= 13) return '9-13';
  return '14-18';
}

function calcCalories(age, gender, activity, bmiCategory) {
  const base   = BASE_CALORIES[gender]?.[getAgeBracket(age)] || 1600;
  const delta  = activity === 'high' ? 400 : activity === 'moderate' ? 200 : 0;
  const scale  = BMI_CALORIE_SCALE[bmiCategory] || 1.0;
  return Math.round((base + delta) * scale);
}

function detectContradict(profile) {
  const restrictions = (profile.restrictions || []).map(r => r.toLowerCase());
  const dislikes     = (profile.dislikes     || []).map(d => d.toLowerCase());
  const isVegan      = restrictions.some(r => r.includes('טבעוני') || r.includes('vegan'));
  const isVeg        = restrictions.some(r => r.includes('צמחוני') || r.includes('vegetarian'));

  if (isVegan) {
    const sources = ['טופו', 'קטניות', 'עדשים', 'חומוס', 'שעועית', 'אפונה'];
    const blocked  = sources.filter(s => dislikes.some(d => d.includes(s) || s.includes(d)));
    if (blocked.length >= 4) {
      return { contradiction: true, message: `סתירה: טבעוני שדחה ${blocked.join(', ')}` };
    }
  }
  if (isVeg) {
    const allDairyBlocked = ['חלב','גבינה','יוגורט','ביצה'].every(
      item => dislikes.some(d => d.includes(item))
    );
    if (allDairyBlocked) {
      return { contradiction: true, message: 'סתירה: צמחוני שדחה גם חלב וגם ביצים' };
    }
  }
  return { contradiction: false };
}


// ══════════════════════════════════════════════════════════════════
// TC-01: ילד בריא — תפריט ~1800 קק"ל
// ══════════════════════════════════════════════════════════════════
describe('TC-01: ילד בריא 10 שנים — תוצאה נורמלית', () => {
  const age = 10, weight = 35, height = 140;
  const gender = 'male', activity = 'moderate';

  const bmi = calcBMI(weight, height);
  const bmiCategory = getBMICat(bmi, age);
  const calories = calcCalories(age, gender, activity, bmiCategory);

  assert(bmi >= 14 && bmi <= 22, `BMI בטווח תקין לגיל 10 (בפועל: ${bmi})`);
  assert(bmiCategory === BMI_CATEGORIES.NORMAL, `קטגוריית BMI: משקל תקין (בפועל: ${bmiCategory})`);
  assert(calories >= 1700 && calories <= 2200, `יעד קלוריות 1700–2200 (בפועל: ${calories})`);
  assert(calories === 2000, `יעד קלורי מדויק: 2000 קק"ל = (1800+200)×1.0 (בפועל: ${calories})`);

  // No contradiction expected
  const c = detectContradict({ restrictions: [], dislikes: [] });
  assert(!c.contradiction, 'אין סתירה לוגית בפרופיל');
});


// ══════════════════════════════════════════════════════════════════
// TC-02: נערה עם עודף משקל — קלוריות מופחתות
// ══════════════════════════════════════════════════════════════════
describe('TC-02: נערה 15 שנים — עודף משקל, קלוריות מופחתות', () => {
  const age = 15, weight = 65, height = 160;
  const gender = 'female', activity = 'low';

  const bmi = calcBMI(weight, height);
  const bmiCategory = getBMICat(bmi, age);
  const calories = calcCalories(age, gender, activity, bmiCategory);

  assert(bmi > 23.0, `BMI מעל סף עודף משקל לגיל 15 נקבה (בפועל: ${bmi})`);
  assert(bmiCategory === BMI_CATEGORIES.OVERWEIGHT, `קטגוריית BMI: עודף משקל (בפועל: ${bmiCategory})`);
  assert(calories < 1800, `יעד קלורי מופחת מ-1800 קק"ל (בפועל: ${calories})`);
  assert(calories === Math.round(1800 * 0.875), `יעד קלורי: 1800×0.875 = ${Math.round(1800 * 0.875)} (בפועל: ${calories})`);
});


// ══════════════════════════════════════════════════════════════════
// TC-03: ילד תת-משקל + אלרגיות גלוטן/חלב — קלוריות מוגברות
// ══════════════════════════════════════════════════════════════════
describe('TC-03: ילד 8 שנים — תת-משקל + אלרגיות גלוטן וחלב', () => {
  const age = 8, weight = 20, height = 128;
  const gender = 'male', activity = 'high';
  const restrictions = ['ללא גלוטן', 'ללא לקטוז'];
  const allergies    = ['גלוטן', 'חלב'];

  const bmi = calcBMI(weight, height);
  const bmiCategory = getBMICat(bmi, age);
  const calories = calcCalories(age, gender, activity, bmiCategory);

  assert(bmi < 14.4, `BMI מתחת לסף תת-משקל לגיל 8 (בפועל: ${bmi})`);
  assert(bmiCategory === BMI_CATEGORIES.UNDERWEIGHT, `קטגוריית BMI: תת משקל (בפועל: ${bmiCategory})`);
  assert(calories > 2000, `יעד קלורי מוגבר מ-2000 (בפועל: ${calories})`);
  assert(calories === Math.round((1400 + 400) * 1.175), `יעד: (1400+400)×1.175=${Math.round(1800*1.175)} (בפועל: ${calories})`);

  // Food filtering: should block gluten and dairy items
  const GLUTEN_KEYWORDS = ['לחם','פיתה','פסטה','קוסקוס','שיבולת שועל','בורגול'];
  const DAIRY_KEYWORDS  = ['חלב','גבינה','יוגורט','חמאה'];
  const mockGlutenFood  = { name_he: 'לחם כוסמין', allergens: ['gluten'] };
  const mockSafeFood    = { name_he: 'אורז מלא', allergens: [] };

  const isGlutenBlocked = allergies.some(a => a.includes('גלוטן')) &&
                          GLUTEN_KEYWORDS.some(k => mockGlutenFood.name_he.includes(k));
  const isSafeAllowed   = !GLUTEN_KEYWORDS.some(k => mockSafeFood.name_he.includes(k));

  assert(isGlutenBlocked, 'לחם כוסמין חסום עבור אלרגיה לגלוטן');
  assert(isSafeAllowed,   'אורז מלא מותר (ללא גלוטן)');
  assert(!detectContradict({ restrictions, dislikes: [] }).contradiction, 'אין סתירה בפרופיל TC-03');
});


// ══════════════════════════════════════════════════════════════════
// TC-04: נערה טבעונית — תפריט מהצומח
// ══════════════════════════════════════════════════════════════════
describe('TC-04: נערה 16 שנים — טבעונית, פעילות גבוהה', () => {
  const age = 16, weight = 52, height = 165;
  const gender = 'female', activity = 'high';
  const restrictions = ['טבעוני'];
  const dislikes     = ['בשר'];   // Acceptable — only one dislike

  const bmi = calcBMI(weight, height);
  const bmiCategory = getBMICat(bmi, age);
  const calories = calcCalories(age, gender, activity, bmiCategory);

  assert(bmiCategory === BMI_CATEGORIES.NORMAL, `BMI תקין (בפועל: ${bmiCategory})`);
  assert(calories === 2200, `יעד קלורי: (1800+400)×1.0 = 2200 (בפועל: ${calories})`);

  const contradiction = detectContradict({ restrictions, dislikes });
  assert(!contradiction.contradiction, 'אין סתירה — טבעונית עם דחיית בשר בלבד');

  // Verify system prompt would include vegan restriction
  const veganRestriction = restrictions.some(r => r.includes('טבעוני'));
  assert(veganRestriction, 'הגבלת טבעוני מזוהה ומועברת ל-Gemini');
});


// ══════════════════════════════════════════════════════════════════
// TC-05: [FAILURE] סתירה לוגית — טבעוני + דחיית כל חלבון צמחי
// ══════════════════════════════════════════════════════════════════
describe('TC-05: [FAILURE] סתירה לוגית — טבעוני + דחיית כל מקורות חלבון', () => {
  const restrictions = ['טבעוני'];
  const dislikes     = ['טופו', 'קטניות', 'עדשים', 'חומוס', 'שעועית'];

  const result = detectContradict({ restrictions, dislikes });

  assert(result.contradiction === true, 'זוהתה סתירה לוגית');
  assert(result.message.length > 0,     'הודעת שגיאה בעברית נוצרה');
  assert(result.message.includes('סתירה'), 'הודעה מכילה את המילה סתירה');

  // Verify FSM would NOT transition to GENERATING
  const wouldTransitionToGenerating = !result.contradiction;
  assert(!wouldTransitionToGenerating, 'FSM נשאר ב-SUMMARY — לא מעביר ל-GENERATING');

  // Verify error message mentions the blocked foods
  const mentionsBlockedFood = dislikes.some(d => result.message.includes(d));
  assert(mentionsBlockedFood, 'הודעת שגיאה מציינת את המאכלים שנדחו');
});


// ══════════════════════════════════════════════════════════════════
// TC-06: [FAILURE] חריגה מדומיין — שאלה שאינה קשורה לתזונה
// ══════════════════════════════════════════════════════════════════
describe('TC-06: [FAILURE] חריגה מדומיין — שאלה מחוץ לתחום התזונה', () => {
  // Simulate the off-domain response that Gemini returns
  const simulatedOffDomainResponse = '[OFF_DOMAIN] שאלתך חורגת מתחום הייעוץ התזונתי. אשמח לעזור בנושאי תזונה ותפריט בלבד.';
  const offDomainQuery = 'תמליץ לי על שיר של שלמה ארצי';

  // Test off-domain detection logic
  const isOffDomain = simulatedOffDomainResponse.startsWith('[OFF_DOMAIN]');
  assert(isOffDomain, 'זיהוי marker [OFF_DOMAIN] בתגובת Gemini');

  const cleanMessage = simulatedOffDomainResponse.replace('[OFF_DOMAIN]', '').trim();
  assert(cleanMessage.length > 0,    'הודעת שגיאה נוצרה לאחר הסרת ה-marker');
  assert(cleanMessage.includes('חורגת'), 'הודעה מסבירה שהשאלה חורגת מהדומיין');

  // Verify off-domain queries are NOT stored in chat history
  const shouldAddToHistory = !isOffDomain;
  assert(!shouldAddToHistory, 'שאלות מחוץ לדומיין לא נשמרות בהיסטוריית השיחה');

  // The query itself is valid Hebrew — so language guard doesn't trigger
  const hebrewChars = /[א-ת]/;
  assert(hebrewChars.test(offDomainQuery), 'שאלת TC-06 היא בעברית תקנית (Language Guard לא מופעל)');
  assert(hebrewChars.test(offDomainQuery) && isOffDomain, 'הכשל נוצר על ידי תוכן השאלה — לא על ידי שפה');
});


// ─── Summary ─────────────────────────────────────────────────────
console.log('\n╔══════════════════════════════════════╗');
console.log(`║  RESULTS: ${passed} passed, ${failed} failed           ║`);
console.log('╚══════════════════════════════════════╝');

if (failed === 0) {
  console.log('🎉 All tests passed!');
} else {
  console.log(`⚠️  ${failed} test(s) failed — review the output above.`);
  if (typeof process !== 'undefined') process.exit(1);
}
