/**
 * ============================================================
 * NUTRIAGENT — chatbot.js
 * Core Finite State Machine Engine
 * 
 * Responsibilities:
 *  - Sequential FSM data collection (8 fields, strict order)
 *  - Physiological calculations: BMI, BMR, caloric targets
 *  - Pediatric BMI category mapping (ages 4–18)
 *  - Embedded food database with K-Means cluster tags
 *  - DBSCAN -1 outlier guardrail enforcement
 *  - Cosine Similarity intra-cluster swap engine
 *  - Hebrew gender morphology detection & enforcement
 *  - Non-Hebrew input detection & rejection
 *  - Profile state management (no conversational history stored)
 * ============================================================
 */

'use strict';

/* ============================================================
   SECTION 1 — FSM STATE DEFINITIONS
   Each state name maps exactly to the sequential collection order.
   The FSM advances strictly in this order; no skipping is permitted.
============================================================ */
const FSM_STATES = Object.freeze({
  BOOT:         'boot',
  GREETING:     'greeting',
  AGE:          'age',
  GENDER:       'gender',
  WEIGHT:       'weight',
  HEIGHT:       'height',
  BMI_PROMPT:   'bmi_prompt',       // Internal state: display BMI/BMR after height
  ACTIVITY:     'activity',
  ALLERGIES:    'allergies',
  DISLIKES:     'dislikes',
  RESTRICTIONS: 'restrictions',
  SUMMARY:      'summary',
  AWAITING_EDIT:'awaiting_edit',    // User typed "עריכה" — awaiting field selection
  EDITING_FIELD:'editing_field',    // Active field being edited
  GENERATING:   'generating',       // API call in progress
  MEAL_PLAN:    'meal_plan',        // Plan rendered
  FOLLOWUP:     'followup',         // Post-plan free-text Q&A
  ERROR:        'error',
});

/* ============================================================
   SECTION 2 — ACTIVITY LEVEL DEFINITIONS
   Mapped to Hebrew display labels and caloric delta values.
============================================================ */
const ACTIVITY_LEVELS = Object.freeze({
  LOW:      { id: 'low',      label: 'פעילות נמוכה',     calorieDelta: 0   },
  MODERATE: { id: 'moderate', label: 'פעילות בינונית',    calorieDelta: 200 },
  HIGH:     { id: 'high',     label: 'פעילות גבוהה',     calorieDelta: 400 },
});

/* ============================================================
   SECTION 3 — PEDIATRIC BMI THRESHOLDS
   Source: CDC/WHO pediatric growth chart percentile cutoffs.
   Schema: { age: [underweight_cutoff, overweight_cutoff, obese_cutoff] }
   Logic:  bmi < thresholds[0]  → תת משקל (Underweight)
           bmi < thresholds[1]  → משקל תקין (Normal)
           bmi < thresholds[2]  → עודף משקל (Overweight)
           bmi >= thresholds[2] → השמנת יתר (Obesity)
============================================================ */
const BMI_THRESHOLDS_BY_AGE = Object.freeze({
   4: [13.8, 17.0, 18.0],
   5: [13.9, 17.4, 18.8],
   6: [14.0, 17.6, 19.8],
   7: [14.2, 18.0, 21.2],
   8: [14.4, 18.4, 22.5],
   9: [14.6, 19.0, 23.9],
  10: [14.8, 19.6, 25.4],
  11: [15.0, 20.4, 26.5],
  12: [14.8, 19.8, 27.0],
  13: [15.4, 21.5, 28.2],
  14: [16.0, 22.3, 29.5],
  15: [16.5, 23.0, 30.5],
  16: [17.0, 23.6, 31.5],
  17: [17.4, 24.0, 32.7],
  18: [17.8, 24.2, 33.9],
});

/* BMI category labels in Hebrew */
const BMI_CATEGORIES = Object.freeze({
  UNDERWEIGHT: 'תת משקל',
  NORMAL:      'משקל תקין',
  OVERWEIGHT:  'עודף משקל',
  OBESE:       'השמנת יתר',
});

/* BMI category caloric scaling multipliers */
const BMI_CALORIE_SCALE = Object.freeze({
  [BMI_CATEGORIES.UNDERWEIGHT]: 1.175,   // +17.5%
  [BMI_CATEGORIES.NORMAL]:      1.0,     //  0%
  [BMI_CATEGORIES.OVERWEIGHT]:  0.875,   // -12.5%
  [BMI_CATEGORIES.OBESE]:       0.825,   // -17.5%
});

/* ============================================================
   SECTION 4 — BASE CALORIE TABLE (BMR BASELINES)
   Structured by gender → age bracket → base kcal.
   Age brackets cover the full 4–18 range.
============================================================ */
const BASE_CALORIES = Object.freeze({
  male: [
    { minAge: 4,  maxAge:  8, base: 1400 },
    { minAge: 9,  maxAge: 13, base: 1800 },
    { minAge: 14, maxAge: 18, base: 2200 },
  ],
  female: [
    { minAge: 4,  maxAge:  8, base: 1300 },
    { minAge: 9,  maxAge: 13, base: 1600 },
    { minAge: 14, maxAge: 18, base: 1800 },
  ],
});

/* ============================================================
   SECTION 5 — KMEANS CLUSTER DEFINITIONS
   Metadata for each of the 4 macro-nutritional archetypes
   derived from USDA National Nutrient Database modeling.
============================================================ */
const KMEANS_CLUSTERS = Object.freeze({
  0: {
    id:          0,
    name:        'נפח / הידרציה / צפיפות נמוכה',
    nameShort:   'אשכול 0 — נפח',
    description: 'קלוריות נמוכות, סיבים גבוהים, מים גבוהים',
    examples:    ['עלים ירוקים', 'פירות טריים', 'מרקים צלולים'],
    cssClass:    'cluster-0',
  },
  1: {
    id:          1,
    name:        'חלבון רזה',
    nameShort:   'אשכול 1 — חלבון',
    description: 'חלבון גבוה, שומן נמוך, אפס פחמימות',
    examples:    ['חזה עוף', 'טונה במים', 'פילה קוד', 'חלבוני ביצה'],
    cssClass:    'cluster-1',
  },
  2: {
    id:          2,
    name:        'שומנים בריאים / אנרגיה צפופה',
    nameShort:   'אשכול 2 — שומנים',
    description: 'שומנים בריאים גבוהים, חלבון בינוני',
    examples:    ['שמן זית', 'אגוזים', 'טחינה גולמית', 'אבוקדו'],
    cssClass:    'cluster-2',
  },
  3: {
    id:          3,
    name:        'פחמימות מורכבות',
    nameShort:   'אשכול 3 — פחמימות',
    description: 'פחמימות מורכבות גבוהות, סיבים נמוך-בינוני',
    examples:    ['אורז מלא', 'קינואה', 'שיבולת שועל', 'לחם כוסמין'],
    cssClass:    'cluster-3',
  },
});

