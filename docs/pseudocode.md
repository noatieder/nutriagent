# NutriAgent — Pseudo-code מקצה לקצה

**מחברות:** נועה טידר & גאיה קישון  
**מטרה:** תיאור אלגוריתמי של הפתרון המלא, מאיסוף נתונים ועד ייצור תפריט ותחלופת ארוחות

---

## ALGORITHM NutriAgent — End-to-End Flow

```
INPUT:  שיחת משתמש בעברית (טקסט חופשי)
OUTPUT: תוכנית ארוחות יומית מותאמת אישית (6 ארוחות, JSON)

═══════════════════════════════════════════════════════════
PHASE 1 — DATA COLLECTION (FSM — 14 Sequential States)
═══════════════════════════════════════════════════════════

state ← BOOT
profile ← emptyProfile()

FOR each state in [AGE, GENDER, WEIGHT, HEIGHT, ACTIVITY, ALLERGIES, DISLIKES, RESTRICTIONS]:

  prompt_user(state)
  input ← getUserInput()

  VALIDATE input:
    IF state = AGE:
      IF NOT (4 ≤ parseInt(input) ≤ 18) → reject("גיל חייב להיות בין 4 ל-18")
    IF state = WEIGHT:
      IF NOT (10 ≤ parseInt(input) ≤ 200) → reject("משקל לא תקין")
    IF state = HEIGHT:
      IF NOT (80 ≤ parseInt(input) ≤ 220) → reject("גובה לא תקין")
    IF state = GENDER:
      IF NOT (input ∈ {זכר, נקבה, male, female}) → reject("אנא בחר זכר או נקבה")

  store(profile, state, input)

  ON HEIGHT stored:
    ─── BMI Calculation ───
    BMI ← weight_kg / (height_cm / 100)²
    bmiCategory ← lookup(BMI_THRESHOLDS_BY_AGE[age])
      // CDC Growth Charts: underweight | normal | overweight | obese

    ─── Caloric Target Calculation ───
    ageBracket ← IF age ∈ [4,8] THEN "4-8"
                 ELSE IF age ∈ [9,13] THEN "9-13"
                 ELSE "14-18"
    bmrBase       ← BASE_CALORIES[gender][ageBracket]
    activityDelta ← {low: 0, moderate: +200, high: +400}[activityLevel]
    bmiScale      ← {תת משקל: 1.175, תקין: 1.0, עודף: 0.875, השמנה: 0.825}[bmiCategory]
    caloricTarget ← (bmrBase + activityDelta) × bmiScale

  advance(state)

DISPLAY summary(profile) → ask user: המשך | עריכה


═══════════════════════════════════════════════════════════
PHASE 2 — CONTRADICTION DETECTION (TC-05 Failure Scenario)
═══════════════════════════════════════════════════════════

FUNCTION detectContradiction(profile):

  isVegan ← 'טבעוני' ∈ profile.restrictions

  IF isVegan:
    veganSources ← [טופו, קטניות, עדשים, חומוס, שעועית, אפונה]
    blockedSources ← veganSources ∩ profile.dislikes

    IF |blockedSources| ≥ 4:
      RETURN { contradiction: TRUE,
               message: "זוהתה סתירה לוגית — טבעוני שדחה את כל מקורות החלבון הצמחי" }

  isVegetarian ← 'צמחוני' ∈ profile.restrictions
  IF isVegetarian AND profile.dislikes ⊇ {חלב, גבינה, יוגורט, ביצה}:
    RETURN { contradiction: TRUE,
             message: "צמחוני שדחה גם חלב וגם ביצים — שקול לשנות לטבעוני" }

  RETURN { contradiction: FALSE }

IF detectContradiction(profile).contradiction:
  displayError(message)
  return to SUMMARY state   // Do NOT transition to GENERATING
  // User must correct dislikes or restrictions before proceeding


═══════════════════════════════════════════════════════════
PHASE 3 — FOOD FILTERING (K-Means + DBSCAN guardrails)
═══════════════════════════════════════════════════════════

allowedFoods ← FOOD_DATABASE
  .filter(item → item.dbscan ≠ -1)           // Remove DBSCAN outliers
  .filter(item → ¬matchesAllergies(item, profile.allergies))
  .filter(item → ¬blockedByRestrictions(item, profile.restrictions))
  .filter(item → ¬inDislikes(item, profile.dislikes))

groupedByCluster ← {
  0: allowedFoods.filter(cluster=0),   // נפח/ירקות
  1: allowedFoods.filter(cluster=1),   // חלבון רזה
  2: allowedFoods.filter(cluster=2),   // שומנים בריאים
  3: allowedFoods.filter(cluster=3),   // פחמימות מורכבות
}

caloricDistribution ← {
  breakfast:       caloricTarget × 0.25,
  morning_snack:   caloricTarget × 0.10,
  lunch:           caloricTarget × 0.30,
  afternoon_snack: caloricTarget × 0.10,
  dinner:          caloricTarget × 0.20,
  evening_snack:   caloricTarget × 0.05,
}


═══════════════════════════════════════════════════════════
PHASE 4 — MEAL PLAN GENERATION (Gemini Flash API)
═══════════════════════════════════════════════════════════

systemPrompt ← buildSystemPrompt(profile, groupedByCluster, caloricDistribution)
// System prompt encodes: user profile, caloric targets, K-Means cluster names,
// DBSCAN blocked terms, dietary restrictions, and JSON schema

retryCount ← 0
WHILE retryCount ≤ MAX_RETRIES (3):

  ── Step 4a: API Call ──
  rawResponse ← await GeminiFlash(
    model:              "gemini-2.0-flash",
    system_instruction: systemPrompt,
    contents:           [{ role: "user", text: userPrompt }],
    generationConfig:   { responseMimeType: "application/json", temperature: 0.4 }
  )

  // TC-06: Check for off-domain detection
  IF rawResponse.startsWith("[OFF_DOMAIN]"):
    RETURN { error: true, message: rawResponse.replace("[OFF_DOMAIN]","") }
    UI displays error bubble

  ── Step 4b: JSON Parsing ──
  planJson ← parseJSON(rawResponse)
  IF parseError: retryCount++; continue

  ── Step 4c: Structure Validation ──
  missingFields ← validateStructure(planJson)  // Checks 6 meal slots + required fields
  IF missingFields ≠ ∅: retryCount++; continue

  ── Step 4d: DBSCAN -1 Content Scan ──
  outlierTerms ← scanForDBSCANTerms(planJson)
  IF outlierTerms ≠ ∅ AND mode ≠ "clinical": retryCount++; continue

  ── Step 4e: Dietary Compliance ──
  violations ← validateCompliance(planJson, profile)
  // Checks: allergens, gluten keywords, lactose keywords, vegan rules
  IF violations ≠ ∅: retryCount++; continue

  // All validations passed
  RETURN { success: true, planJson }

RETURN { error: "MAX_RETRIES_EXCEEDED" }


═══════════════════════════════════════════════════════════
PHASE 5 — SMART SWAP ENGINE (Cosine Similarity)
═══════════════════════════════════════════════════════════

FUNCTION findSwapCandidates(sourceItemId, userProfile, topN=3):

  source ← FOOD_DATABASE[sourceItemId]
  sourceCluster ← source.cluster
  sourceVector  ← getNutritionalVector(source)
    // Vector = [calories, protein, fat, carbs, fiber, sugar] × (servingSizeG / 100)

  candidates ← FOOD_DATABASE
    .filter(item → item.cluster = sourceCluster)   // SAME CLUSTER ONLY — prevents illogical swaps
    .filter(item → item.id ≠ sourceItemId)
    .filter(item → item.dbscan ≠ -1)              // No clinical-only items
    .filter(item → ¬allergyConflict(item, userProfile))

  FOR EACH candidate IN candidates:
    vecB ← getNutritionalVector(candidate)

    ── Cosine Similarity ──
    dotProduct ← Σ (sourceVector[i] × vecB[i])     for i in 0..5
    normA      ← √(Σ sourceVector[i]²)
    normB      ← √(Σ vecB[i]²)
    similarity ← dotProduct / (normA × normB)      // Range: [0, 1]

    candidate.score ← similarity

  RETURN candidates.sort(descending by score).take(topN)


═══════════════════════════════════════════════════════════
PHASE 6 — FOLLOW-UP Q&A (Scoped to Meal Plan)
═══════════════════════════════════════════════════════════

WHILE user sends follow-up messages (max 6 turns):

  IF ¬containsHebrew(input):
    RETURN languageGuardError("אנא פנה בעברית בלבד")

  systemPrompt ← buildFollowupPrompt(profile, planJson)
  // Includes: explicit instruction to return [OFF_DOMAIN] for non-nutrition queries

  response ← await GeminiFlash(chatHistory[-6:] + currentMessage)

  IF response.startsWith("[OFF_DOMAIN]"):
    // TC-06 failure scenario — off-domain request detected
    displayErrorBubble(response.replace("[OFF_DOMAIN]",""))  // Styled red bubble
    // Do NOT store in chat history (off-domain queries reset context)
  ELSE:
    displayNormalBubble(response)
    chatHistory.push({ question: input, answer: response })


═══════════════════════════════════════════════════════════
KEY CONSTANTS
═══════════════════════════════════════════════════════════

BASE_CALORIES:
  male:   { 4-8: 1400,  9-13: 1800,  14-18: 2200 }
  female: { 4-8: 1300,  9-13: 1600,  14-18: 1800 }

BMI_CALORIE_SCALE:
  תת משקל:   × 1.175  (+17.5%)
  משקל תקין: × 1.000   (0%)
  עודף משקל: × 0.875  (-12.5%)
  השמנת יתר: × 0.825  (-17.5%)

ACTIVITY_CALORIE_DELTA:
  נמוכה:   +0
  בינונית: +200
  גבוהה:   +400

K-MEANS CLUSTER MEMBERSHIP (Silhouette Score: 0.582):
  Cluster 0 — נפח/ירקות     (34 items): Low calories, high fiber, high water
  Cluster 1 — חלבון רזה    (31 items): High protein, low fat, low carbs
  Cluster 2 — שומנים בריאים (19 items): High fat, medium protein, medium carbs
  Cluster 3 — פחמימות מורכבות (26 items): High carbs, medium fiber
  DBSCAN -1 — Outliers        (6 items): Extreme nutritional profiles — blocked

GEMINI FLASH CONFIGURATION:
  Model:              gemini-2.0-flash
  Temperature:        0.4  (low variance for clinical consistency)
  responseMimeType:   application/json  (meal plan) | text/plain (follow-up)
  Max retries:        3
  Retry delay:        800ms
```

