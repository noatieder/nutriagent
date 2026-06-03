# 🌿 NutriAgent — מערכת תמיכה תזונתית חכמה

> **ממשק שיחה תזונתי אישי למשתמשים מגיל 16+ | מבוסס Groq Llama 3.3**

![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-F7DF1E?style=flat&logo=javascript&logoColor=black)
![HTML5](https://img.shields.io/badge/HTML5-Vanilla-E34F26?style=flat&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-RTL_Dark/Light-1572B6?style=flat&logo=css3&logoColor=white)
![Groq](https://img.shields.io/badge/Groq-Llama_3.3_70B-F55036?style=flat)
![License](https://img.shields.io/badge/License-MIT-green?style=flat)

---

## 📋 תוכן עניינים

- [סקירה כללית](#סקירה-כללית)
- [תכונות](#תכונות)
- [ארכיטקטורה](#ארכיטקטורה)
- [מבנה קבצים](#מבנה-קבצים)
- [התקנה והרצה](#התקנה-והרצה)
- [זרימת המערכת](#זרימת-המערכת)
- [מודלי Data Science](#מודלי-data-science)
- [מקרי בדיקה](#מקרי-בדיקה)
- [אבטחה ופרטיות](#אבטחה-ופרטיות)
- [הצהרה רפואית](#הצהרה-רפואית)

---

## סקירה כללית

**NutriAgent** היא אפליקציה client-side לתמיכה תזונתית אישית המשלבת:

| רכיב | פרטים |
|------|--------|
| **LLM** | Groq API — Llama 3.3 70B / 3.1 8B (בחירת המשתמש) |
| **FSM** | Finite State Machine עם 18 מצבים לאיסוף נתונים סדרתי |
| **BMR** | נוסחת Mifflin-St Jeor לבוגרים (גיל 16+) |
| **BMI** | סיווג WHO מבוגרים — תת משקל / תקין / עודף / השמנה |
| **Clustering** | K-Means K=4 (Silhouette=0.582) + DBSCAN guardrails |
| **Similarity** | Cosine Similarity תוך-אשכולית להחלפת ארוחות |
| **DB** | מסד מזון מוטמע 130+ פריטים מ-USDA National Nutrient Database |
| **UI** | עברית RTL מלאה, dark/light mode, responsive |

---

## תכונות

### 💬 שיחה תזונתית
- איסוף 8 שדות חובה בסדר קפדני עם validation מלא
- Chips מהירים לכל שאלה (גיל, מין, משקל, גובה, פעילות, אלרגיות, דחיות, הגבלות)
- זיהוי נטייה מגדרית דינמית (זכר/נקבה) לכל התגובות
- גילוי קונטרדיקציות לפני יצירת תוכנית (TC-05)
- דחיית בקשות מחוץ לדומיין בשאלות המשך (TC-06)
- הגבלות תזונתיות: `ללא גלוטן`, `ללא לקטוז`, `טבעוני`, `צמחוני`, `כשר`

### 📊 תוכנית ארוחות
- 6 ארוחות יומיות עם שעות מומלצות ופיזור קלורי מחויב
- ארוחות מותאמות תרבותית ותזמונית (בוקר ≠ צהריים ≠ ערב)
- תג K-Means לכל ארוחה (אשכול 0–3)
- כפתור "שנה ארוחה" — Cosine Similarity תוך-אשכולית
- סריקת DBSCAN -1 אוטומטית + retry עד 3 ניסיונות
- Q&A ייעודי מוטמע מתחת לתוכנית

### 🧬 K-Means Cluster Explorer
- לחיצה על כל אשכול (0–3) פותחת טבלה מלאה של כל פריטי המזון
- עמודות: שם עברי/אנגלי, קלוריות/100g, חלבון, שומן, פחמימות, סיבים, גודל מנה, סטטוס DBSCAN

### 🎨 UI/UX
- **Dark / Light Mode** — כפתור ☀️/🌙 בטופבר, נשמר ב-localStorage
- **↺ התחל מחדש** — כפתור בטופבר + לחיצה על הלוגו → modal אישור → איפוס מלא
- בחירת מודל Groq ב-dropdown (Llama 3.3 70B / 3.1 8B / SpDec)
- Typing indicator, toast notifications, modal dialogs
- BMI gauge + metrics sidebar
- היסטוריית החלפות ארוחות
- FSM progress indicator

### 🛠️ Developer Tools
- `nutrilogger.js` — לוגים מוצבעים ב-console: `nutriLogs()` / `nutriLogs('API')` / `nutriLogs('FSM')`
- `logserver.py` — שרת Python לסטרימינג לוגים לטרמינל בזמן אמת (dev only)

---

## ארכיטקטורה

```
┌─────────────────────────────────────────────────────────┐
│                     index-2.html                         │
│          RTL Hebrew Shell + Topbar + Layout              │
└────────────────────────┬────────────────────────────────┘
                         │
          ┌──────────────▼──────────────┐
          │        chatbot-ui.js         │
          │  DOM · Theme · Restart       │
          │  Chips · Swap UI · Modals    │
          │  Follow-up Q&A section       │
          │  K-Means cluster tables      │
          └──────┬────────────┬──────────┘
                 │            │
      ┌──────────▼──┐    ┌────▼─────────────────┐
      │ chatbot.js  │    │    groqclient.js       │
      │ FSM 18 states    │  Groq Llama 3.3/3.1   │
      │ BMR/BMI calc│    │  OpenAI-compat API     │
      │ Food DB 130+│    │  JSON enforcement      │
      │ K-Means/DBSCAN   │  Meal context prompt   │
      │ Cosine Sim  │    │  DBSCAN scan           │
      │ Contradiction    │  Compliance retry ×3   │
      └─────────────┘    └──────────────────────┘
              ↑
       nutrilogger.js  ←→  logserver.py (dev)
```

### FSM — 18 מצבים
```
BOOT → AGE → GENDER → WEIGHT → HEIGHT → ACTIVITY
  → ALLERGIES → DISLIKES → RESTRICTIONS → SUMMARY
  → [AWAITING_EDIT | EDITING_FIELD]
  → GENERATING → MEAL_PLAN → FOLLOWUP
```

---

## מבנה קבצים

```
nutriagent/
├── index-2.html          # שלד האפליקציה (RTL עברית)
├── style.css             # עיצוב dark + light theme (~2700 שורות)
├── chatbot.js            # FSM + Food DB + Mifflin-St Jeor + Cosine Sim
├── groqclient.js         # Groq API client + prompt engineering
├── chatbot-ui.js         # UI controller + theme + restart + cluster tables
├── nutrilogger.js        # Debug logger (relay לטרמינל ב-localhost)
├── logserver.py          # Dev log server (python3 logserver.py)
├── datasets/
│   ├── 01_food_database_full.xlsx
│   ├── 02_food_database_chatbot.xlsx
│   ├── 03_kmeans_clustering_results.xlsx
│   ├── 04_similarity_comparison.xlsx
│   ├── 05_bmi_growth_charts.xlsx
│   └── 06_test_cases.xlsx
├── docs/
│   ├── pseudocode.md
│   └── model_comparison.md
├── tests/test_nutriagent.js
├── .gitignore
└── README.md
```

---

## התקנה והרצה

### דרישות
- דפדפן מודרני (Chrome 100+ / Firefox 95+ / Safari 15+)
- מפתח API של [Groq](https://console.groq.com/keys) (חינם, ללא כרטיס אשראי)
- Python 3 (לשרת הלוגים בלבד — אופציונלי)

### הרצה מהירה

```bash
git clone https://github.com/noatieder/nutriagent.git
cd nutriagent

# פתח ישירות בדפדפן (ללא שרת):
open index-2.html

# -- או -- עם שרת לוגים לdebug:
python3 logserver.py
# → http://localhost:3131/index-2.html
```

### הגדרת מפתח API
1. גש ל-[console.groq.com/keys](https://console.groq.com/keys) → צור מפתח חינם
2. פתח את האפליקציה — יופיע מסך הגדרת מפתח
3. הזן מפתח Groq (`gsk_...`)
4. לחץ **הפעל את NutriAgent**

> 🔒 המפתח נשמר ב-`sessionStorage` בלבד — נמחק עם סגירת הטאב, לא נשלח לשום שרת מלבד Groq.

### Debug בטרמינל
```bash
# הרץ את שרת הלוגים:
python3 logserver.py

# בדפדפן, פתח http://localhost:3131/index-2.html
# כל log מהאפליקציה יופיע בטרמינל בזמן אמת (צבעוני)

# גם ישירות ב-Console:
nutriLogs()          # כל הלוגים
nutriLogs('API')     # רק API calls
nutriLogs('FSM')     # רק FSM transitions
nutriLogs('ERROR')   # רק שגיאות
```

---

## זרימת המערכת

### שלב 1 — איסוף נתונים (8 שדות, FSM)

| שדה | ולידציה | Chips מוצעים |
|-----|---------|-------------|
| גיל | **16–120** | 16, 22, 30, 40, 50, 60 |
| מין | זכר / נקבה | זכר, נקבה |
| משקל | 10–200 ק"ג | 55, 65, 75, 85, 95, 110 |
| גובה | 130–220 ס"מ | 155, 162, 168, 175, 182, 190 |
| פעילות | נמוכה/בינונית/גבוהה | 3 chips |
| אלרגיות | רשימה חופשית / אין | אין, חלב, גלוטן, ביצים… |
| דחיות | רשימה חופשית / אין | אין, בשר אדום, דגים… |
| הגבלות | `ללא גלוטן`, `ללא לקטוז`, `טבעוני`… | 6 chips |

### שלב 2 — חישוב פיזיולוגי (Mifflin-St Jeor)
```
BMR_זכר   = 10×משקל + 6.25×גובה − 5×גיל + 5
BMR_נקבה  = 10×משקל + 6.25×גובה − 5×גיל − 161
יעד_קלורי = (BMR + דלתא_פעילות) × מכפיל_BMI
```

| קטגוריית BMI (WHO) | ערך BMI | מכפיל |
|--------------------|---------|-------|
| תת משקל | < 18.5 | ×1.175 |
| משקל תקין | 18.5–24.9 | ×1.000 |
| עודף משקל | 25–29.9 | ×0.875 |
| השמנת יתר | ≥ 30.0 | ×0.825 |

### שלב 3 — יצירת תוכנית (Groq API)
1. בדיקת סתירה לוגית (TC-05) — לפני API
2. בניית System Prompt עם פרופיל מלא + כללי K-Means + **הגיון ארוחות**
3. קריאה ל-Groq עם `response_format: { type: "json_object" }`
4. סריקת DBSCAN -1 על התוצאה
5. ולידציית ציות לאלרגיות/הגבלות
6. Retry אוטומטי עד 3 ניסיונות עם הנחיות תיקון

---

## מודלי Data Science

### K-Means — 4 אשכולות (Silhouette=0.582)

| אשכול | צבע | שם | מאפיינים | דוגמאות |
|-------|-----|----|---------|---------|
| 0 | 🔵 | נפח/הידרציה | קלוריות נמוכות, סיבים | עלים, פירות, מרקים |
| 1 | 🟢 | חלבון רזה | חלבון גבוה, שומן נמוך | עוף, דגים, קטניות, ביצים |
| 2 | 🟡 | שומנים בריאים | שומן גבוה, אנרגיה | אגוזים, טחינה, אבוקדו |
| 3 | 🟣 | פחמימות מורכבות | פחמימות + סיבים | אורז מלא, קינואה, כוסמין |

> **K-Means Explorer:** לחיצה על כל שורה בסרגל הצד הימני פותחת טבלה מלאה עם כל פריטי האשכול.

### DBSCAN — 6 פריטי חריגים (-1)
חסומים אוטומטית: אבקות חלבון תעשייתיות, שמן דקלים, סירופ גלוקוז, מרגרינה טרנס, מאס גיינר, חלב מרוכז ממותק.

### Cosine Similarity — מנוע החלפות
```javascript
// וקטור 6 מימדי per serving:
vector = [calories, protein, fat, carbs, fiber, sugar]
// כלל ארכיטקטוני: החלפה תוך-אשכולית בלבד
// אשכול 1 ↔ אשכול 1 בלבד (עוף ↔ דג / קטניות)
```

### מודלי Groq (Free Tier)

| מודל | TPM | RPD | מתאים ל |
|------|-----|-----|---------|
| `llama-3.3-70b-versatile` ⭐ | 12,000 | 1,000 | JSON מורכב, ברירת מחדל |
| `llama-3.1-8b-instant` ⚡ | 6,000 | **14,400** | מהירות, כמות גדולה |
| `llama-3.3-70b-specdec` | 6,000 | 1,000 | מהיר ב-70B |

> Mixtral 8x7b ו-llama3-8192 deprecated (מרץ 2025).

---

## מקרי בדיקה

| TC | תיאור | גיל | תוצאה צפויה |
|----|-------|-----|------------|
| TC-01 | מבוגר בריא | 28 | תפריט ~2000 קק"ל |
| TC-02 | מבוגרת עודף משקל | 35 | תפריט מופחת ~1600 קק"ל |
| TC-03 | עם אלרגיות (גלוטן + חלב) | 22 | תפריט ללא גלוטן/לקטוז |
| TC-04 | טבעונית | 19 | תפריט ~2200 קק"ל צמחי |
| TC-05 | **כשל:** טבעוני + דחיית כל חלבוני הצומח | 25 | FSM זיהוי סתירה → עריכה |
| TC-06 | **כשל:** שאלה מחוץ לדומיין ("המלץ על שיר") | — | [OFF_DOMAIN] → הודעת שגיאה |

---

## אבטחה ופרטיות

| | פרט |
|--|-----|
| 🔒 **מפתח API** | `sessionStorage` בלבד — נמחק עם סגירת הטאב |
| 🖥️ **Backend** | אין — כל העיבוד client-side |
| 📊 **נתוני משתמש** | לא נשמרים, לא נשלחים לשרת כלשהו |
| 🍪 **Cookies** | אין |
| 🔑 **Groq Auth** | `Authorization: Bearer` header — לא query param |

---

## הצהרה רפואית

> ⚕️ **NutriAgent הוא כלי תמיכה בלבד.**
> המערכת אינה מהווה תחליף לייעוץ תזונאי מוסמך, רופא, או איש מקצוע רפואי.
> ההמלצות מבוססות על נתונים כלליים ואינן מותאמות למצב רפואי ספציפי.
> בכל שאלה רפואית יש לפנות לאיש מקצוע מוסמך.

---

<div align="center">
  נועה טידר & גאיה קישון · NutriAgent © 2026 · Powered by Groq Llama 3.3
</div>