/* ============================================================
   SECTION 6 — EMBEDDED FOOD DATABASE
   Each entry is normalized from the USDA National Nutrient Database.
   Schema per item:
   {
     id:        unique string identifier,
     name:      Hebrew display name,
     nameEn:    English reference name,
     cluster:   K-Means cluster index (0–3),
     dbscan:    DBSCAN cluster index (-1 = outlier/noise, 0+ = valid),
     per100g: {
       calories, protein, fat, carbs, fiber, sugar
     },
     allergens:      array of allergen strings,
     restrictions:   array of dietary restriction flags,
     servingSizeG:   typical serving size in grams,
   }

   DBSCAN -1 items are included in the DB but BLOCKED from
   automatic inclusion in private user plans (clinical auth required).
============================================================ */
const FOOD_DATABASE = Object.freeze([

  /* ── CLUSTER 0: Volume / Hydration / Low-Density ───────────── */
  {
    id: 'spinach_raw', name: 'תרד טרי', nameEn: 'Spinach raw',
    cluster: 0, dbscan: 0,
    per100g: { calories: 23, protein: 2.9, fat: 0.4, carbs: 3.6, fiber: 2.2, sugar: 0.4 },
    allergens: [], restrictions: ['vegetarian','vegan','kosher','gluten-free','lactose-free'],
    servingSizeG: 80,
  },
  {
    id: 'romaine_lettuce', name: 'חסה רומנית', nameEn: 'Romaine lettuce',
    cluster: 0, dbscan: 0,
    per100g: { calories: 17, protein: 1.2, fat: 0.3, carbs: 3.3, fiber: 2.1, sugar: 1.2 },
    allergens: [], restrictions: ['vegetarian','vegan','kosher','gluten-free','lactose-free'],
    servingSizeG: 80,
  },
  {
    id: 'cucumber', name: 'מלפפון', nameEn: 'Cucumber',
    cluster: 0, dbscan: 0,
    per100g: { calories: 15, protein: 0.7, fat: 0.1, carbs: 3.6, fiber: 0.5, sugar: 1.7 },
    allergens: [], restrictions: ['vegetarian','vegan','kosher','gluten-free','lactose-free'],
    servingSizeG: 100,
  },
  {
    id: 'tomato', name: 'עגבנייה', nameEn: 'Tomato',
    cluster: 0, dbscan: 0,
    per100g: { calories: 18, protein: 0.9, fat: 0.2, carbs: 3.9, fiber: 1.2, sugar: 2.6 },
    allergens: [], restrictions: ['vegetarian','vegan','kosher','gluten-free','lactose-free'],
    servingSizeG: 120,
  },
  {
    id: 'apple', name: 'תפוח עץ', nameEn: 'Apple',
    cluster: 0, dbscan: 0,
    per100g: { calories: 52, protein: 0.3, fat: 0.2, carbs: 13.8, fiber: 2.4, sugar: 10.4 },
    allergens: [], restrictions: ['vegetarian','vegan','kosher','gluten-free','lactose-free'],
    servingSizeG: 150,
  },
  {
    id: 'banana', name: 'בננה', nameEn: 'Banana',
    cluster: 0, dbscan: 0,
    per100g: { calories: 89, protein: 1.1, fat: 0.3, carbs: 22.8, fiber: 2.6, sugar: 12.2 },
    allergens: [], restrictions: ['vegetarian','vegan','kosher','gluten-free','lactose-free'],
    servingSizeG: 120,
  },
  {
    id: 'watermelon', name: 'אבטיח', nameEn: 'Watermelon',
    cluster: 0, dbscan: 0,
    per100g: { calories: 30, protein: 0.6, fat: 0.2, carbs: 7.6, fiber: 0.4, sugar: 6.2 },
    allergens: [], restrictions: ['vegetarian','vegan','kosher','gluten-free','lactose-free'],
    servingSizeG: 200,
  },
  {
    id: 'orange', name: 'תפוז', nameEn: 'Orange',
    cluster: 0, dbscan: 0,
    per100g: { calories: 47, protein: 0.9, fat: 0.1, carbs: 11.8, fiber: 2.4, sugar: 9.4 },
    allergens: [], restrictions: ['vegetarian','vegan','kosher','gluten-free','lactose-free'],
    servingSizeG: 130,
  },
  {
    id: 'strawberry', name: 'תות שדה', nameEn: 'Strawberry',
    cluster: 0, dbscan: 0,
    per100g: { calories: 32, protein: 0.7, fat: 0.3, carbs: 7.7, fiber: 2.0, sugar: 4.9 },
    allergens: [], restrictions: ['vegetarian','vegan','kosher','gluten-free','lactose-free'],
    servingSizeG: 150,
  },
  {
    id: 'blueberry', name: 'אוכמניות', nameEn: 'Blueberry',
    cluster: 0, dbscan: 0,
    per100g: { calories: 57, protein: 0.7, fat: 0.3, carbs: 14.5, fiber: 2.4, sugar: 10.0 },
    allergens: [], restrictions: ['vegetarian','vegan','kosher','gluten-free','lactose-free'],
    servingSizeG: 100,
  },
  {
    id: 'carrot', name: 'גזר', nameEn: 'Carrot',
    cluster: 0, dbscan: 0,
    per100g: { calories: 41, protein: 0.9, fat: 0.2, carbs: 9.6, fiber: 2.8, sugar: 4.7 },
    allergens: [], restrictions: ['vegetarian','vegan','kosher','gluten-free','lactose-free'],
    servingSizeG: 100,
  },
  {
    id: 'broccoli', name: 'ברוקולי', nameEn: 'Broccoli',
    cluster: 0, dbscan: 0,
    per100g: { calories: 34, protein: 2.8, fat: 0.4, carbs: 6.6, fiber: 2.6, sugar: 1.7 },
    allergens: [], restrictions: ['vegetarian','vegan','kosher','gluten-free','lactose-free'],
    servingSizeG: 120,
  },
  {
    id: 'zucchini', name: 'קישוא', nameEn: 'Zucchini',
    cluster: 0, dbscan: 0,
    per100g: { calories: 17, protein: 1.2, fat: 0.3, carbs: 3.1, fiber: 1.0, sugar: 2.5 },
    allergens: [], restrictions: ['vegetarian','vegan','kosher','gluten-free','lactose-free'],
    servingSizeG: 150,
  },
  {
    id: 'chicken_broth_clear', name: 'מרק עוף צלול', nameEn: 'Clear chicken broth',
    cluster: 0, dbscan: 0,
    per100g: { calories: 12, protein: 1.4, fat: 0.4, carbs: 0.9, fiber: 0.0, sugar: 0.3 },
    allergens: [], restrictions: ['kosher','gluten-free','lactose-free'],
    servingSizeG: 250,
  },
  {
    id: 'grapes', name: 'ענבים', nameEn: 'Grapes',
    cluster: 0, dbscan: 0,
    per100g: { calories: 67, protein: 0.6, fat: 0.4, carbs: 17.2, fiber: 0.9, sugar: 16.2 },
    allergens: [], restrictions: ['vegetarian','vegan','kosher','gluten-free','lactose-free'],
    servingSizeG: 120,
  },

  /* ── CLUSTER 1: Lean Protein Core ──────────────────────────── */
  {
    id: 'chicken_breast', name: 'חזה עוף', nameEn: 'Chicken breast skinless',
    cluster: 1, dbscan: 0,
    per100g: { calories: 165, protein: 31.0, fat: 3.6, carbs: 0.0, fiber: 0.0, sugar: 0.0 },
    allergens: [], restrictions: ['kosher','gluten-free','lactose-free'],
    servingSizeG: 150,
  },
  {
    id: 'tuna_water', name: 'טונה במים', nameEn: 'Tuna canned in water',
    cluster: 1, dbscan: 0,
    per100g: { calories: 116, protein: 25.5, fat: 1.0, carbs: 0.0, fiber: 0.0, sugar: 0.0 },
    allergens: ['fish'], restrictions: ['gluten-free','lactose-free'],
    servingSizeG: 120,
  },
  {
    id: 'cod_fillet', name: 'פילה קוד', nameEn: 'Cod fillet',
    cluster: 1, dbscan: 0,
    per100g: { calories: 82, protein: 17.8, fat: 0.7, carbs: 0.0, fiber: 0.0, sugar: 0.0 },
    allergens: ['fish'], restrictions: ['gluten-free','lactose-free'],
    servingSizeG: 150,
  },
  {
    id: 'egg_whites', name: 'חלבוני ביצה', nameEn: 'Egg whites',
    cluster: 1, dbscan: 0,
    per100g: { calories: 52, protein: 10.9, fat: 0.2, carbs: 0.7, fiber: 0.0, sugar: 0.7 },
    allergens: ['eggs'], restrictions: ['vegetarian','kosher','gluten-free','lactose-free'],
    servingSizeG: 120,
  },
  {
    id: 'turkey_breast', name: 'חזה הודו', nameEn: 'Turkey breast',
    cluster: 1, dbscan: 0,
    per100g: { calories: 135, protein: 29.9, fat: 1.0, carbs: 0.0, fiber: 0.0, sugar: 0.0 },
    allergens: [], restrictions: ['kosher','gluten-free','lactose-free'],
    servingSizeG: 150,
  },
  {
    id: 'salmon_fillet', name: 'פילה סלמון', nameEn: 'Salmon fillet',
    cluster: 1, dbscan: 0,
    per100g: { calories: 208, protein: 20.0, fat: 13.0, carbs: 0.0, fiber: 0.0, sugar: 0.0 },
    allergens: ['fish'], restrictions: ['gluten-free','lactose-free'],
    servingSizeG: 150,
  },
  {
    id: 'low_fat_cottage', name: 'גבינת קוטג׳ 5%', nameEn: 'Low fat cottage cheese',
    cluster: 1, dbscan: 0,
    per100g: { calories: 72, protein: 11.0, fat: 1.8, carbs: 3.4, fiber: 0.0, sugar: 3.4 },
    allergens: ['dairy'], restrictions: ['vegetarian','kosher','gluten-free'],
    servingSizeG: 150,
  },
  {
    id: 'greek_yogurt_0', name: 'יוגורט יווני 0%', nameEn: 'Greek yogurt 0% fat',
    cluster: 1, dbscan: 0,
    per100g: { calories: 59, protein: 10.2, fat: 0.4, carbs: 3.6, fiber: 0.0, sugar: 3.2 },
    allergens: ['dairy'], restrictions: ['vegetarian','kosher','gluten-free'],
    servingSizeG: 200,
  },
  {
    id: 'lentils_cooked', name: 'עדשים מבושלות', nameEn: 'Lentils cooked',
    cluster: 1, dbscan: 0,
    per100g: { calories: 116, protein: 9.0, fat: 0.4, carbs: 20.1, fiber: 7.9, sugar: 1.8 },
    allergens: [], restrictions: ['vegetarian','vegan','kosher','gluten-free','lactose-free'],
    servingSizeG: 200,
  },
  {
    id: 'chickpeas_cooked', name: 'חומוס מבושל', nameEn: 'Chickpeas cooked',
    cluster: 1, dbscan: 0,
    per100g: { calories: 164, protein: 8.9, fat: 2.6, carbs: 27.4, fiber: 7.6, sugar: 4.8 },
    allergens: [], restrictions: ['vegetarian','vegan','kosher','gluten-free','lactose-free'],
    servingSizeG: 150,
  },
  {
    id: 'tofu_firm', name: 'טופו קשה', nameEn: 'Firm tofu',
    cluster: 1, dbscan: 0,
    per100g: { calories: 144, protein: 17.3, fat: 8.7, carbs: 2.8, fiber: 0.3, sugar: 0.9 },
    allergens: ['soy'], restrictions: ['vegetarian','vegan','gluten-free','lactose-free'],
    servingSizeG: 150,
  },
  {
    id: 'whole_egg', name: 'ביצה שלמה', nameEn: 'Whole egg',
    cluster: 1, dbscan: 0,
    per100g: { calories: 155, protein: 12.6, fat: 10.6, carbs: 1.1, fiber: 0.0, sugar: 1.1 },
    allergens: ['eggs'], restrictions: ['vegetarian','kosher','gluten-free','lactose-free'],
    servingSizeG: 55,
  },

  /* ── CLUSTER 2: Essential Fats / Dense Energy ───────────────── */
  {
    id: 'olive_oil', name: 'שמן זית', nameEn: 'Olive oil extra virgin',
    cluster: 2, dbscan: 0,
    per100g: { calories: 884, protein: 0.0, fat: 100.0, carbs: 0.0, fiber: 0.0, sugar: 0.0 },
    allergens: [], restrictions: ['vegetarian','vegan','kosher','gluten-free','lactose-free'],
    servingSizeG: 10,
  },
  {
    id: 'avocado', name: 'אבוקדו', nameEn: 'Avocado',
    cluster: 2, dbscan: 0,
    per100g: { calories: 160, protein: 2.0, fat: 14.7, carbs: 8.5, fiber: 6.7, sugar: 0.7 },
    allergens: [], restrictions: ['vegetarian','vegan','kosher','gluten-free','lactose-free'],
    servingSizeG: 100,
  },
  {
    id: 'walnuts', name: 'אגוזי מלך', nameEn: 'Walnuts',
    cluster: 2, dbscan: 0,
    per100g: { calories: 654, protein: 15.2, fat: 65.2, carbs: 13.7, fiber: 6.7, sugar: 2.6 },
    allergens: ['tree-nuts'], restrictions: ['vegetarian','vegan','kosher','gluten-free','lactose-free'],
    servingSizeG: 30,
  },
  {
    id: 'almonds', name: 'שקדים', nameEn: 'Almonds',
    cluster: 2, dbscan: 0,
    per100g: { calories: 579, protein: 21.2, fat: 49.9, carbs: 21.6, fiber: 12.5, sugar: 4.4 },
    allergens: ['tree-nuts'], restrictions: ['vegetarian','vegan','kosher','gluten-free','lactose-free'],
    servingSizeG: 30,
  },
  {
    id: 'tahini_raw', name: 'טחינה גולמית', nameEn: 'Raw tahini',
    cluster: 2, dbscan: 0,
    per100g: { calories: 595, protein: 17.0, fat: 53.8, carbs: 21.2, fiber: 9.3, sugar: 0.5 },
    allergens: ['sesame'], restrictions: ['vegetarian','vegan','kosher','gluten-free','lactose-free'],
    servingSizeG: 20,
  },
  {
    id: 'peanut_butter_natural', name: 'חמאת בוטנים טבעית', nameEn: 'Natural peanut butter',
    cluster: 2, dbscan: 0,
    per100g: { calories: 588, protein: 25.1, fat: 50.4, carbs: 20.1, fiber: 6.0, sugar: 8.4 },
    allergens: ['peanuts'], restrictions: ['vegetarian','vegan','kosher','gluten-free','lactose-free'],
    servingSizeG: 32,
  },
  {
    id: 'cashews', name: 'קשיו', nameEn: 'Cashews',
    cluster: 2, dbscan: 0,
    per100g: { calories: 553, protein: 18.2, fat: 43.9, carbs: 30.2, fiber: 3.3, sugar: 5.9 },
    allergens: ['tree-nuts'], restrictions: ['vegetarian','vegan','kosher','gluten-free','lactose-free'],
    servingSizeG: 30,
  },
  {
    id: 'flaxseeds', name: 'זרעי פשתן', nameEn: 'Flaxseeds',
    cluster: 2, dbscan: 0,
    per100g: { calories: 534, protein: 18.3, fat: 42.2, carbs: 28.9, fiber: 27.3, sugar: 1.6 },
    allergens: [], restrictions: ['vegetarian','vegan','kosher','gluten-free','lactose-free'],
    servingSizeG: 15,
  },
  {
    id: 'chia_seeds', name: 'זרעי צ׳יה', nameEn: 'Chia seeds',
    cluster: 2, dbscan: 0,
    per100g: { calories: 486, protein: 16.5, fat: 30.7, carbs: 42.1, fiber: 34.4, sugar: 0.0 },
    allergens: [], restrictions: ['vegetarian','vegan','kosher','gluten-free','lactose-free'],
    servingSizeG: 20,
  },

  /* ── CLUSTER 3: Complex Carbohydrates ───────────────────────── */
  {
    id: 'brown_rice_cooked', name: 'אורז מלא מבושל', nameEn: 'Brown rice cooked',
    cluster: 3, dbscan: 0,
    per100g: { calories: 216, protein: 5.0, fat: 1.8, carbs: 44.8, fiber: 3.5, sugar: 0.7 },
    allergens: [], restrictions: ['vegetarian','vegan','kosher','gluten-free','lactose-free'],
    servingSizeG: 150,
  },
  {
    id: 'quinoa_cooked', name: 'קינואה מבושלת', nameEn: 'Quinoa cooked',
    cluster: 3, dbscan: 0,
    per100g: { calories: 120, protein: 4.4, fat: 1.9, carbs: 21.3, fiber: 2.8, sugar: 0.9 },
    allergens: [], restrictions: ['vegetarian','vegan','kosher','gluten-free','lactose-free'],
    servingSizeG: 150,
  },
  {
    id: 'oats_rolled', name: 'שיבולת שועל (גרנולה)', nameEn: 'Rolled oats',
    cluster: 3, dbscan: 0,
    per100g: { calories: 389, protein: 16.9, fat: 6.9, carbs: 66.3, fiber: 10.6, sugar: 0.0 },
    allergens: ['gluten'], restrictions: ['vegetarian','vegan','kosher','lactose-free'],
    servingSizeG: 50,
  },
  {
    id: 'spelt_bread', name: 'לחם כוסמין', nameEn: 'Spelt bread',
    cluster: 3, dbscan: 0,
    per100g: { calories: 243, protein: 9.8, fat: 2.2, carbs: 46.7, fiber: 5.3, sugar: 4.1 },
    allergens: ['gluten'], restrictions: ['vegetarian','vegan','kosher','lactose-free'],
    servingSizeG: 60,
  },
  {
    id: 'sweet_potato_baked', name: 'בטטה אפויה', nameEn: 'Sweet potato baked',
    cluster: 3, dbscan: 0,
    per100g: { calories: 90, protein: 2.0, fat: 0.1, carbs: 20.7, fiber: 3.3, sugar: 6.5 },
    allergens: [], restrictions: ['vegetarian','vegan','kosher','gluten-free','lactose-free'],
    servingSizeG: 200,
  },
  {
    id: 'whole_wheat_pita', name: 'פיתה מקמח מלא', nameEn: 'Whole wheat pita',
    cluster: 3, dbscan: 0,
    per100g: { calories: 265, protein: 9.1, fat: 1.2, carbs: 55.0, fiber: 4.4, sugar: 1.8 },
    allergens: ['gluten'], restrictions: ['vegetarian','vegan','kosher','lactose-free'],
    servingSizeG: 60,
  },
  {
    id: 'buckwheat_cooked', name: 'כוסמת מבושלת', nameEn: 'Buckwheat cooked',
    cluster: 3, dbscan: 0,
    per100g: { calories: 92, protein: 3.4, fat: 0.6, carbs: 19.9, fiber: 2.7, sugar: 0.0 },
    allergens: [], restrictions: ['vegetarian','vegan','kosher','gluten-free','lactose-free'],
    servingSizeG: 150,
  },
  {
    id: 'corn_cooked', name: 'תירס מבושל', nameEn: 'Corn cooked',
    cluster: 3, dbscan: 0,
    per100g: { calories: 96, protein: 3.4, fat: 1.5, carbs: 21.0, fiber: 2.4, sugar: 4.5 },
    allergens: [], restrictions: ['vegetarian','vegan','kosher','gluten-free','lactose-free'],
    servingSizeG: 150,
  },
  {
    id: 'whole_pasta_cooked', name: 'פסטה מחיטה מלאה', nameEn: 'Whole wheat pasta cooked',
    cluster: 3, dbscan: 0,
    per100g: { calories: 124, protein: 5.3, fat: 0.5, carbs: 26.5, fiber: 3.9, sugar: 0.6 },
    allergens: ['gluten'], restrictions: ['vegetarian','vegan','kosher','lactose-free'],
    servingSizeG: 180,
  },

  /* ── DBSCAN -1: OUTLIERS — BLOCKED FOR PRIVATE USERS ─────────
     These items require explicit clinical authorization.
     They appear in the DB for dietitian-mode reference only.
  ──────────────────────────────────────────────────────────── */
  {
    id: 'whey_isolate_90', name: 'אבקת חלבון ווי 90%', nameEn: 'Whey protein isolate 90%',
    cluster: 1, dbscan: -1,
    per100g: { calories: 370, protein: 90.0, fat: 1.0, carbs: 4.0, fiber: 0.0, sugar: 1.5 },
    allergens: ['dairy'], restrictions: ['kosher','gluten-free'],
    servingSizeG: 30,
    dbscanNote: 'חלבון בודד תעשייתי >80g/100g — דורש אישור תזונאי',
  },
  {
    id: 'palm_oil_refined', name: 'שמן דקלים מזוקק', nameEn: 'Refined palm oil',
    cluster: 2, dbscan: -1,
    per100g: { calories: 884, protein: 0.0, fat: 100.0, carbs: 0.0, fiber: 0.0, sugar: 0.0 },
    allergens: [], restrictions: ['vegetarian','vegan','gluten-free','lactose-free'],
    servingSizeG: 10,
    dbscanNote: 'שמן תעשייתי מזוקק — חסום אוטומטית',
  },
  {
    id: 'refined_glucose_syrup', name: 'סירופ גלוקוז מזוקק', nameEn: 'Refined glucose syrup',
    cluster: 3, dbscan: -1,
    per100g: { calories: 316, protein: 0.0, fat: 0.0, carbs: 81.3, fiber: 0.0, sugar: 81.3 },
    allergens: [], restrictions: ['vegetarian','vegan','gluten-free','lactose-free'],
    servingSizeG: 20,
    dbscanNote: 'סוכר מזוקק תעשייתי — חסום אוטומטית',
  },
  {
    id: 'mass_gainer_powder', name: 'אבקת מאס גיינר', nameEn: 'Mass gainer powder',
    cluster: 3, dbscan: -1,
    per100g: { calories: 390, protein: 15.0, fat: 5.0, carbs: 73.0, fiber: 1.0, sugar: 22.0 },
    allergens: ['dairy','gluten'], restrictions: [],
    servingSizeG: 100,
    dbscanNote: 'תוסף תעשייתי לעלייה במסה — דורש אישור תזונאי',
  },
]);

