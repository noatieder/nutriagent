# 🌿 NutriAgent — מערכת תמיכה תזונתית קלינית חכמה

> **פלטפורמה דו-מצבית לתזונאים קליניים ומשתמשים פרטיים בוגרים (18+)**

![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-F7DF1E?style=flat&logo=javascript&logoColor=black)
![HTML5](https://img.shields.io/badge/HTML5-Vanilla-E34F26?style=flat&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-RTL-1572B6?style=flat&logo=css3&logoColor=white)
![Gemini](https://img.shields.io/badge/Google_Gemini-2.5_Flash-4285F4?style=flat&logo=google&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green?style=flat)

---

## 📋 תוכן עניינים

- [סקירה כללית](#סקירה-כללית)
- [תכונות מרכזיות](#תכונות-מרכזיות)
- [ארכיטקטורה טכנית](#ארכיטקטורה-טכנית)
- [מבנה הפרויקט](#מבנה-הפרויקט)
- [התקנה והרצה](#התקנה-והרצה)
- [זרימת המערכת](#זרימת-המערכת)
- [מודלים של Data Science](#מודלים-של-data-science)
- [מקרי בדיקה](#מקרי-בדיקה)
- [אבטחה ופרטיות](#אבטחה-ופרטיות)
- [הצהרת רפואית](#הצהרת-רפואית)

---

## סקירה כללית

**NutriAgent** היא מערכת בינה מלאכותית לתמיכה תזונתית המשלבת:

- **Finite State Machine (FSM)** לאיסוף נתונים סדרתי קפדני — 18 מצבים
- **חישוב BMR — Mifflin-St Jeor** לבוגרים (גיל 18+): `10×משקל + 6.25×גובה − 5×גיל ± offset`
- **WHO Adult BMI Classification** — תת משקל / תקין / עודף / השמנה
- **מסד נתונים מוטמע** מבוסס USDA National Nutrient Database — 130+ פריטים
- **K-Means Clustering** — K=4 אשכולות מאקרו-נוטריאנטים (Silhouette=0.582)
- **DBSCAN Guardrails** — 6 פריטים חריגים חסומים אוטומטית למשתמשים פרטיים
- **Cosine Similarity Engine** — החלפות ארוחות חכמות תוך-אשכוליות בלבד
- **Google Gemini 2.5 Flash API** — יצירת תוכניות ארוחות עם JSON schema מחייב
- **ממשק עברית מלא** עם נטייה מגדרית דינמית (זכר/נקבה)
- **NutriLogger** — תשתית לוגים מובנית לדיבאג עם `nutriLogs()` בקונסול

---

## תכונות מרכזיות

### 👤 מצב משתמש פרטי
- שיחה אינטראקטיבית בעברית תקנית עם chips מהירים לכל שאלה
- איסוף 8 פרמטרים תזונתיים בסדר קפדני עם ולידציה מלאה
- BMI ו-BMR מיידיים לאחר הזנת גובה ומשקל (Mifflin-St Jeor)
- תוכנית ארוחות יומית ל-6 ארוחות עם תגי K-Means
- החלפת ארוחות חכמה — Cosine Similarity תוך-אשכולית בלבד
- צ'אט המשך ייעודי (Q&A) מוגבל לתוכנית שנוצרה
- גילוי בקשות מחוץ לדומיין (TC-06) עם הודעת שגיאה מובנת

### 🩺 מצב תזונאי קליני
- גישה מורחבת לנתונים גולמיים: BMR, K-Means clusters, מאקרו-נוטריאנטים
- יומן ביקורת (Clinical Audit Log) מפורט
- צפייה בפריטי DBSCAN -1 (חסומים למשתמשים פרטיים)
- סיכום קליני טכני לתיק המטופל

### 📊 לוח תוצאות (Dashboard)
- 6 כרטיסי ארוחה עם שעות מומלצות ותגי K-Means
- כפתור החלפת ארוחה עם מודאל Cosine Similarity
- פירוט קלורי קליני (Mifflin-St Jeor breakdown)
- סכם DBSCAN ואישור ציות לאילוצים
- אזור Q&A מוטמע לשאלות המשך — גלוי ישירות מתחת לתוכנית
- כפתור הדפסה/PDF

### 🧬 אשכולות K-Means — אינטראקטיביים
- לחיצה על כל אשכול (0–3) בסרגל הצד הימני פותחת טבלה מלאה
- הטבלה מציגה את כל פריטי המזון: קלוריות, חלבון, שומן, פחמימות, סיבים, גודל מנה, סטטוס DBSCAN

---

## ארכיטקטורה טכנית

```
┌─────────────────────────────────────────────────────┐
│                   index-2.html                       │
│         Shell + RTL Layout + Accessibility           │
└──────────────────────┬──────────────────────────────┘
                       │
        ┌──────────────▼──────────────┐
        │       chatbot-ui.js         │
        │   UI Controller & DOM       │
        │   Toast / Modal / Swap UI   │
        │   Follow-up Q&A Section     │
        │   K-Means Cluster Tables    │
        └──────┬───────────┬──────────┘
               │           │
    ┌──────────▼──┐    ┌───▼──────────────────┐
    │ chatbot.js  │    │   geminiclient.js     │
    │ FSM Engine  │    │  Gemini 2.5 Flash API │
    │ BMR/BMI Calc│    │  Prompt Builder       │
    │ Food DB 130+│    │  DBSCAN Scan          │
    │ K-Means/DBSCAN   │  Compliance Retry x3  │
    │ Cosine Sim  │    │  TC-06 off-domain     │
    └─────────────┘    └──────────────────────┘
         ↑
    nutrilogger.js
    (debug infrastructure)
```

### FSM — 18 מצבים סדרתיים

```
BOOT → AGE → GENDER → WEIGHT → HEIGHT
  → ACTIVITY → ALLERGIES → DISLIKES → RESTRICTIONS
  → SUMMARY → [AWAITING_EDIT / EDITING_FIELD]
  → GENERATING → MEAL_PLAN → FOLLOWUP
```

### Auth & Storage
- **Google Gemini API** — header `X-goog-api-key` (לא query param)
- **sessionStorage** — מפתח נמחק עם סגירת הטאב
- **אין backend** — כל העיבוד client-side

---

## מבנה הפרויקט

```
nutriagent/
├── index-2.html        # שלד האפליקציה המלא (RTL עברית)
├── style.css           # מערכת עיצוב קלינית-מודרנית RTL (2400+ שורות)
├── chatbot.js          # מנוע FSM + Food DB + Mifflin-St Jeor + Cosine Sim
├── geminiclient.js     # Gemini 2.5 Flash API client + prompt engineering
├── chatbot-ui.js       # UI controller + DOM + modal + swap + cluster tables
├── nutrilogger.js      # Debug logger (nutriLogs() בקונסול)
├── datasets/
│   ├── 01_food_database_full.xlsx       # USDA raw → cleaned
│   ├── 02_food_database_chatbot.xlsx    # 130+ פריטי הצ'אטבוט
│   ├── 03_kmeans_clustering_results.xlsx
│   ├── 04_similarity_comparison.xlsx   # Cosine vs Jaccard
│   ├── 05_bmi_growth_charts.xlsx
│   └── 06_test_cases.xlsx              # TC-01 עד TC-06
├── docs/
│   ├── pseudocode.md
│   └── model_comparison.md             # Gemini Flash vs Pro
├── tests/
│   └── test_nutriagent.js
├── .gitignore
└── README.md
```

---

## התקנה והרצה

### דרישות מקדימות
- דפדפן מודרני (Chrome 100+, Firefox 95+, Safari 15+, Edge 100+)
- מפתח API של Google Gemini (מהדורה חינמית תומכת)
- חיבור אינטרנט

### הרצה מקומית

```bash
# 1. שיבוט הריפו
git clone https://github.com/noatieder/nutriagent.git
cd nutriagent

# 2. פתיחה בדפדפן — ללא צורך בשרת!
open index-2.html
# או: גרור את index-2.html לדפדפן
```

### הגדרת מפתח API

1. גש ל-[Google AI Studio](https://aistudio.google.com/apikey) וצור מפתח
2. פתח את האפליקציה — יופיע מסך הגדרת מפתח
3. הזן מפתח Gemini תקין (`AIza...`)
4. לחץ "הפעל את NutriAgent"

> 🔒 המפתח נשמר ב-`sessionStorage` בלבד ונמחק עם סגירת הטאב.  
> לעולם אינו עובר לשרת כלשהו מלבד שרתי Google.

### דיבאג
```javascript
// בקונסול הדפדפן:
nutriLogs()           // כל הלוגים
nutriLogs('API')      // לוגים של API בלבד
nutriLogs('FSM')      // לוגים של FSM בלבד
```

---

## זרימת המערכת

### שלב 1 — איסוף נתונים (8 שדות חובה)
| שדה | ולידציה |
|-----|---------|
| גיל | מספר שלם, טווח **18–120** |
| מין | זכר / נקבה |
| משקל | ק"ג, 10–200 |
| גובה | ס"מ, 130–220 |
| רמת פעילות | נמוכה (+0) / בינונית (+200) / גבוהה (+400 קק"ל) |
| אלרגיות | רשימה חופשית / אין |
| דחיות | רשימה חופשית / אין |
| הגבלות | צמחוני / טבעוני / כשר / ללא גלוטן / ללא לקטוז / אין |

### שלב 2 — חישובים פיזיולוגיים (Mifflin-St Jeor)
```
BMR_זכר   = 10×משקל + 6.25×גובה − 5×גיל + 5
BMR_נקבה  = 10×משקל + 6.25×גובה − 5×גיל − 161
יעד_קלורי = (BMR + דלתא_פעילות) × מכפיל_BMI
```

| קטגוריית BMI (WHO) | סף | מכפיל קלורי |
|--------------------|-----|------------|
| תת משקל (< 18.5) | — | ×1.175 (+17.5%) |
| משקל תקין (< 25.0) | — | ×1.000 |
| עודף משקל (< 30.0) | — | ×0.875 (−12.5%) |
| השמנת יתר (≥ 30.0) | — | ×0.825 (−17.5%) |

### שלב 3 — יצירת תוכנית (Gemini 2.5 Flash)
1. בדיקת סתירה לוגית לפני קריאת API (TC-05)
2. בניית System Prompt קליני עם פרופיל מלא + K-Means schema
3. קריאת Gemini API עם `responseMimeType: application/json`
4. סריקת DBSCAN -1 על התגובה
5. ולידציית ציות לאלרגיות/הגבלות
6. Retry אוטומטי עד 3 ניסיונות עם הנחיות תיקון

---

## מודלים של Data Science

### K-Means — 4 אשכולות מזון (Silhouette=0.582)

| אשכול | צבע | שם | מאפיינים | דוגמאות |
|-------|-----|-----|---------|---------|
| 0 | 🔵 Cyan | נפח/הידרציה | קלוריות נמוכות, סיבים גבוהים | עלים ירוקים, פירות טריים, מרקים |
| 1 | 🟢 Green | חלבון רזה | חלבון גבוה, שומן נמוך | חזה עוף, טונה, קוד, קטניות |
| 2 | 🟡 Gold | שומנים בריאים | שומן גבוה, אנרגיה צפופה | אבוקדו, אגוזים, טחינה, זרעים |
| 3 | 🟣 Purple | פחמימות מורכבות | פחמימות גבוהות, סיבים | אורז מלא, קינואה, כוסמין |

> 💡 **חדש**: לחיצה על כל שורה בסרגל K-Means שמאלה פותחת טבלה מלאה של כל פריטי האשכול.

### DBSCAN — זיהוי חריגים
- **6 פריטים** מסווגים כ-Cluster -1 (3.15% מהבסיס)
- פריטים חסומים: אבקות חלבון תעשייתיות, שמן דקלים, סירופ גלוקוז, מרגרינה טרנס, מאס גיינר, חלב מרוכז
- חסימה אוטומטית למשתמשים פרטיים — גלויים בלבד למצב קליני

### Cosine Similarity — מנוע החלפות
```javascript
// וקטור 6 מימדי לכל פריט מזון (per serving):
vector = [calories, protein, fat, carbs, fiber, sugar]

// כלל ארכיטקטוני: החלפה תוך-אשכולית בלבד!
// אשכול 1 → אשכול 1 בלבד (חזה עוף ↔ טונה / פילה קוד / הודו)
// מניעה מוחלטת של החלפה בין אשכולות שונים
```

---

## מקרי בדיקה

| TC | תיאור | תוצאה צפויה |
|----|-------|------------|
| TC-01 | מבוגר בריא | תפריט ~2000 קק"ל |
| TC-02 | מבוגרת עודף משקל | תפריט מופחת ~1600 קק"ל |
| TC-03 | מבוגר עם אלרגיות (גלוטן + חלב) | תפריט מותאם ללא גלוטן/לקטוז |
| TC-04 | מבוגרת טבעונית | תפריט ~2200 קק"ל מהצומח בלבד |
| TC-05 | **כשל 1**: טבעוני + דחיית כל חלבוני הצומח | FSM מזהה סתירה לוגית → עריכה |
| TC-06 | **כשל 2**: שאלה מחוץ לדומיין ("המלץ על שיר") | Gemini → `[OFF_DOMAIN]` → הודעת שגיאה |

---

## אבטחה ופרטיות

- ✅ מפתח API מאוחסן ב-`sessionStorage` בלבד (נמחק עם סגירת הטאב)
- ✅ אין שרת backend — כל העיבוד client-side
- ✅ אין שמירת היסטוריית שיחות
- ✅ אין cookies או tracking
- ✅ תקשורת ישירה בלעדית עם Google Gemini API
- ✅ `X-goog-api-key` header auth — לא query param
- ⚠️ מומלץ להשתמש במפתח API ייעודי עם הגבלת שימוש ב-Google AI Studio

---

## הצהרת רפואית

> ⚕️ **NutriAgent הוא כלי תמיכה בלבד.**  
> המערכת אינה מהווה תחליף לייעוץ תזונאי מוסמך, רופא, או איש מקצוע בתחום הבריאות.  
> ההמלצות מבוססות על נתונים כלליים ואינן מותאמות למצב רפואי ספציפי.  
> בכל שאלה רפואית יש לפנות לאיש מקצוע מוסמך.

---

## רישיון

MIT License — ראה קובץ `LICENSE` לפרטים.

---

<div align="center">
  נועה טידר & גאיה קישון | NutriAgent © 2026 | Gemini 2.5 Flash
</div>