---

## Data Flow Diagram

```
User Input
    │
    ▼
┌─────────────────────────────────────────────┐
│  FSM (14 states)                             │
│  Collects: age, gender, weight, height,      │
│  activity, allergies, dislikes, restrictions │
└──────────────┬──────────────────────────────┘
               │ Profile validated
               ▼
┌─────────────────────────────────────────────┐
│  detectContradiction()  [TC-05]              │
│  → Logical conflict? → Error + Edit prompt   │
└──────────────┬──────────────────────────────┘
               │ No contradiction
               ▼
┌─────────────────────────────────────────────┐
│  Food Filtering                              │
│  FOOD_DATABASE (116 items)                   │
│  → Remove DBSCAN -1 outliers (6 items)       │
│  → Remove allergens                          │
│  → Remove restricted foods                  │
│  → Group by K-Means cluster (0–3)           │
└──────────────┬──────────────────────────────┘
               │ Allowed foods grouped by cluster
               ▼
┌─────────────────────────────────────────────┐
│  Gemini Flash API                            │
│  → JSON mode + system prompt                 │
│  → Validate JSON schema                      │
│  → DBSCAN scan                               │
│  → Dietary compliance check                  │
│  → Retry up to 3× if violations             │
└──────────────┬──────────────────────────────┘
               │ Valid meal plan JSON
               ▼
┌─────────────────────────────────────────────┐
│  Render Meal Plan UI                         │
│  6 meal cards + Swap buttons                 │
└──────────────┬──────────────────────────────┘
               │ User clicks "החלף"
               ▼
┌─────────────────────────────────────────────┐
│  Cosine Similarity Swap Engine              │
│  → Same cluster only                         │
│  → Rank by cosine similarity [0,1]          │
│  → Return top-3 alternatives                │
└─────────────────────────────────────────────┘
```