/* ============================================================
   SECTION 7 — DIETARY RESTRICTION KEYWORD MAPPING
   Maps Hebrew user input phrases to normalized restriction tags
   that are checked against FOOD_DATABASE entries.
============================================================ */
const RESTRICTION_ALIASES = Object.freeze({
  'צמחוני':        'vegetarian',
  'צמחונית':       'vegetarian',
  'טבעוני':        'vegan',
  'טבעונית':       'vegan',
  'כשר':           'kosher',
  'כשרה':          'kosher',
  'ללא גלוטן':     'gluten-free',
  'גלוטן פרי':     'gluten-free',
  'ללא לקטוז':     'lactose-free',
  'אל חלב':        'lactose-free',
  'אי סבילות ללקטוז': 'lactose-free',
});

/* ============================================================
   SECTION 8 — HEBREW GENDER MORPHOLOGY HELPERS
   Detects gender from user utterances and provides
   gender-inflected Hebrew string generators.
============================================================ */

/**
 * Detects gender from a Hebrew sentence.
 * Looks for explicit gender markers: בן (male), בת (female),
 * or verb agreement patterns.
 * @param {string} text — raw Hebrew user input
 * @returns {'male'|'female'|null}
 */
function detectGenderFromText(text) {
  if (!text) return null;
  const t = text.trim();

  const malePatterns = [
    /\bבן\b/,          // "אני בן X"
    /\bאני בן\b/,
    /\bמוכן\b/,
    /\bרוצה\b.*\bאני\b/,
    /\bכותב\b/,
    /\bמתחיל\b/,
  ];
  const femalePatterns = [
    /\bבת\b/,          // "אני בת X"
    /\bאני בת\b/,
    /\bמוכנה\b/,
    /\bכותבת\b/,
    /\bמתחילה\b/,
    /\bרוצה\b.*\bאני\b.*\bה\b/,
  ];

  for (const pattern of femalePatterns) {
    if (pattern.test(t)) return 'female';
  }
  for (const pattern of malePatterns) {
    if (pattern.test(t)) return 'male';
  }
  return null;
}

/**
 * Returns a gender-inflected Hebrew greeting/confirmation string.
 * @param {'male'|'female'} gender
 * @param {string} maleForm
 * @param {string} femaleForm
 * @returns {string}
 */
function genderInflect(gender, maleForm, femaleForm) {
  return gender === 'female' ? femaleForm : maleForm;
}

/* ============================================================
   SECTION 9 — LANGUAGE GUARD
   Detects non-Hebrew input and returns the standardized block.
============================================================ */

/** Hebrew Unicode range: \u05D0–\u05EA */
const HEBREW_REGEX = /[\u05D0-\u05EA]/;
const NON_HEBREW_RESPONSE = 'מצטער, אני יכול לתקשר רק בעברית. אנא כתוב את ההודעה שלך בעברית.';

/**
 * Returns true if the text contains at least one Hebrew character.
 * Empty strings are allowed (handled separately in FSM transitions).
 * @param {string} text
 * @returns {boolean}
 */
function containsHebrew(text) {
  return HEBREW_REGEX.test(text);
}

/**
 * Returns true if text appears to be written entirely in a non-Hebrew
 * script (Latin, Arabic, Cyrillic, etc.) with no Hebrew content.
 * @param {string} text
 * @returns {boolean}
 */
function isNonHebrew(text) {
  if (!text || text.trim().length === 0) return false;
  // Strip digits, punctuation, and whitespace — if remainder has no Hebrew → flag
  const stripped = text.replace(/[\d\s\p{P}]/gu, '');
  if (stripped.length === 0) return false;
  return !containsHebrew(stripped);
}

/* ============================================================
   SECTION 10 — PHYSIOLOGICAL CALCULATION ENGINE
============================================================ */

/**
 * Calculates BMI using the standard formula.
 * @param {number} weightKg
 * @param {number} heightCm
 * @returns {number} BMI rounded to 1 decimal
 */
function calculateBMI(weightKg, heightCm) {
  const heightM = heightCm / 100;
  return Math.round((weightKg / (heightM * heightM)) * 10) / 10;
}

/**
 * Returns the nearest age key from the BMI thresholds table.
 * Interpolates by selecting the closest defined age entry.
 * @param {number} age
 * @returns {number} resolved age key
 */
function resolveAgeKey(age) {
  const keys = Object.keys(BMI_THRESHOLDS_BY_AGE).map(Number);
  return keys.reduce((closest, key) =>
    Math.abs(key - age) < Math.abs(closest - age) ? key : closest
  );
}

/**
 * Maps a BMI value to a pediatric BMI category string (Hebrew).
 * @param {number} bmi
 * @param {number} age
 * @returns {string} Hebrew BMI category
 */
function getBMICategory(bmi, age) {
  const key = resolveAgeKey(age);
  const [underCutoff, overCutoff, obeseCutoff] = BMI_THRESHOLDS_BY_AGE[key];

  if (bmi < underCutoff)  return BMI_CATEGORIES.UNDERWEIGHT;
  if (bmi < overCutoff)   return BMI_CATEGORIES.NORMAL;
  if (bmi < obeseCutoff)  return BMI_CATEGORIES.OVERWEIGHT;
  return BMI_CATEGORIES.OBESE;
}

/**
 * Returns the base caloric target for a given gender and age.
 * @param {'male'|'female'} gender
 * @param {number} age
 * @returns {number} base kcal
 */
function getBaseCalories(gender, age) {
  const brackets = BASE_CALORIES[gender] || BASE_CALORIES.male;
  const bracket = brackets.find(b => age >= b.minAge && age <= b.maxAge);
  return bracket ? bracket.base : 1800; // fallback
}

/**
 * Calculates the final adjusted daily caloric target.
 * Formula:
 *   1. Get gender/age base kcal
 *   2. Add activity delta (+0 / +200 / +400)
 *   3. Multiply by BMI category scaling factor
 *
 * @param {number} age
 * @param {'male'|'female'} gender
 * @param {string} activityId — 'low' | 'moderate' | 'high'
 * @param {string} bmiCategory — Hebrew category string
 * @returns {{ bmrBase: number, activityAdjusted: number, finalTarget: number, scaleFactor: number }}
 */
function calculateCaloricTarget(age, gender, activityId, bmiCategory) {
  const bmrBase = getBaseCalories(gender, age);

  const activityEntry = Object.values(ACTIVITY_LEVELS)
    .find(a => a.id === activityId) || ACTIVITY_LEVELS.LOW;
  const activityAdjusted = bmrBase + activityEntry.calorieDelta;

  const scaleFactor = BMI_CALORIE_SCALE[bmiCategory] || 1.0;
  const finalTarget = Math.round(activityAdjusted * scaleFactor);

  return { bmrBase, activityAdjusted, finalTarget, scaleFactor };
}

/**
 * Builds a Hebrew clinical narrative explaining the caloric calculation.
 * This string is passed into the AI prompt and also displayed in the UI.
 * @param {object} profile — complete user profile
 * @param {object} metrics — { bmi, bmiCategory, bmrBase, activityAdjusted, finalTarget, scaleFactor }
 * @returns {string}
 */
function buildCalorieNarrative(profile, metrics) {
  const { bmi, bmiCategory, bmrBase, activityAdjusted, finalTarget, scaleFactor } = metrics;
  const activityLabel = Object.values(ACTIVITY_LEVELS)
    .find(a => a.id === profile.activityLevel)?.label || '';
  const scalePercent = Math.round((scaleFactor - 1) * 100);
  const scaleDesc = scalePercent >= 0
    ? `תוספת ${scalePercent}% (קידום עלייה בריאה במסה)`
    : `הפחתה ${Math.abs(scalePercent)}% (ירידה מובנית ומדורגת)`;

  return (
    `BMR בסיס (גיל ${profile.age}, ${profile.gender === 'male' ? 'זכר' : 'נקבה'}): ${bmrBase} קק"ל | ` +
    `רמת פעילות — ${activityLabel}: +${activityAdjusted - bmrBase} קק"ל → ${activityAdjusted} קק"ל | ` +
    `BMI: ${bmi} (${bmiCategory}) — ${scaleDesc} → ` +
    `יעד קלורי סופי: ${finalTarget} קק"ל/יום`
  );
}

/* ============================================================
   SECTION 11 — COSINE SIMILARITY SWAP ENGINE
   Implements intra-cluster content-based recommendation.
   Vector space: [calories, protein, fat, carbs, fiber, sugar]
   All values normalized to per-serving before comparison.
============================================================ */

/**
 * Extracts a 6-dimensional nutritional feature vector for a food item,
 * normalized to the item's typical serving size.
 * @param {object} item — food database entry
 * @returns {number[]} [calories, protein, fat, carbs, fiber, sugar] per serving
 */
function getNutritionalVector(item) {
  const s = item.servingSizeG / 100;
  const n = item.per100g;
  return [
    n.calories * s,
    n.protein  * s,
    n.fat      * s,
    n.carbs    * s,
    n.fiber    * s,
    n.sugar    * s,
  ];
}

/**
 * Computes the cosine similarity between two equal-length vectors.
 * Returns a value between 0 (orthogonal) and 1 (identical direction).
 * @param {number[]} vecA
 * @param {number[]} vecB
 * @returns {number} cosine similarity score [0, 1]
 */
function cosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length) return 0;

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    magnitudeA += vecA[i] * vecA[i];
    magnitudeB += vecB[i] * vecB[i];
  }

  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);

  if (magnitudeA === 0 || magnitudeB === 0) return 0;
  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Core Swap Engine:
 * Given a source food item ID and the current user profile,
 * finds the top-N most similar items within the SAME K-Means cluster.
 *
 * CRITICAL CONSTRAINTS enforced here:
 *   1. Cross-cluster substitution is ARCHITECTURALLY PREVENTED.
 *   2. DBSCAN -1 items are excluded unless clinical mode is active.
 *   3. The source item itself is excluded from results.
 *   4. Items conflicting with user allergies/restrictions are excluded.
 *
 * @param {string}   sourceItemId     — ID of the item to replace
 * @param {object}   userProfile      — { allergies[], restrictions[], mode }
 * @param {number}   topN             — number of candidates to return (default 3)
 * @param {boolean}  clinicalMode     — if true, DBSCAN -1 items are allowed
 * @returns {Array<{ item: object, score: number }>} sorted descending by score
 */
function findSwapCandidates(sourceItemId, userProfile, topN = 3, clinicalMode = false) {
  const sourceItem = FOOD_DATABASE.find(f => f.id === sourceItemId);
  if (!sourceItem) {
    console.warn(`[SwapEngine] Source item not found: ${sourceItemId}`);
    return [];
  }

  const sourceCluster = sourceItem.cluster;
  const sourceVector  = getNutritionalVector(sourceItem);

  // Filter candidates: same cluster, not the source, not DBSCAN -1 (unless clinical)
  const candidates = FOOD_DATABASE.filter(item => {
    if (item.id === sourceItemId)         return false; // exclude self
    if (item.cluster !== sourceCluster)   return false; // CROSS-CLUSTER PREVENTION
    if (!clinicalMode && item.dbscan < 0) return false; // DBSCAN guardrail

    // Allergen check
    if (userProfile.allergies && userProfile.allergies.length > 0) {
      const normalizedAllergies = userProfile.allergies.map(a => a.toLowerCase());
      const conflict = item.allergens.some(a => normalizedAllergies.includes(a.toLowerCase()));
      if (conflict) return false;
    }

    // Dietary restriction check
    if (userProfile.restrictions && userProfile.restrictions.length > 0) {
      const normalizedRestrictions = userProfile.restrictions.map(r => r.toLowerCase());
      for (const restriction of normalizedRestrictions) {
        const mapped = RESTRICTION_ALIASES[restriction] || restriction;
        if (mapped && !item.restrictions.includes(mapped)) return false;
      }
    }

    return true;
  });

  // Score each candidate via cosine similarity
  const scored = candidates.map(item => ({
    item,
    score: cosineSimilarity(sourceVector, getNutritionalVector(item)),
  }));

  // Sort descending by score, return top N
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

/* ============================================================
   SECTION 12 — USER PROFILE STATE OBJECT
   Single source of truth for the current session.
   Never stored in cookies or localStorage beyond API key.
============================================================ */

/**
 * Creates a clean, empty user profile object.
 * Fields are set to null until explicitly answered.
 * Arrays are initialized to null (not []) so the FSM can
 * distinguish between "not yet asked" and "answered with empty/none".
 * @returns {object}
 */
function createEmptyProfile() {
  return {
    age:          null,   // number
    gender:       null,   // 'male' | 'female'
    weight:       null,   // number (kg)
    height:       null,   // number (cm)
    activityLevel:null,   // 'low' | 'moderate' | 'high'
    allergies:    null,   // string[] | []  (null = not yet asked)
    dislikes:     null,   // string[] | []
    restrictions: null,   // string[] | []
    // Computed after height is set:
    bmi:          null,
    bmiCategory:  null,
    bmrBase:      null,
    caloricTarget:null,
    // Session meta:
    mode:         'private',  // 'private' | 'clinical'
    detectedGender: null,     // from language semantics
  };
}

/* ============================================================
   SECTION 13 — FSM ENGINE CLASS
   The central state machine controlling the entire conversation.
   Instantiated once; UI layer (chatbot-ui.js) calls
   NutriAgentFSM.process(userInput) for each user message.
============================================================ */

class NutriAgentFSM {
  constructor() {
    this.state   = FSM_STATES.BOOT;
    this.profile = createEmptyProfile();
    this.editingField = null;       // Which field is being edited
    this.generatedPlan = null;      // Last generated meal plan JSON
    this.swapHistory = [];          // Array of swap log entries
    this.clinicalMode = false;      // Toggled by UI mode button
    this._pendingEditField = null;  // Temp holder during edit flow

    // Bind so external callers can reference the method directly
    this.process = this.process.bind(this);
  }

  /* ----------------------------------------------------------
     13.1 — MAIN ENTRY POINT
     Called by chatbot-ui.js for every user message.
     Returns a response descriptor object that the UI renders.
  ---------------------------------------------------------- */
  /**
   * @param {string} rawInput — raw string from the input field
   * @returns {Promise<object>} response descriptor
   */
  async process(rawInput) {
    const input = (rawInput || '').trim();

    // Language guard — reject non-Hebrew input at any stage
    if (input.length > 0 && isNonHebrew(input)) {
      return this._response(NON_HEBREW_RESPONSE, { type: 'warning' });
    }

    // Try to enrich detected gender from this message
    const detectedGender = detectGenderFromText(input);
    if (detectedGender && !this.profile.detectedGender) {
      this.profile.detectedGender = detectedGender;
    }

    // Route to current state handler
    switch (this.state) {
      case FSM_STATES.BOOT:
        return this._handleBoot();
      case FSM_STATES.GREETING:
        return this._handleGreeting(input);
      case FSM_STATES.AGE:
        return this._handleAge(input);
      case FSM_STATES.GENDER:
        return this._handleGender(input);
      case FSM_STATES.WEIGHT:
        return this._handleWeight(input);
      case FSM_STATES.HEIGHT:
        return this._handleHeight(input);
      case FSM_STATES.ACTIVITY:
        return this._handleActivity(input);
      case FSM_STATES.ALLERGIES:
        return this._handleAllergies(input);
      case FSM_STATES.DISLIKES:
        return this._handleDislikes(input);
      case FSM_STATES.RESTRICTIONS:
        return this._handleRestrictions(input);
      case FSM_STATES.SUMMARY:
        return this._handleSummary(input);
      case FSM_STATES.AWAITING_EDIT:
        return this._handleAwaitingEdit(input);
      case FSM_STATES.EDITING_FIELD:
        return this._handleEditingField(input);
      case FSM_STATES.GENERATING:
        return this._response('המערכת מייצרת כעת את תוכנית הארוחות. אנא המתן…', { type: 'info' });
      case FSM_STATES.MEAL_PLAN:
      case FSM_STATES.FOLLOWUP:
        return this._handleFollowup(input);
      default:
        return this._response('אירעה שגיאה פנימית. אנא רעננו את הדף.', { type: 'error' });
    }
  }

  /* ----------------------------------------------------------
     13.2 — BOOT: Initialize & greet
  ---------------------------------------------------------- */
  _handleBoot() {
    this.state = FSM_STATES.GREETING;
    const greeting = [
      '🌿 **ברוכים הבאים ל-NutriAgent**',
      '',
      'אני מערכת בינה מלאכותית לתמיכה תזונתית, מיועדת לילדים ובני נוער בגילאי 4–18.',
      '',
      '⚕️ **הצהרה חשובה:** מערכת זו היא כלי תמיכה בלבד ואינה מהווה תחליף לייעוץ מקצועי של תזונאי/ת מוסמך/ת או רופא/ה. המלצות המערכת מבוססות על נתונים כלליים ואינן מותאמות למצב רפואי ספציפי.',
      '',
      'כדי להתחיל, אשאל אותך מספר שאלות בסיסיות כדי להכיר את הפרופיל התזונתי.',
      '',
      '**מה גיל הילד/ה?**',
    ].join('\n');

    this.state = FSM_STATES.AGE;
    return this._response(greeting, {
      type: 'greeting',
      quickChips: ['4', '8', '12', '14', '16', '18'],
    });
  }

  /* ----------------------------------------------------------
     13.3 — GREETING: (transitional, rarely reached directly)
  ---------------------------------------------------------- */
  _handleGreeting(input) {
    this.state = FSM_STATES.AGE;
    return this._response('**מה גיל הילד/ה?** (גילאים 4–18)', {
      quickChips: ['4', '8', '10', '13', '16', '18'],
    });
  }

  /* ----------------------------------------------------------
     13.4 — AGE COLLECTION
     Strict validation: integer, range [4, 18].
  ---------------------------------------------------------- */
  _handleAge(input) {
    const age = parseInt(input.replace(/[^\d]/g, ''), 10);

    if (isNaN(age)) {
      return this._response(
        'לא הצלחתי לזהות גיל תקין. אנא הזן מספר שלם בלבד (לדוגמה: **12**).',
        { type: 'validation' }
      );
    }
    if (age < 4 || age > 18) {
      return this._response(
        `מערכת NutriAgent מותאמת לטווח גילאים **4 עד 18** בלבד.\n` +
        `הגיל שהוזן (${age}) אינו נמצא בטווח זה.\n` +
        `אנא הזן גיל בין 4 ל-18.`,
        { type: 'validation' }
      );
    }

    this.profile.age = age;
    this.state = FSM_STATES.GENDER;

    return this._response(
      `✅ גיל: **${age}**\n\n**מה המין?**\nאנא בחר: **זכר** או **נקבה**`,
      {
        quickChips: ['זכר', 'נקבה'],
        profileUpdate: { age },
      }
    );
  }

  /* ----------------------------------------------------------
     13.5 — GENDER COLLECTION
     Sets gender for morphological Hebrew + caloric baseline.
  ---------------------------------------------------------- */
  _handleGender(input) {
    let gender = null;

    const malePhrases  = ['זכר', 'בן', 'ילד', 'male', 'boy'];
    const femalePhrases = ['נקבה', 'בת', 'ילדה', 'female', 'girl'];

    const lc = input.toLowerCase();
    if (malePhrases.some(p => lc.includes(p)))   gender = 'male';
    if (femalePhrases.some(p => lc.includes(p))) gender = 'female';

    if (!gender) {
      return this._response(
        'לא הצלחתי לזהות את המין. אנא הזן **זכר** או **נקבה**.',
        { type: 'validation', quickChips: ['זכר', 'נקבה'] }
      );
    }

    this.profile.gender = gender;
    if (!this.profile.detectedGender) this.profile.detectedGender = gender;
    this.state = FSM_STATES.WEIGHT;

    const genderLabel = gender === 'male' ? 'זכר' : 'נקבה';
    return this._response(
      `✅ מין: **${genderLabel}**\n\n**מה המשקל?** (בקילוגרמים)`,
      {
        quickChips: ['20', '35', '45', '55', '65', '75'],
        profileUpdate: { gender: genderLabel },
      }
    );
  }

  /* ----------------------------------------------------------
     13.6 — WEIGHT COLLECTION
     Accepts numeric value in kg (4–200 range sanity check).
  ---------------------------------------------------------- */
  _handleWeight(input) {
    const weight = parseFloat(input.replace(/[^\d.]/g, ''));

    if (isNaN(weight) || weight < 10 || weight > 200) {
      return this._response(
        'אנא הזן משקל תקין בקילוגרמים (לדוגמה: **45** או **62.5**).',
        { type: 'validation' }
      );
    }

    this.profile.weight = weight;
    this.state = FSM_STATES.HEIGHT;

    return this._response(
      `✅ משקל: **${weight} ק"ג**\n\n**מה הגובה?** (בסנטימטרים)`,
      {
        quickChips: ['120', '140', '155', '165', '170', '180'],
        profileUpdate: { weight: `${weight} ק"ג` },
      }
    );
  }

  /* ----------------------------------------------------------
     13.7 — HEIGHT COLLECTION
     After height is received, triggers BMI/BMR computation.
  ---------------------------------------------------------- */
  _handleHeight(input) {
    const height = parseFloat(input.replace(/[^\d.]/g, ''));

    if (isNaN(height) || height < 80 || height > 220) {
      return this._response(
        'אנא הזן גובה תקין בסנטימטרים (לדוגמה: **155**).',
        { type: 'validation' }
      );
    }

    this.profile.height = height;

    // Trigger BMI / BMR computation
    const bmi = calculateBMI(this.profile.weight, height);
    const bmiCategory = getBMICategory(bmi, this.profile.age);
    const caloricData = calculateCaloricTarget(
      this.profile.age,
      this.profile.gender,
      'low',  // placeholder until activity is set; recalculated later
      bmiCategory
    );

    this.profile.bmi         = bmi;
    this.profile.bmiCategory = bmiCategory;
    this.profile.bmrBase     = caloricData.bmrBase;
    // caloricTarget finalized after activity step

    this.state = FSM_STATES.ACTIVITY;

    const bmiEmoji = {
      [BMI_CATEGORIES.UNDERWEIGHT]: '📉',
      [BMI_CATEGORIES.NORMAL]:      '✅',
      [BMI_CATEGORIES.OVERWEIGHT]:  '⚠️',
      [BMI_CATEGORIES.OBESE]:       '🔴',
    }[bmiCategory] || '📊';

    const bmiMessage = [
      `✅ גובה: **${height} ס"מ**`,
      '',
      '---',
      '📊 **חישוב ראשוני — BMI ו-BMR**',
      '',
      `• **BMI:** ${bmi} — ${bmiEmoji} **${bmiCategory}**`,
      `• **BMR בסיסי:** ~${caloricData.bmrBase} קק"ל/יום`,
      '',
      '*ערכים אלו יעודכנו לאחר קביעת רמת הפעילות.*',
      '---',
      '',
      '**מה רמת הפעילות הגופנית?**',
      '• **פעילות נמוכה** — בעיקר ישיבה, ללא פעילות ספורטיבית',
      '• **פעילות בינונית** — ספורט 2-3 פעמים בשבוע',
      '• **פעילות גבוהה** — ספורט יומי / אינטנסיבי',
    ].join('\n');

    return this._response(bmiMessage, {
      type: 'bmi_reveal',
      bmiData: { bmi, bmiCategory, bmrBase: caloricData.bmrBase },
      quickChips: ['פעילות נמוכה', 'פעילות בינונית', 'פעילות גבוהה'],
      profileUpdate: {
        height: `${height} ס"מ`,
        'BMI': `${bmi} (${bmiCategory})`,
      },
    });
  }

  /* ----------------------------------------------------------
     13.8 — ACTIVITY LEVEL COLLECTION
  ---------------------------------------------------------- */
  _handleActivity(input) {
    let activityId = null;

    const lc = input.toLowerCase();
    if (lc.includes('נמוכה') || lc.includes('נמוך'))      activityId = 'low';
    else if (lc.includes('בינונ'))                          activityId = 'moderate';
    else if (lc.includes('גבוהה') || lc.includes('גבוה'))  activityId = 'high';

    if (!activityId) {
      return this._response(
        'אנא בחר רמת פעילות: **פעילות נמוכה**, **פעילות בינונית**, או **פעילות גבוהה**.',
        { type: 'validation', quickChips: ['פעילות נמוכה', 'פעילות בינונית', 'פעילות גבוהה'] }
      );
    }

    this.profile.activityLevel = activityId;

    // Finalize caloric target now that activity is known
    const caloricData = calculateCaloricTarget(
      this.profile.age,
      this.profile.gender,
      activityId,
      this.profile.bmiCategory
    );
    this.profile.caloricTarget    = caloricData.finalTarget;
    this.profile.bmrBase          = caloricData.bmrBase;
    this.profile.caloricNarrative = buildCalorieNarrative(this.profile, {
      bmi:              this.profile.bmi,
      bmiCategory:      this.profile.bmiCategory,
      bmrBase:          caloricData.bmrBase,
      activityAdjusted: caloricData.activityAdjusted,
      finalTarget:      caloricData.finalTarget,
      scaleFactor:      caloricData.scaleFactor,
    });

    const activityLabel = ACTIVITY_LEVELS[activityId.toUpperCase()]?.label || activityId;
    this.state = FSM_STATES.ALLERGIES;

    return this._response(
      `✅ רמת פעילות: **${activityLabel}**\n` +
      `🎯 **יעד קלורי יומי מעודכן: ${caloricData.finalTarget} קק"ל**\n\n` +
      '**האם ישנן אלרגיות למזון?**\n' +
      'אנא פרט (לדוגמה: *אגוזים, חלב, ביצים*) — או השב **אין**.',
      {
        quickChips: ['אין', 'חלב', 'גלוטן', 'ביצים', 'אגוזים', 'דגים'],
        profileUpdate: {
          'פעילות': activityLabel,
          'יעד קלורי': `${caloricData.finalTarget} קק"ל/יום`,
        },
        metricsUpdate: {
          calorieTarget: caloricData.finalTarget,
          bmrBase: caloricData.bmrBase,
        },
      }
    );
  }

  /* ----------------------------------------------------------
     13.9 — ALLERGIES COLLECTION
     Parses comma-separated list or "אין" → empty array.
  ---------------------------------------------------------- */
  _handleAllergies(input) {
    const allergies = this._parseListInput(input);
    this.profile.allergies = allergies;
    this.state = FSM_STATES.DISLIKES;

    const allergiesDisplay = allergies.length > 0 ? allergies.join(', ') : 'אין';

    return this._response(
      `✅ אלרגיות: **${allergiesDisplay}**\n\n` +
      '**האם יש מאכלים שאינם אהובים?**\n' +
      'אנא פרט — או השב **אין**.',
      {
        quickChips: ['אין', 'בשר אדום', 'ירקות', 'דגים', 'ביצים'],
        profileUpdate: { 'אלרגיות': allergiesDisplay },
        tagsUpdate: { type: 'allergy', items: allergies },
      }
    );
  }

  /* ----------------------------------------------------------
     13.10 — DISLIKES COLLECTION
  ---------------------------------------------------------- */
  _handleDislikes(input) {
    const dislikes = this._parseListInput(input);
    this.profile.dislikes = dislikes;
    this.state = FSM_STATES.RESTRICTIONS;

    const dislikesDisplay = dislikes.length > 0 ? dislikes.join(', ') : 'אין';

    return this._response(
      `✅ אי-אהבות: **${dislikesDisplay}**\n\n` +
      '**האם ישנן הגבלות תזונתיות?**\n' +
      'לדוגמה: *צמחוני, טבעוני, כשר, ללא גלוטן, ללא לקטוז*\n' +
      'ניתן לציין מספר הגבלות, או להשיב **אין**.',
      {
        quickChips: ['אין', 'צמחוני', 'טבעוני', 'כשר', 'ללא גלוטן', 'ללא לקטוז'],
        profileUpdate: { 'דחיות': dislikesDisplay },
        tagsUpdate: { type: 'dislike', items: dislikes },
      }
    );
  }

  /* ----------------------------------------------------------
     13.11 — DIETARY RESTRICTIONS COLLECTION
     After this, transition to SUMMARY stage.
  ---------------------------------------------------------- */
  _handleRestrictions(input) {
    const restrictions = this._parseListInput(input);
    this.profile.restrictions = restrictions;
    this.state = FSM_STATES.SUMMARY;

    const restrictionsDisplay = restrictions.length > 0 ? restrictions.join(', ') : 'אין';

    return this._buildSummaryResponse(restrictionsDisplay);
  }

  /* ----------------------------------------------------------
     13.12 — SUMMARY STAGE
     Renders full profile summary and awaits עריכה / המשך.
  ---------------------------------------------------------- */
  _buildSummaryResponse(restrictionsDisplay) {
    const p = this.profile;
    const genderLabel   = p.gender === 'male' ? 'זכר' : 'נקבה';
    const activityLabel = Object.values(ACTIVITY_LEVELS)
      .find(a => a.id === p.activityLevel)?.label || p.activityLevel;

    const summaryLines = [
      `✅ הגבלות תזונתיות: **${restrictionsDisplay || 'אין'}**`,
      '',
      '---',
      '📋 **סיכום הפרופיל שנאסף**',
      '',
      `• **גיל:** ${p.age}`,
      `• **מין:** ${genderLabel}`,
      `• **משקל:** ${p.weight} ק"ג`,
      `• **גובה:** ${p.height} ס"מ`,
      `• **BMI:** ${p.bmi} (${p.bmiCategory})`,
      `• **רמת פעילות:** ${activityLabel}`,
      `• **יעד קלורי:** ${p.caloricTarget} קק"ל/יום`,
      `• **אלרגיות:** ${p.allergies?.join(', ') || 'אין'}`,
      `• **דחיות:** ${p.dislikes?.join(', ') || 'אין'}`,
      `• **הגבלות תזונתיות:** ${p.restrictions?.join(', ') || 'אין'}`,
      '',
      '---',
      `האם ${genderInflect(p.detectedGender || p.gender, 'אתה מוכן', 'את מוכנה')} להמשיך?`,
      '',
      '• הקלד **המשך** — ליצירת תוכנית הארוחות',
      '• הקלד **עריכה** — לעדכון פרט כלשהו',
    ].join('\n');

    return this._response(summaryLines, {
      type: 'summary',
      quickChips: ['המשך', 'עריכה'],
      profileUpdate: {
        'הגבלות': restrictionsDisplay || 'אין',
      },
      tagsUpdate: { type: 'restriction', items: this.profile.restrictions || [] },
    });
  }

  _handleSummary(input) {
    const lc = input.toLowerCase().trim();

    if (lc.includes('המשך') || lc === 'continue') {
      this.state = FSM_STATES.GENERATING;
      return this._response(
        `מעולה! ${genderInflect(this.profile.detectedGender || this.profile.gender, 'מתחיל', 'מתחילה')} ליצור את תוכנית הארוחות עבורך…\n` +
        '🧬 מפעיל מנוע K-Means ו-DBSCAN…\n' +
        '⚙️ מחשב פרמטרים תזונתיים…\n' +
        '🤖 שולח נתונים לבינה מלאכותית…',
        { type: 'generating', triggerGeneration: true }
      );
    }

    if (lc.includes('עריכה') || lc === 'edit') {
      this.state = FSM_STATES.AWAITING_EDIT;
      return this._response(
        '**איזה פרט תרצה לערוך?**\n\n' +
        '1. גיל\n2. מין\n3. משקל\n4. גובה\n5. פעילות\n6. אלרגיות\n7. דחיות\n8. הגבלות',
        {
          quickChips: ['גיל', 'מין', 'משקל', 'גובה', 'פעילות', 'אלרגיות', 'דחיות', 'הגבלות'],
        }
      );
    }

    // Unexpected input at summary stage
    return this._response(
      'אנא הקלד **המשך** לאישור ויצירת תוכנית הארוחות, או **עריכה** לעדכון נתון.',
      { quickChips: ['המשך', 'עריכה'] }
    );
  }

  /* ----------------------------------------------------------
     13.13 — EDIT FLOW
     Allows targeted re-collection of any single profile field.
  ---------------------------------------------------------- */
  _handleAwaitingEdit(input) {
    const lc = input.toLowerCase().trim();
    const fieldMap = {
      'גיל':      FSM_STATES.AGE,
      'מין':      FSM_STATES.GENDER,
      'משקל':     FSM_STATES.WEIGHT,
      'גובה':     FSM_STATES.HEIGHT,
      'פעילות':   FSM_STATES.ACTIVITY,
      'אלרגיות':  FSM_STATES.ALLERGIES,
      'דחיות':    FSM_STATES.DISLIKES,
      'הגבלות':   FSM_STATES.RESTRICTIONS,
    };

    let targetState = null;
    for (const [keyword, state] of Object.entries(fieldMap)) {
      if (lc.includes(keyword)) { targetState = state; break; }
    }

    // Also handle numeric selection (1-8)
    const numMatch = input.match(/^[1-8]$/);
    if (numMatch) {
      const numMap = ['age','gender','weight','height','activity','allergies','dislikes','restrictions'];
      const stateMap = [
        FSM_STATES.AGE, FSM_STATES.GENDER, FSM_STATES.WEIGHT, FSM_STATES.HEIGHT,
        FSM_STATES.ACTIVITY, FSM_STATES.ALLERGIES, FSM_STATES.DISLIKES, FSM_STATES.RESTRICTIONS,
      ];
      targetState = stateMap[parseInt(numMatch[0], 10) - 1];
    }

    if (!targetState) {
      return this._response(
        'לא זיהיתי את הפרט לעריכה. אנא בחר: גיל, מין, משקל, גובה, פעילות, אלרגיות, דחיות, או הגבלות.',
        {
          quickChips: ['גיל', 'מין', 'משקל', 'גובה', 'פעילות', 'אלרגיות', 'דחיות', 'הגבלות'],
        }
      );
    }

    this._pendingEditField = targetState;
    this.state = FSM_STATES.EDITING_FIELD;
    // Null the field so it gets re-collected
    this._clearProfileField(targetState);

    const fieldPrompts = {
      [FSM_STATES.AGE]:          'מה הגיל החדש? (4–18)',
      [FSM_STATES.GENDER]:       'מה המין? (זכר / נקבה)',
      [FSM_STATES.WEIGHT]:       'מה המשקל החדש? (בק"ג)',
      [FSM_STATES.HEIGHT]:       'מה הגובה החדש? (בס"מ)',
      [FSM_STATES.ACTIVITY]:     'מה רמת הפעילות? (נמוכה / בינונית / גבוהה)',
      [FSM_STATES.ALLERGIES]:    'האלרגיות החדשות? (רשימה מופרדת בפסיקים, או "אין")',
      [FSM_STATES.DISLIKES]:     'מה המאכלים שאינם אהובים? (או "אין")',
      [FSM_STATES.RESTRICTIONS]: 'מה ההגבלות התזונתיות? (או "אין")',
    };

    return this._response(fieldPrompts[targetState] || 'הזן את הערך החדש:', { type: 'edit' });
  }

  _handleEditingField(input) {
    // Re-route input through the appropriate handler,
    // then return to SUMMARY after field is updated.
    const field = this._pendingEditField;
    this.state = field;
    const response = this.process(input);

    // After the field handler runs, restore state to SUMMARY
    // unless the handler itself moved to another collection state
    return Promise.resolve(response).then(resp => {
      // If we're past the field state (it was valid), go to summary
      const collectionStates = [
        FSM_STATES.AGE, FSM_STATES.GENDER, FSM_STATES.WEIGHT,
        FSM_STATES.HEIGHT, FSM_STATES.ACTIVITY, FSM_STATES.ALLERGIES,
        FSM_STATES.DISLIKES, FSM_STATES.RESTRICTIONS,
      ];
      if (!collectionStates.includes(this.state)) {
        this.state = FSM_STATES.SUMMARY;
        this._pendingEditField = null;
        // Append a return-to-summary indicator
        resp._returnToSummary = true;
      }
      return resp;
    });
  }

  _clearProfileField(state) {
    const fieldClear = {
      [FSM_STATES.AGE]:          () => { this.profile.age = null; },
      [FSM_STATES.GENDER]:       () => { this.profile.gender = null; },
      [FSM_STATES.WEIGHT]:       () => { this.profile.weight = null; },
      [FSM_STATES.HEIGHT]:       () => { this.profile.height = null; this.profile.bmi = null; this.profile.bmiCategory = null; },
      [FSM_STATES.ACTIVITY]:     () => { this.profile.activityLevel = null; this.profile.caloricTarget = null; },
      [FSM_STATES.ALLERGIES]:    () => { this.profile.allergies = null; },
      [FSM_STATES.DISLIKES]:     () => { this.profile.dislikes = null; },
      [FSM_STATES.RESTRICTIONS]: () => { this.profile.restrictions = null; },
    };
    fieldClear[state]?.();
  }

  /* ----------------------------------------------------------
     13.14 — FOLLOW-UP CHAT (post meal-plan)
     Strictly scoped to questions about the generated plan.
  ---------------------------------------------------------- */
  _handleFollowup(input) {
    this.state = FSM_STATES.FOLLOWUP;
    // The actual AI call is handled in openaiclient.js via the UI layer.
    // Here we just return a trigger descriptor.
    return this._response('', {
      type: 'followup_query',
      query: input,
      triggerFollowup: true,
    });
  }

  /* ----------------------------------------------------------
     13.15 — UTILITY HELPERS
  ---------------------------------------------------------- */

  /**
   * Parses a comma/space-separated list from user input.
   * Returns empty array for "אין" or similar negations.
   * @param {string} input
   * @returns {string[]}
   */
  _parseListInput(input) {
    const negations = ['אין', 'לא', 'כלום', 'none', 'no', 'nothing', 'לא יודע', 'לא יודעת'];
    const trimmed = input.trim().toLowerCase();
    if (negations.some(n => trimmed === n || trimmed.includes(n))) return [];

    return input
      .split(/[,،،\n]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0 && !['אין', 'לא', 'לא יודע'].includes(s.toLowerCase()));
  }

  /**
   * Constructs a standardized response descriptor object.
   * @param {string} text — Hebrew message text (markdown supported)
   * @param {object} meta — additional metadata for the UI layer
   * @returns {object}
   */
  _response(text, meta = {}) {
    return {
      text,
      timestamp: new Date().toISOString(),
      state:     this.state,
      profile:   { ...this.profile },
      ...meta,
    };
  }

  /* ----------------------------------------------------------
     13.16 — PUBLIC ACCESSORS (called by UI & openaiclient)
  ---------------------------------------------------------- */

  /** Returns a read-only snapshot of the current profile. */
  getProfile() { return { ...this.profile }; }

  /** Returns the current FSM state string. */
  getState() { return this.state; }

  /** Sets clinical mode (affects DBSCAN guardrail in swap engine). */
  setClinicalMode(enabled) {
    this.clinicalMode = !!enabled;
    this.profile.mode = enabled ? 'clinical' : 'private';
  }

  /** Called by UI when a meal plan is successfully generated & rendered. */
  onPlanGenerated(planJson) {
    this.generatedPlan = planJson;
    this.state = FSM_STATES.MEAL_PLAN;
  }

  /** Transitions to follow-up chat state. */
  enterFollowupMode() {
    this.state = FSM_STATES.FOLLOWUP;
  }

  /**
   * Public swap interface called by UI swap buttons.
   * Delegates to findSwapCandidates with current profile context.
   * @param {string} sourceItemId
   * @param {number} topN
   * @returns {Array<{ item, score }>}
   */
  getSwapCandidates(sourceItemId, topN = 3) {
    return findSwapCandidates(
      sourceItemId,
      this.profile,
      topN,
      this.clinicalMode
    );
  }

  /**
   * Logs a swap action to the swap history.
   * @param {string} mealSlot — e.g. 'breakfast'
   * @param {string} fromName — original item name
   * @param {string} toName   — replacement item name
   */
  logSwap(mealSlot, fromName, toName) {
    this.swapHistory.push({
      mealSlot,
      from: fromName,
      to: toName,
      timestamp: new Date().toLocaleTimeString('he-IL'),
    });
  }

  /** Returns a copy of the swap history log. */
  getSwapHistory() { return [...this.swapHistory]; }

  /** Resets the FSM for a fresh session. */
  reset() {
    this.state        = FSM_STATES.BOOT;
    this.profile      = createEmptyProfile();
    this.editingField = null;
    this.generatedPlan = null;
    this.swapHistory  = [];
    this._pendingEditField = null;
  }
}

/* ============================================================
   SECTION 14 — DIETARY COMPLIANCE VALIDATOR
   Post-generation scan: checks the AI-returned JSON for
   violations against user's gluten-free / lactose-free tags.
   Called by openaiclient.js before rendering.
============================================================ */

const GLUTEN_KEYWORDS   = ['חיטה','שיבולת','לחם','פיתה','פסטה','קוסקוס','סולת','עוגה','עוגיה','קמח','לביבה','פנקייק','קרקר','מצה','בורגול'];
const LACTOSE_KEYWORDS  = ['חלב','גבינה','יוגורט','שמנת','קצפת','חמאה','מוצרלה','פרמזן','בולגרית','צהובה','קשקבל','גבינת'];

/**
 * Validates a generated meal plan JSON against user restrictions.
 * Returns an object describing any violations found.
 *
 * @param {object} planJson   — the parsed API response JSON
 * @param {object} profile    — current user profile
 * @returns {{ valid: boolean, violations: string[] }}
 */
function validateMealPlanCompliance(planJson, profile) {
  const violations = [];
  const restrictions = (profile.restrictions || []).map(r => r.toLowerCase());
  const isGlutenFree   = restrictions.some(r => r.includes('גלוטן') || r === 'gluten-free');
  const isLactoseFree  = restrictions.some(r => r.includes('לקטוז') || r === 'lactose-free');

  if (!isGlutenFree && !isLactoseFree) return { valid: true, violations: [] };

  const mealPlan = planJson?.meal_plan || {};
  const mealSlots = Object.entries(mealPlan);

  for (const [slot, meal] of mealSlots) {
    const text = `${meal.name || ''} ${meal.description || ''}`.toLowerCase();

    if (isGlutenFree) {
      for (const keyword of GLUTEN_KEYWORDS) {
        if (text.includes(keyword)) {
          violations.push(`⚠️ ארוחת ${slot}: נמצא מרכיב גלוטן ("${keyword}") בניגוד להגבלה ללא גלוטן`);
        }
      }
    }

    if (isLactoseFree) {
      for (const keyword of LACTOSE_KEYWORDS) {
        if (text.includes(keyword)) {
          violations.push(`⚠️ ארוחת ${slot}: נמצא מרכיב לקטוז ("${keyword}") בניגוד להגבלה ללא לקטוז`);
        }
      }
    }
  }

  return { valid: violations.length === 0, violations };
}

/* ============================================================
   SECTION 15 — GLOBAL EXPORTS
   Expose the FSM instance, utility functions, and constants
   to the UI and API client modules.
============================================================ */

// Singleton FSM instance
const nutriAgentFSM = new NutriAgentFSM();

// Freeze & expose to global scope for inter-module access
window.NutriAgent = Object.freeze({
  // FSM instance
  fsm: nutriAgentFSM,

  // Constants
  FSM_STATES,
  ACTIVITY_LEVELS,
  BMI_CATEGORIES,
  KMEANS_CLUSTERS,

  // Database
  FOOD_DATABASE,
  RESTRICTION_ALIASES,

  // Calculation utilities
  calculateBMI,
  getBMICategory,
  calculateCaloricTarget,
  buildCalorieNarrative,

  // Swap engine
  findSwapCandidates,
  cosineSimilarity,
  getNutritionalVector,

  // Language utilities
  detectGenderFromText,
  genderInflect,
  isNonHebrew,
  containsHebrew,
  NON_HEBREW_RESPONSE,

  // Compliance
  validateMealPlanCompliance,
});

console.log(
  '%c🌿 NutriAgent FSM Engine Loaded',
  'color:#4ade80;font-weight:bold;font-size:14px',
  '| States:', Object.keys(FSM_STATES).length,
  '| Food DB items:', FOOD_DATABASE.length,
  '| DBSCAN -1 blocked:', FOOD_DATABASE.filter(f => f.dbscan < 0).length,
);
