/**
 * ============================================================
 * NUTRIAGENT — chatbot-ui.js
 * UI Controller & DOM Orchestration Layer
 *
 * Responsibilities:
 *  - Bootstrap & API key overlay management
 *  - Chat message rendering (agent / user / system bubbles)
 *  - FSM bridge: routes user input → chatbot.js → renders response
 *  - Profile sidebar live updates
 *  - BMI gauge needle animation
 *  - Metrics tile population
 *  - Dietary tags cloud rendering
 *  - FSM stage indicator updates
 *  - Meal dashboard population & reveal
 *  - Swap button logic (Cosine Similarity → UI)
 *  - Swap history log
 *  - DBSCAN status badge updates
 *  - Toast notification system
 *  - Modal dialog management
 *  - Mode toggle (private ↔ clinical)
 *  - Quick-chip suggestion rendering
 *  - Textarea auto-resize & send button state
 *  - Print handler
 *  - Accessibility: aria-live, focus management
 * ============================================================
 */

'use strict';

/* ============================================================
   SECTION 1 — DOM ELEMENT REGISTRY
   All DOM references resolved once at boot.
   Never use querySelector inside event loops.
============================================================ */
const DOM = {};

function resolveDOM() {
  // Top bar
  DOM.btnModePrivate   = document.getElementById('btn-mode-private');
  DOM.btnModeClinical  = document.getElementById('btn-mode-clinical');
  DOM.apiStatusDot     = document.getElementById('api-status-dot');
  DOM.apiStatusLabel   = document.getElementById('api-status-label');

  // Chat
  DOM.chatMessages     = document.getElementById('chat-messages');
  DOM.chatBootLoader   = document.getElementById('chat-boot-loader');
  DOM.userInput        = document.getElementById('user-input');
  DOM.btnSend          = document.getElementById('btn-send');
  DOM.typingIndicator  = document.getElementById('typing-indicator');
  DOM.quickChips       = document.getElementById('quick-chips');
  DOM.charCount        = document.getElementById('char-count');
  DOM.inputDisclaimer  = document.querySelector('.input-disclaimer');

  // Sidebar — left (profile)
  DOM.profileEmptyState   = document.getElementById('profile-empty-state');
  DOM.profileFields       = document.getElementById('profile-fields');
  DOM.metricsBlock        = document.getElementById('metrics-block');
  DOM.metricBMIValue      = document.getElementById('metric-bmi-value');
  DOM.metricBMIBadge      = document.getElementById('metric-bmi-badge');
  DOM.metricCaloriesValue = document.getElementById('metric-calories-value');
  DOM.metricBMRValue      = document.getElementById('metric-bmr-value');
  DOM.metricCategoryValue = document.getElementById('metric-category-value');
  DOM.bmiGaugeNeedle      = document.getElementById('bmi-gauge-needle');
  DOM.bmiGaugeContainer   = document.getElementById('bmi-gauge-container');
  DOM.dietaryTagsSection  = document.getElementById('dietary-tags-section');
  DOM.dietaryTagsCloud    = document.getElementById('dietary-tags-cloud');
  DOM.clinicalAuditSection= document.getElementById('clinical-audit-section');
  DOM.clinicalLog         = document.getElementById('clinical-log');

  // Sidebar — right (intel)
  DOM.dbscanBadge         = document.getElementById('dbscan-badge');
  DOM.dbscanCountVal      = document.getElementById('dbscan-count-val');
  DOM.swapHistoryList     = document.getElementById('swap-history-list');
  DOM.swapHistoryEmpty    = document.getElementById('swap-history-empty');
  DOM.fsmStageList        = document.getElementById('fsm-stage-list');

  // Meal dashboard
  DOM.mealDashboard         = document.getElementById('meal-dashboard');
  DOM.totalCaloriesDisplay  = document.getElementById('total-calories-display');
  DOM.calorieBreakdownText  = document.getElementById('calorie-breakdown-text');
  DOM.planSummaryBanner     = document.getElementById('plan-summary-banner');
  DOM.planSummaryText       = document.getElementById('plan-summary-text');
  DOM.complianceBadge       = document.getElementById('compliance-badge');
  DOM.mealPlanDate          = document.getElementById('meal-plan-date');
  DOM.btnPrintPlan          = document.getElementById('btn-print-plan');

  // Modal
  DOM.modalOverlay   = document.getElementById('modal-overlay');
  DOM.modalTitle     = document.getElementById('modal-title');
  DOM.modalBody      = document.getElementById('modal-body');
  DOM.modalClose     = document.getElementById('modal-close');
  DOM.modalConfirm   = document.getElementById('modal-confirm');
  DOM.modalCancel    = document.getElementById('modal-cancel');

  // Toast
  DOM.toastContainer = document.getElementById('toast-container');

  // Follow-up Q&A section (inside meal dashboard)
  DOM.followupChatSection = document.getElementById('followup-chat-section');
  DOM.followupMessages    = document.getElementById('followup-messages');

  // API key overlay
  DOM.apiKeyOverlay  = document.getElementById('api-key-overlay');
  DOM.apiKeyInput    = document.getElementById('api-key-input');
  DOM.apiKeyToggle   = document.getElementById('api-key-toggle');
  DOM.apiKeyConfirm  = document.getElementById('api-key-confirm');
  DOM.apiKeyError    = document.getElementById('api-key-error');
}

/* ============================================================
   SECTION 2 — UI STATE
============================================================ */
const UIState = {
  isProcessing:   false,
  currentMode:    'private',   // 'private' | 'clinical'
  chatHistory:    [],          // for follow-up context
  currentPlanJson: null,
  profileFieldsMap: {},        // fieldKey → <dd> element for live update
  swapSourceIds:  {},          // mealSlot → food_item_id for swap engine
};

/* ============================================================
   SECTION 3 — BOOTSTRAP
   Entry point called on DOMContentLoaded.
============================================================ */
function boot() {
  resolveDOM();
  bindEvents();

  const { APIKeyManager } = window.NutriAgentAPI;

  if (!APIKeyManager.isSet()) {
    showAPIKeyOverlay();
  } else {
    startSession();
  }
}

/* ============================================================
   SECTION 4 — EVENT BINDINGS
============================================================ */
function bindEvents() {
  // Send button
  DOM.btnSend.addEventListener('click', handleSendClick);

  // Textarea — Enter to send (Shift+Enter for newline)
  DOM.userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendClick();
    }
  });

  // Textarea — auto-resize + char counter + send button enable
  DOM.userInput.addEventListener('input', () => {
    autoResizeTextarea();
    updateCharCounter();
    DOM.btnSend.disabled = DOM.userInput.value.trim().length === 0;
  });

  // Mode toggle buttons
  DOM.btnModePrivate.addEventListener('click',  () => setMode('private'));
  DOM.btnModeClinical.addEventListener('click', () => setMode('clinical'));

  // Quick chips (event delegation)
  DOM.quickChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.quick-chip');
    if (chip) submitInput(chip.dataset.value || chip.textContent.trim());
  });

  // Swap buttons (event delegation on meal dashboard)
  DOM.mealDashboard.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn--swap');
    if (btn) handleSwapClick(btn.dataset.meal);
  });

  // Modal
  DOM.modalClose.addEventListener('click',   closeModal);
  DOM.modalCancel.addEventListener('click',  closeModal);
  DOM.modalOverlay.addEventListener('click', (e) => {
    if (e.target === DOM.modalOverlay) closeModal();
  });

  // API key overlay
  DOM.apiKeyConfirm.addEventListener('click', handleAPIKeyConfirm);
  DOM.apiKeyToggle.addEventListener('click', () => {
    const isPassword = DOM.apiKeyInput.type === 'password';
    DOM.apiKeyInput.type = isPassword ? 'text' : 'password';
    DOM.apiKeyToggle.textContent = isPassword ? '🙈' : '👁';
  });
  DOM.apiKeyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAPIKeyConfirm();
  });

  // K-Means cluster legend — click to view food table
  document.querySelectorAll('.cluster-legend__item[data-cluster]').forEach(el => {
    el.addEventListener('click', () => showClusterTable(parseInt(el.dataset.cluster, 10)));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        showClusterTable(parseInt(el.dataset.cluster, 10));
      }
    });
  });

  // Print button
  DOM.btnPrintPlan.addEventListener('click', () => window.print());

  // Keyboard: Escape closes modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}

/* ============================================================
   SECTION 5 — SESSION START
   Hides boot loader, initializes FSM, renders greeting.
============================================================ */
async function startSession() {
  setAPIStatus('online');

  // Small delay for polish
  await delay(600);
  DOM.chatBootLoader.style.display = 'none';

  // Boot the FSM — triggers greeting message
  const { fsm } = window.NutriAgent;
  const response = await fsm.process('');
  renderAgentMessage(response.text, response);
  renderQuickChips(response.quickChips);
  updateFSMStageIndicator(response.state);
}

/* ============================================================
   SECTION 6 — SEND FLOW
============================================================ */
async function handleSendClick() {
  const input = DOM.userInput.value.trim();
  if (!input || UIState.isProcessing) return;

  submitInput(input);
}

async function submitInput(text) {
  if (!text || UIState.isProcessing) return;

  // Clear input
  DOM.userInput.value = '';
  DOM.userInput.style.height = 'auto';
  DOM.btnSend.disabled = true;
  updateCharCounter();
  hideQuickChips();

  // Render user bubble
  renderUserMessage(text);

  // Lock UI
  UIState.isProcessing = true;
  showTypingIndicator();

  const { fsm } = window.NutriAgent;
  const { generateMealPlan, sendFollowupMessage } = window.NutriAgentAPI;

  try {
    const response = await fsm.process(text);

    hideTypingIndicator();

    // Handle special response types
    if (response.triggerGeneration) {
      renderAgentMessage(response.text, response);
      await handleMealPlanGeneration();
    } else if (response.triggerFollowup) {
      await handleFollowupQuery(text);
    } else if (response._returnToSummary) {
      renderAgentMessage(response.text, response);
      // After a brief delay, re-render the summary
      await delay(400);
      const summaryResp = await fsm.process('סיכום');
      renderAgentMessage(summaryResp.text, summaryResp);
      updateSidebarFromResponse(summaryResp);
      renderQuickChips(summaryResp.quickChips);
    } else {
      renderAgentMessage(response.text, response);
      updateSidebarFromResponse(response);
      renderQuickChips(response.quickChips);
      updateFSMStageIndicator(response.state);
    }

  } catch (err) {
    hideTypingIndicator();
    window.NutriLogger?.error('UI', `submitInput catch: ${err.message}`, {
      state: window.NutriAgent?.fsm?.state,
      input: text?.slice(0, 80),
      stack: err.stack,
    });
    console.error('[NutriAgent UI] Unexpected error:', err);
    renderAgentMessage(
      `❌ שגיאה בלתי צפויה: **${err.message}**\n\nפתח את Console ← הקלד \`nutriLogs()\` לפרטים מלאים.`,
      { type: 'error' }
    );
  } finally {
    UIState.isProcessing = false;
  }
}

/* ============================================================
   SECTION 7 — MEAL PLAN GENERATION FLOW
   Orchestrates the full generation pipeline with live UI feedback.
============================================================ */
async function handleMealPlanGeneration() {
  const { fsm } = window.NutriAgent;
  const { generateMealPlan, mealSlotToHebrew, sumMealCalories } = window.NutriAgentAPI;

  const profile = fsm.getProfile();

  // Update DBSCAN badge to scanning
  updateDBSCANBadge('scanning', 'סורק…');
  updateFSMStageIndicator('generating');

  // Show generation progress messages
  const progressMessages = [];

  const onProgress = (stage, message) => {
    // Update the last agent message or append a system note
    progressMessages.push(message);
    updateLastAgentMessage(message);
  };

  try {
    const result = await generateMealPlan(profile, onProgress);

    if (!result.success) {
      handleGenerationError(result);
      return;
    }

    const { planJson, violations, retryCount, dbscanScan, warning } = result;

    // Store plan
    UIState.currentPlanJson = planJson;
    fsm.onPlanGenerated(planJson);

    // Update DBSCAN badge
    if (dbscanScan?.detected) {
      updateDBSCANBadge('flagged', `זוהו ${dbscanScan.terms.length} חריגים`);
      DOM.dbscanCountVal.textContent = dbscanScan.terms.length;
    } else {
      updateDBSCANBadge('clear', 'ניקוי מלא ✓');
      DOM.dbscanCountVal.textContent = '0';
    }

    // Render compliance warning if any
    if (warning || violations.length > 0) {
      renderAgentMessage(
        `⚠️ **שים לב:** ${warning || violations.join('\n')}`,
        { type: 'warning' }
      );
    }

    // Populate and reveal meal dashboard
    await populateMealDashboard(planJson, profile);

    // Log to clinical audit (visible in clinical mode)
    if (planJson.conversation_summary) {
      appendClinicalLog(planJson.conversation_summary);
    }

    // Transition to follow-up mode
    fsm.enterFollowupMode();
    updateFSMStageIndicator('followup');

    // Reveal the follow-up Q&A section inside the dashboard
    DOM.followupChatSection.classList.add('visible');
    DOM.followupChatSection.setAttribute('aria-hidden', 'false');

    // Render success & follow-up prompt in the new section
    await delay(400);
    renderFollowupMessage(
      `✅ **תוכנית הארוחות שלך מוכנה!**\n\n${planJson.summary || ''}`,
      { type: 'success' }
    );
    await delay(400);
    renderFollowupMessage(
      '💬 **יש לך שאלות על התוכנית?**\n\nשאל כל שאלה הקשורה לתוכנית הארוחות שנוצרה עבורך.',
      { type: 'info' }
    );

    // Update input placeholder
    DOM.userInput.placeholder = 'שאל שאלה על תוכנית הארוחות…';

    showToast('🌿 תוכנית הארוחות נוצרה בהצלחה!', 'success');

  } catch (err) {
    console.error('[NutriAgent] Generation error:', err);
    updateDBSCANBadge('idle', 'שגיאה');
    renderAgentMessage(
      '❌ אירעה שגיאה ביצירת תוכנית הארוחות. אנא נסה שוב.',
      { type: 'error' }
    );
    fsm.state = window.NutriAgent.FSM_STATES.SUMMARY;
    renderQuickChips(['המשך', 'עריכה']);
  }
}

function handleGenerationError(result) {
  const { fsm } = window.NutriAgent;

  const errorMessages = {
    API_KEY_MISSING:      '🔑 מפתח API חסר. אנא הגדר מפתח תקין.',
    NETWORK_ERROR:        '🌐 שגיאת רשת. בדוק את החיבור לאינטרנט ונסה שוב.',
    JSON_PARSE_ERROR:     '⚠️ שגיאת פורמט תגובה. נסה שוב.',
    MAX_RETRIES_EXCEEDED: '❌ לא הצלחנו ליצור תוכנית תקינה לאחר מספר ניסיונות. נסה שוב.',
    QUOTA_EXCEEDED:       `⏳ חריגה ממגבלת קצב Gemini API (429).\nאנא המתן ${result.retryAfterSeconds || 60} שניות ונסה שוב.`,
  };

  const msg = errorMessages[result.error] || result.message || 'שגיאה לא ידועה.';
  renderAgentMessage(msg, { type: 'error' });
  updateDBSCANBadge('idle', 'שגיאה');

  if (result.error === 'API_KEY_MISSING') {
    showAPIKeyOverlay();
  } else {
    fsm.state = window.NutriAgent.FSM_STATES.SUMMARY;
    renderQuickChips(['המשך', 'עריכה']);
  }
}

/* ============================================================
   SECTION 8 — FOLLOW-UP QUERY HANDLER
============================================================ */
async function handleFollowupQuery(text) {
  const { fsm } = window.NutriAgent;
  const { sendFollowupMessage } = window.NutriAgentAPI;

  // Render the user's question in the follow-up section
  const userMsgEl = document.createElement('div');
  userMsgEl.className = 'message message--user';
  userMsgEl.innerHTML =
    `<div class="message__avatar" aria-hidden="true">👤</div>` +
    `<div><div class="message__bubble">${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>` +
    `<div class="message__time">${currentTimeHebrew()}</div></div>`;
  DOM.followupMessages.appendChild(userMsgEl);
  requestAnimationFrame(() => { DOM.followupMessages.scrollTop = DOM.followupMessages.scrollHeight; });

  showTypingIndicator();

  const result = await sendFollowupMessage(
    text,
    fsm.getProfile(),
    UIState.currentPlanJson,
    UIState.chatHistory
  );

  hideTypingIndicator();

  if (result.success) {
    // Quota exceeded — show as warning, don't store in history
    if (result.isQuotaError) {
      renderFollowupMessage(result.reply, { type: 'warning' });
      return;
    }
    // TC-06: off-domain request — show styled error bubble
    const msgType = result.isOffDomain ? 'off-domain-error' : 'followup';
    renderFollowupMessage(result.reply, { type: msgType });
    if (!result.isOffDomain) {
      UIState.chatHistory.push({ question: text, answer: result.reply });
      if (UIState.chatHistory.length > 8) UIState.chatHistory.shift();
    }
  } else {
    renderFollowupMessage(result.reply || 'שגיאה בעיבוד השאלה.', { type: 'error' });
  }
}

/* ============================================================
   SECTION 9 — MESSAGE RENDERING
============================================================ */

/**
 * Renders an agent (NutriAgent) message bubble.
 * @param {string} text — Hebrew markdown-ish text
 * @param {object} meta — response descriptor from FSM
 */
function renderAgentMessage(text, meta = {}) {
  if (!text && !meta.type) return;

  const msgEl = document.createElement('div');
  const isError   = meta.type === 'error' || meta.type === 'off-domain-error';
  const isWarning = meta.type === 'warning' || meta.type === 'contradiction-error';
  msgEl.className = `message message--agent${isWarning ? ' message--warning' : ''}${isError ? ' message--error' : ''}`;

  // Avatar
  const avatar = document.createElement('div');
  avatar.className = 'message__avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = '🌿';

  // Bubble
  const bubble = document.createElement('div');
  bubble.className = 'message__bubble';
  bubble.innerHTML = formatMessageText(text);

  // Summary block if applicable
  if (meta.type === 'summary') {
    bubble.appendChild(buildSummaryBlock(meta.profile));
  }

  // Timestamp
  const time = document.createElement('div');
  time.className = 'message__time';
  time.textContent = currentTimeHebrew();

  const wrapper = document.createElement('div');
  wrapper.appendChild(bubble);
  wrapper.appendChild(time);

  msgEl.appendChild(avatar);
  msgEl.appendChild(wrapper);

  DOM.chatMessages.appendChild(msgEl);
  scrollToBottom();

  return msgEl;
}

/**
 * Renders a message into the follow-up Q&A section inside the meal dashboard.
 * Used for all messages after the plan is generated (success, info, followup replies).
 * @param {string} text
 * @param {object} meta
 */
function renderFollowupMessage(text, meta = {}) {
  if (!text) return;

  const isError   = meta.type === 'error' || meta.type === 'off-domain-error';
  const isWarning = meta.type === 'warning';

  const msgEl = document.createElement('div');
  msgEl.className = `message message--agent${isWarning ? ' message--warning' : ''}${isError ? ' message--error' : ''}`;

  const avatar = document.createElement('div');
  avatar.className = 'message__avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = '🌿';

  const bubble = document.createElement('div');
  bubble.className = 'message__bubble';
  bubble.innerHTML = formatMessageText(text);

  const time = document.createElement('div');
  time.className = 'message__time';
  time.textContent = currentTimeHebrew();

  const wrapper = document.createElement('div');
  wrapper.appendChild(bubble);
  wrapper.appendChild(time);

  msgEl.appendChild(avatar);
  msgEl.appendChild(wrapper);

  DOM.followupMessages.appendChild(msgEl);

  // Scroll the follow-up section to latest message
  requestAnimationFrame(() => {
    DOM.followupMessages.scrollTop = DOM.followupMessages.scrollHeight;
  });
}

/**
 * Renders a user message bubble.
 * @param {string} text
 */
function renderUserMessage(text) {
  const msgEl = document.createElement('div');
  msgEl.className = 'message message--user';

  const avatar = document.createElement('div');
  avatar.className = 'message__avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = '👤';

  const bubble = document.createElement('div');
  bubble.className = 'message__bubble';
  bubble.textContent = text;

  const time = document.createElement('div');
  time.className = 'message__time';
  time.textContent = currentTimeHebrew();

  const wrapper = document.createElement('div');
  wrapper.appendChild(bubble);
  wrapper.appendChild(time);

  msgEl.appendChild(avatar);
  msgEl.appendChild(wrapper);

  DOM.chatMessages.appendChild(msgEl);
  scrollToBottom();
}

/**
 * Updates the text of the last agent message bubble.
 * Used during generation progress updates.
 * @param {string} newText
 */
function updateLastAgentMessage(newText) {
  const messages = DOM.chatMessages.querySelectorAll('.message--agent');
  if (messages.length === 0) return;
  const last = messages[messages.length - 1];
  const bubble = last.querySelector('.message__bubble');
  if (bubble) bubble.innerHTML = formatMessageText(newText);
  scrollToBottom();
}

/**
 * Converts simple markdown-ish syntax to HTML.
 * Supports: **bold**, *italic*, \n newlines, --- hr
 * @param {string} text
 * @returns {string} HTML string
 */
function formatMessageText(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/`(.+?)`/g,       '<code>$1</code>')
    .replace(/^---$/gm,        '<hr/>')
    .replace(/\n/g,             '<br/>');
}

/**
 * Builds the styled profile summary block DOM element.
 * @param {object} profile
 * @returns {HTMLElement}
 */
function buildSummaryBlock(profile) {
  if (!profile) return document.createElement('div');

  const { ACTIVITY_LEVELS } = window.NutriAgent;
  const activityLabel = Object.values(ACTIVITY_LEVELS)
    .find(a => a.id === profile.activityLevel)?.label || profile.activityLevel || '—';

  const block = document.createElement('div');
  block.className = 'summary-block';

  const title = document.createElement('div');
  title.className = 'summary-block__title';
  title.innerHTML = '📋 פרופיל מאומת';
  block.appendChild(title);

  const rows = [
    ['גיל',              profile.age ? `${profile.age} שנים` : '—'],
    ['מין',              profile.gender === 'male' ? 'זכר' : (profile.gender ? 'נקבה' : '—')],
    ['משקל',             profile.weight ? `${profile.weight} ק"ג` : '—'],
    ['גובה',             profile.height ? `${profile.height} ס"מ` : '—'],
    ['BMI',              profile.bmi ? `${profile.bmi} (${profile.bmiCategory})` : '—'],
    ['רמת פעילות',       activityLabel],
    ['יעד קלורי',        profile.caloricTarget ? `${profile.caloricTarget} קק"ל/יום` : '—'],
    ['אלרגיות',          profile.allergies?.length > 0 ? profile.allergies.join(', ') : 'אין'],
    ['דחיות',            profile.dislikes?.length  > 0 ? profile.dislikes.join(', ')  : 'אין'],
    ['הגבלות',           profile.restrictions?.length > 0 ? profile.restrictions.join(', ') : 'אין'],
  ];

  rows.forEach(([label, value]) => {
    const row = document.createElement('div');
    row.className = 'summary-block__row';
    row.innerHTML = `<span class="summary-block__label">${label}</span><span class="summary-block__value">${value}</span>`;
    block.appendChild(row);
  });

  return block;
}

/* ============================================================
   SECTION 10 — SIDEBAR UPDATES
============================================================ */

/**
 * Master dispatcher: updates all sidebar components from a response.
 * @param {object} response — FSM response descriptor
 */
function updateSidebarFromResponse(response) {
  if (!response) return;

  if (response.profileUpdate) {
    updateProfileFields(response.profileUpdate);
  }

  if (response.bmiData) {
    updateMetricsBlock(response.bmiData, response.profile);
  }

  if (response.metricsUpdate) {
    updateMetricTiles(response.metricsUpdate);
  }

  if (response.tagsUpdate) {
    updateDietaryTags(response.tagsUpdate);
  }

  // Show/hide sections based on profile completeness
  const profile = response.profile || {};
  if (profile.bmi) {
    DOM.metricsBlock.removeAttribute('aria-hidden');
    DOM.bmiGaugeContainer.removeAttribute('aria-hidden');
  }
  if ((profile.allergies !== null) || (profile.restrictions !== null)) {
    DOM.dietaryTagsSection.removeAttribute('aria-hidden');
  }
}

/**
 * Updates the profile fields DL element.
 * @param {object} fields — { label: value }
 */
function updateProfileFields(fields) {
  // Hide empty state
  DOM.profileEmptyState.style.display = 'none';

  Object.entries(fields).forEach(([label, value]) => {
    const key = label.replace(/\s+/g, '_');
    let fieldEl = UIState.profileFieldsMap[key];

    if (!fieldEl) {
      // Create new field row
      const div = document.createElement('div');
      div.className = 'profile-field';
      div.setAttribute('data-field', key);

      const dt = document.createElement('dt');
      dt.textContent = label;

      const dd = document.createElement('dd');
      dd.textContent = value;

      div.appendChild(dt);
      div.appendChild(dd);
      DOM.profileFields.appendChild(div);
      UIState.profileFieldsMap[key] = dd;
    } else {
      // Update existing
      fieldEl.textContent = value;
      // Flash animation
      const row = fieldEl.closest('.profile-field');
      if (row) {
        row.style.borderColor = 'rgba(74,222,128,0.4)';
        setTimeout(() => { row.style.borderColor = ''; }, 800);
      }
    }
  });
}

/**
 * Updates the BMI/BMR metrics tiles and gauge needle.
 * @param {object} bmiData — { bmi, bmiCategory, bmrBase }
 * @param {object} profile
 */
function updateMetricsBlock(bmiData, profile) {
  const { bmi, bmiCategory, bmrBase } = bmiData;

  DOM.metricBMIValue.textContent = bmi || '—';
  DOM.metricBMRValue.textContent = bmrBase || '—';
  DOM.metricCategoryValue.textContent = bmiCategory || '—';

  // BMI category badge color
  const { BMI_CATEGORIES } = window.NutriAgent;
  const categoryColors = {
    [BMI_CATEGORIES.UNDERWEIGHT]: { bg: 'rgba(96,165,250,0.15)', color: '#93c5fd', border: 'rgba(96,165,250,0.3)' },
    [BMI_CATEGORIES.NORMAL]:      { bg: 'rgba(74,222,128,0.15)', color: '#86efac', border: 'rgba(74,222,128,0.3)' },
    [BMI_CATEGORIES.OVERWEIGHT]:  { bg: 'rgba(251,191,36,0.15)', color: '#fcd34d', border: 'rgba(251,191,36,0.3)' },
    [BMI_CATEGORIES.OBESE]:       { bg: 'rgba(248,113,113,0.15)', color: '#fca5a5', border: 'rgba(248,113,113,0.3)' },
  };

  const colors = categoryColors[bmiCategory] || categoryColors[BMI_CATEGORIES.NORMAL];
  DOM.metricBMIBadge.textContent = bmiCategory || '';
  DOM.metricBMIBadge.style.cssText =
    `background:${colors.bg};color:${colors.color};border:1px solid ${colors.border};border-radius:9999px;padding:2px 8px;font-size:10px;font-weight:700`;

  // BMI gauge needle position (0–100%)
  if (bmi && profile?.age) {
    animateBMIGaugeNeedle(bmi, bmiCategory);
  }
}

/**
 * Animates the BMI gauge needle to the correct position.
 * @param {number} bmi
 * @param {string} bmiCategory
 */
function animateBMIGaugeNeedle(bmi, bmiCategory) {
  const { BMI_CATEGORIES } = window.NutriAgent;

  // Map category to approximate gauge percentage
  const positionMap = {
    [BMI_CATEGORIES.UNDERWEIGHT]: 10,
    [BMI_CATEGORIES.NORMAL]:      38,
    [BMI_CATEGORIES.OVERWEIGHT]:  65,
    [BMI_CATEGORIES.OBESE]:       88,
  };

  const position = positionMap[bmiCategory] || 38;
  DOM.bmiGaugeNeedle.style.left = `${position}%`;

  // Highlight the active segment
  const segmentMap = {
    [BMI_CATEGORIES.UNDERWEIGHT]: 'underweight',
    [BMI_CATEGORIES.NORMAL]:      'normal',
    [BMI_CATEGORIES.OVERWEIGHT]:  'overweight',
    [BMI_CATEGORIES.OBESE]:       'obese',
  };

  const fills = document.querySelectorAll('.bmi-gauge__fill');
  fills.forEach(f => f.classList.remove('bmi-gauge__fill--active'));
  const activeKey = segmentMap[bmiCategory];
  if (activeKey) {
    const activeEl = document.querySelector(`.bmi-gauge__fill--${activeKey}`);
    if (activeEl) activeEl.classList.add('bmi-gauge__fill--active');
  }
}

/**
 * Updates calorie target tile.
 * @param {object} update — { calorieTarget, bmrBase }
 */
function updateMetricTiles(update) {
  if (update.calorieTarget) {
    DOM.metricCaloriesValue.textContent = update.calorieTarget;
  }
  if (update.bmrBase) {
    DOM.metricBMRValue.textContent = update.bmrBase;
  }
}

/**
 * Renders dietary tags into the tags cloud.
 * @param {object} tagsUpdate — { type: 'allergy'|'dislike'|'restriction', items: string[] }
 */
function updateDietaryTags(tagsUpdate) {
  const { type, items } = tagsUpdate;
  if (!items) return;

  if (items.length === 0) {
    // Add "אין" tag
    addDietaryTag('אין', `${type} none`, 'dietary-tag--none');
    return;
  }

  items.forEach(item => {
    addDietaryTag(item, type, `dietary-tag--${type}`);
  });
}

/**
 * Adds a single tag chip to the tags cloud.
 * @param {string} label
 * @param {string} key  — unique key to prevent duplicates
 * @param {string} cssClass
 */
function addDietaryTag(label, key, cssClass) {
  const existingTags = DOM.dietaryTagsCloud.querySelectorAll('.dietary-tag');
  for (const tag of existingTags) {
    if (tag.dataset.key === key + label) return; // already exists
  }

  const tag = document.createElement('span');
  tag.className = `dietary-tag ${cssClass}`;
  tag.dataset.key = key + label;
  tag.textContent = label;
  DOM.dietaryTagsCloud.appendChild(tag);
}

/* ============================================================
   SECTION 11 — FSM STAGE INDICATOR
============================================================ */

/**
 * Updates the FSM stage list in the right sidebar.
 * @param {string} currentState — FSM state string
 */
function updateFSMStageIndicator(currentState) {
  const stageEls = DOM.fsmStageList.querySelectorAll('.fsm-stage');

  const stateOrder = [
    'greeting', 'age', 'gender', 'weight', 'height',
    'activity', 'allergies', 'dislikes', 'restrictions',
    'summary', 'generating', 'meal_plan', 'followup',
  ];

  const currentIndex = stateOrder.indexOf(currentState);

  stageEls.forEach((el, i) => {
    el.classList.remove('fsm-stage--active', 'fsm-stage--complete');
    if (i < currentIndex)      el.classList.add('fsm-stage--complete');
    else if (i === currentIndex) el.classList.add('fsm-stage--active');
  });
}

/* ============================================================
   SECTION 12 — MEAL DASHBOARD POPULATION
============================================================ */

const MEAL_SLOT_ORDER = [
  'breakfast', 'morning_snack', 'lunch',
  'afternoon_snack', 'dinner', 'evening_snack',
];

/**
 * Populates all meal cards and reveals the dashboard.
 * @param {object} planJson — parsed AI JSON response
 * @param {object} profile  — current user profile
 */
async function populateMealDashboard(planJson, profile) {
  const { sumMealCalories, mealSlotToHebrew, extractClusterIndex } = window.NutriAgentAPI;

  // Set date
  DOM.mealPlanDate.textContent = new Date().toLocaleDateString('he-IL', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  // Total calories
  const totalCals = planJson.total_calories || sumMealCalories(planJson.meal_plan);
  DOM.totalCaloriesDisplay.textContent = totalCals.toLocaleString('he-IL');

  // Calorie breakdown text
  if (planJson.calorie_calculation) {
    DOM.calorieBreakdownText.textContent = planJson.calorie_calculation;
  }

  // Populate each meal card
  MEAL_SLOT_ORDER.forEach(slot => {
    const meal = planJson.meal_plan?.[slot];
    if (!meal) return;

    populateMealCard(slot, meal);

    // Track food_item_ids for swap engine
    if (meal.food_item_ids?.length > 0) {
      UIState.swapSourceIds[slot] = meal.food_item_ids[0];
    }
  });

  // Summary banner
  if (planJson.summary) {
    DOM.planSummaryText.textContent = planJson.summary;
    DOM.planSummaryBanner.removeAttribute('aria-hidden');
  }

  // Compliance badge
  DOM.complianceBadge.removeAttribute('aria-hidden');

  // Reveal dashboard (hide chat messages, show dashboard)
  DOM.chatMessages.style.display = 'none';
  DOM.mealDashboard.classList.add('visible');
  DOM.mealDashboard.removeAttribute('aria-hidden');

  // Animate cards in sequence
  const cards = DOM.mealDashboard.querySelectorAll('.meal-card');
  cards.forEach((card, i) => {
    card.style.animationDelay = `${i * 0.06}s`;
  });
}

/**
 * Populates a single meal card with plan data.
 * @param {string} slot — meal slot key
 * @param {object} meal — { name, description, calories, cluster_tags, food_item_ids }
 */
function populateMealCard(slot, meal) {
  const safeSlot = slot.replace(/_/g, '_'); // already safe

  const calEl  = document.getElementById(`cal-${slot}`);
  const nameEl = document.getElementById(`meal-name-${slot}`);
  const descEl = document.getElementById(`meal-desc-${slot}`);
  const clustEl= document.getElementById(`cluster-${slot}`);

  if (calEl)  calEl.textContent  = meal.calories || '—';
  if (nameEl) nameEl.textContent = meal.name      || '—';
  if (descEl) descEl.textContent = meal.description || '';

  // Cluster tag rendering
  if (clustEl && meal.cluster_tags?.length > 0) {
    const primaryTag = meal.cluster_tags[0];
    const { extractClusterIndex } = window.NutriAgentAPI;
    const clusterIdx = extractClusterIndex(primaryTag);

    clustEl.textContent  = primaryTag;
    clustEl.className    = `meal-card__cluster-tag meal-card__cluster-tag--${clusterIdx ?? 0}`;
  }
}

/* ============================================================
   SECTION 13 — SWAP ENGINE UI
============================================================ */

/**
 * Handles the swap button click for a meal slot.
 * Calls the Cosine Similarity engine and shows selection modal.
 * @param {string} mealSlot — e.g. 'breakfast'
 */
async function handleSwapClick(mealSlot) {
  const { fsm, KMEANS_CLUSTERS } = window.NutriAgent;
  const { mealSlotToHebrew } = window.NutriAgentAPI;

  const sourceId = UIState.swapSourceIds[mealSlot];
  if (!sourceId) {
    showToast('לא נמצא מזהה מזון לביצוע החלפה.', 'error');
    return;
  }

  const candidates = fsm.getSwapCandidates(sourceId, 3);

  if (candidates.length === 0) {
    showToast('לא נמצאו חלופות תואמות לפריט זה.', 'info');
    return;
  }

  // Build modal content
  const mealName = mealSlotToHebrew(mealSlot);
  const sourceItem = window.NutriAgent.FOOD_DATABASE.find(f => f.id === sourceId);

  let modalBodyHTML = `
    <p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:16px;">
      החלפת <strong style="color:var(--color-text-primary)">${sourceItem?.name || sourceId}</strong>
      — ${mealName}<br/>
      <small style="color:var(--color-text-muted)">כל החלופות מאותו אשכול K-Means (${KMEANS_CLUSTERS[sourceItem?.cluster]?.nameShort || ''})</small>
    </p>
    <div style="display:flex;flex-direction:column;gap:10px;">
  `;

  candidates.forEach(({ item, score }, i) => {
    const scorePercent = Math.round(score * 100);
    const servingCals  = Math.round((item.per100g.calories * item.servingSizeG) / 100);
    modalBodyHTML += `
      <button
        class="swap-candidate-btn"
        data-item-id="${item.id}"
        data-meal-slot="${mealSlot}"
        data-item-name="${item.name}"
        data-source-name="${sourceItem?.name || ''}"
        style="
          background:rgba(255,255,255,0.03);
          border:1px solid rgba(255,255,255,0.08);
          border-radius:12px;
          padding:12px 16px;
          text-align:right;
          cursor:pointer;
          transition:all 0.2s;
          color:var(--color-text-primary);
          font-family:var(--font-primary);
          width:100%;
        "
        onmouseover="this.style.borderColor='rgba(74,222,128,0.3)';this.style.background='rgba(74,222,128,0.06)'"
        onmouseout="this.style.borderColor='rgba(255,255,255,0.08)';this.style.background='rgba(255,255,255,0.03)'"
      >
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <span style="font-weight:700;font-size:14px;">${item.name}</span>
          <span style="
            background:rgba(74,222,128,0.12);
            border:1px solid rgba(74,222,128,0.25);
            border-radius:9999px;
            padding:2px 8px;
            font-size:11px;
            color:var(--color-accent-primary);
            font-family:var(--font-mono);
            white-space:nowrap;
          ">${scorePercent}% התאמה</span>
        </div>
        <div style="font-size:12px;color:var(--color-text-muted);margin-top:4px;">
          ${servingCals} קק"ל | ${item.per100g.protein}g חלבון | ${item.per100g.fat}g שומן | ${item.per100g.carbs}g פחמ׳
        </div>
        <div style="font-size:11px;color:var(--color-text-muted);margin-top:2px;">
          מנה: ${item.servingSizeG}g
        </div>
      </button>
    `;
  });

  modalBodyHTML += '</div>';

  openModal(`🔄 החלפת ארוחה — ${mealName}`, modalBodyHTML);

  // Bind swap candidate buttons inside the modal
  setTimeout(() => {
    const btns = DOM.modalBody.querySelectorAll('.swap-candidate-btn');
    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        applySwap(
          btn.dataset.mealSlot,
          btn.dataset.itemId,
          btn.dataset.itemName,
          btn.dataset.sourceName,
        );
        closeModal();
      });
    });
  }, 50);
}

/**
 * Applies a swap: updates the meal card and logs the action.
 * @param {string} mealSlot
 * @param {string} newItemId
 * @param {string} newItemName
 * @param {string} oldItemName
 */
function applySwap(mealSlot, newItemId, newItemName, oldItemName) {
  const { fsm, FOOD_DATABASE, KMEANS_CLUSTERS } = window.NutriAgent;
  const newItem = FOOD_DATABASE.find(f => f.id === newItemId);
  if (!newItem) return;

  // Mark card as swapping
  const card = document.getElementById(`meal-card-${mealSlot}`);
  if (card) card.classList.add('meal-card--swapping');

  setTimeout(() => {
    // Update meal card DOM
    const nameEl = document.getElementById(`meal-name-${mealSlot}`);
    const descEl = document.getElementById(`meal-desc-${mealSlot}`);
    const calEl  = document.getElementById(`cal-${mealSlot}`);
    const clustEl= document.getElementById(`cluster-${mealSlot}`);

    const servingCals = Math.round((newItem.per100g.calories * newItem.servingSizeG) / 100);

    if (nameEl) nameEl.textContent = newItem.name;
    if (descEl) descEl.textContent =
      `${newItem.name} — ${newItem.servingSizeG}g | ` +
      `חלבון: ${Math.round(newItem.per100g.protein * newItem.servingSizeG / 100)}g | ` +
      `שומן: ${Math.round(newItem.per100g.fat * newItem.servingSizeG / 100)}g | ` +
      `פחמ׳: ${Math.round(newItem.per100g.carbs * newItem.servingSizeG / 100)}g`;

    if (calEl) calEl.textContent = servingCals;

    if (clustEl) {
      const clusterInfo = KMEANS_CLUSTERS[newItem.cluster];
      clustEl.textContent = clusterInfo?.nameShort || `אשכול ${newItem.cluster}`;
      clustEl.className = `meal-card__cluster-tag meal-card__cluster-tag--${newItem.cluster}`;
    }

    // Update swap source tracking
    UIState.swapSourceIds[mealSlot] = newItemId;

    // Remove swapping state
    if (card) card.classList.remove('meal-card--swapping');

    // Log swap in FSM
    fsm.logSwap(mealSlot, oldItemName, newItem.name);

    // Update swap history sidebar
    appendSwapHistory(mealSlot, oldItemName, newItem.name);

    showToast(`✅ הוחלף: ${oldItemName} → ${newItem.name}`, 'success');

  }, 600);
}

/* ============================================================
   SECTION 14 — SWAP HISTORY SIDEBAR
============================================================ */

/**
 * Appends an entry to the swap history list in the right sidebar.
 * @param {string} mealSlot
 * @param {string} from
 * @param {string} to
 */
function appendSwapHistory(mealSlot, from, to) {
  const { mealSlotToHebrew } = window.NutriAgentAPI;

  // Hide empty state
  if (DOM.swapHistoryEmpty) DOM.swapHistoryEmpty.style.display = 'none';

  const item = document.createElement('li');
  item.className = 'swap-history-item';

  item.innerHTML = `
    <div class="swap-history-item__meal">${mealSlotToHebrew(mealSlot)}</div>
    <div class="swap-history-item__change">
      <span>${from}</span>
      <span class="swap-history-item__arrow">→</span>
      <span style="color:var(--color-accent-primary)">${to}</span>
    </div>
  `;

  DOM.swapHistoryList.appendChild(item);
}

/* ============================================================
   SECTION 15 — DBSCAN STATUS BADGE
============================================================ */

/**
 * Updates the DBSCAN status badge in the right sidebar.
 * @param {'idle'|'scanning'|'clear'|'flagged'} status
 * @param {string} label
 */
function updateDBSCANBadge(status, label) {
  DOM.dbscanBadge.className = `dbscan-status-card__badge dbscan-status-card__badge--${status}`;
  DOM.dbscanBadge.textContent = label;
}

/* ============================================================
   SECTION 16 — CLINICAL LOG (clinical mode only)
============================================================ */

/**
 * Appends an entry to the clinical audit log.
 * @param {string} text
 */
function appendClinicalLog(text) {
  // Remove "empty" placeholder
  const emptyEl = DOM.clinicalLog.querySelector('.clinical-log__empty');
  if (emptyEl) emptyEl.remove();

  const entry = document.createElement('div');
  entry.className = 'clinical-log__entry';

  const timestamp = document.createElement('span');
  timestamp.className = 'clinical-log__timestamp';
  timestamp.textContent = currentTimeHebrew();

  entry.appendChild(timestamp);
  entry.appendChild(document.createTextNode(' ' + text));
  DOM.clinicalLog.appendChild(entry);

  if (UIState.currentMode === 'clinical') {
    DOM.clinicalAuditSection.removeAttribute('aria-hidden');
  }
}

/* ============================================================
   SECTION 17 — QUICK CHIPS
============================================================ */

/**
 * Renders quick-reply chips above the input.
 * @param {string[]} chips — array of chip labels
 */
function renderQuickChips(chips) {
  DOM.quickChips.innerHTML = '';

  if (!chips || chips.length === 0) {
    DOM.quickChips.classList.remove('visible');
    return;
  }

  chips.forEach(label => {
    const chip = document.createElement('button');
    chip.className = 'quick-chip';
    chip.textContent = label;
    chip.dataset.value = label;
    chip.setAttribute('aria-label', `בחר: ${label}`);
    DOM.quickChips.appendChild(chip);
  });

  DOM.quickChips.classList.add('visible');
}

function hideQuickChips() {
  DOM.quickChips.classList.remove('visible');
  setTimeout(() => { DOM.quickChips.innerHTML = ''; }, 300);
}

/* ============================================================
   SECTION 18 — TYPING INDICATOR
============================================================ */
function showTypingIndicator() {
  DOM.typingIndicator.classList.add('visible');
  DOM.typingIndicator.removeAttribute('aria-hidden');
  scrollToBottom();
}

function hideTypingIndicator() {
  DOM.typingIndicator.classList.remove('visible');
  DOM.typingIndicator.setAttribute('aria-hidden', 'true');
}

/* ============================================================
   SECTION 19 — TOAST NOTIFICATIONS
============================================================ */

/**
 * Shows a toast notification.
 * @param {string} message
 * @param {'success'|'error'|'info'} type
 * @param {number} durationMs
 */
function showToast(message, type = 'info', durationMs = 3500) {
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', 'status');
  toast.textContent = message;

  DOM.toastContainer.appendChild(toast);

  // Auto-remove
  setTimeout(() => {
    toast.classList.add('toast--exit');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, durationMs);
}

/* ============================================================
   SECTION 20 — MODAL
============================================================ */

/**
 * Opens the global modal dialog.
 * @param {string} title
 * @param {string} bodyHTML
 * @param {Function} [onConfirm] — optional confirm callback
 */
function openModal(title, bodyHTML, onConfirm = null) {
  DOM.modalTitle.textContent = title;
  DOM.modalBody.innerHTML    = bodyHTML;
  DOM.modalOverlay.classList.add('visible');
  DOM.modalOverlay.removeAttribute('aria-hidden');

  if (onConfirm) {
    DOM.modalConfirm.style.display = 'inline-flex';
    DOM.modalConfirm.onclick = () => { onConfirm(); closeModal(); };
  } else {
    DOM.modalConfirm.style.display = 'none';
  }

  // Focus trap
  setTimeout(() => DOM.modalClose.focus(), 50);
}

function closeModal() {
  DOM.modalOverlay.classList.remove('visible');
  DOM.modalOverlay.setAttribute('aria-hidden', 'true');
  DOM.modalBody.innerHTML = '';
  DOM.modalConfirm.onclick = null;
}

/* ============================================================
   SECTION 21 — API KEY OVERLAY
============================================================ */
function showAPIKeyOverlay() {
  DOM.apiKeyOverlay.classList.add('visible');
  DOM.apiKeyOverlay.removeAttribute('aria-hidden');
  setTimeout(() => DOM.apiKeyInput.focus(), 100);
}

function hideAPIKeyOverlay() {
  DOM.apiKeyOverlay.classList.remove('visible');
  DOM.apiKeyOverlay.setAttribute('aria-hidden', 'true');
}

async function handleAPIKeyConfirm() {
  const key = DOM.apiKeyInput.value.trim();
  DOM.apiKeyError.textContent = '';

  if (!key) {
    DOM.apiKeyError.textContent = 'אנא הזן מפתח API.';
    return;
  }

  const { APIKeyManager, validateAPIKey } = window.NutriAgentAPI;

  // Validate format (Gemini keys are >20 chars, typically start with AIza)
  if (!APIKeyManager.validate(key)) {
    DOM.apiKeyError.textContent = 'פורמט מפתח לא תקין. מפתח Gemini API חייב להיות ארוך מ-20 תווים (לדוגמה: AIza...).';
    return;
  }

  // Show loading state
  DOM.apiKeyConfirm.textContent = 'בודק מפתח…';
  DOM.apiKeyConfirm.disabled = true;
  setAPIStatus('loading');

  try {
    const result = await validateAPIKey(key);

    if (result.valid) {
      APIKeyManager.save(key);
      hideAPIKeyOverlay();
      setAPIStatus('online');
      showToast('🔑 מפתח API אומת בהצלחה!', 'success');
      await startSession();
    } else {
      DOM.apiKeyError.textContent = result.error || 'מפתח לא תקין.';
      setAPIStatus('offline');
    }
  } catch (err) {
    DOM.apiKeyError.textContent = 'שגיאת חיבור. בדוק את החיבור לאינטרנט.';
    setAPIStatus('offline');
  } finally {
    DOM.apiKeyConfirm.textContent = 'הפעל את NutriAgent →';
    DOM.apiKeyConfirm.disabled = false;
  }
}

/* ============================================================
   SECTION 22 — MODE TOGGLE
============================================================ */

/**
 * Switches between private and clinical mode.
 * @param {'private'|'clinical'} mode
 */
function setMode(mode) {
  UIState.currentMode = mode;
  window.NutriAgent.fsm.setClinicalMode(mode === 'clinical');

  // Update button states
  DOM.btnModePrivate.classList.toggle('mode-btn--active',  mode === 'private');
  DOM.btnModeClinical.classList.toggle('mode-btn--active', mode === 'clinical');
  DOM.btnModePrivate.setAttribute('aria-selected',  mode === 'private'  ? 'true' : 'false');
  DOM.btnModeClinical.setAttribute('aria-selected', mode === 'clinical' ? 'true' : 'false');

  // Show/hide clinical audit section
  if (mode === 'clinical') {
    DOM.clinicalAuditSection.removeAttribute('aria-hidden');
    showToast('🩺 מצב תזונאי קליני פעיל — גישה מורחבת לנתונים', 'info');
  } else {
    DOM.clinicalAuditSection.setAttribute('aria-hidden', 'true');
  }
}

/* ============================================================
   SECTION 23 — API STATUS INDICATOR
============================================================ */

/**
 * Updates the API status dot and label in the topbar.
 * @param {'online'|'offline'|'loading'} status
 */
function setAPIStatus(status) {
  DOM.apiStatusDot.className = `status-dot status-dot--${status}`;
  const labels = {
    online:  'מחובר',
    offline: 'מנותק',
    loading: 'מתחבר…',
  };
  DOM.apiStatusLabel.textContent = labels[status] || status;
}

/* ============================================================
   SECTION 24 — UTILITY HELPERS
============================================================ */

function scrollToBottom() {
  requestAnimationFrame(() => {
    DOM.chatMessages.scrollTop = DOM.chatMessages.scrollHeight;
  });
}

function autoResizeTextarea() {
  DOM.userInput.style.height = 'auto';
  DOM.userInput.style.height = Math.min(DOM.userInput.scrollHeight, 140) + 'px';
}

function updateCharCounter() {
  const count = DOM.userInput.value.length;
  DOM.charCount.textContent = count;
  DOM.charCount.style.color = count > 900 ? 'var(--color-accent-danger)' :
                               count > 700 ? 'var(--color-accent-warm)' :
                               'var(--color-text-muted)';
}

function currentTimeHebrew() {
  return new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ============================================================
   SECTION 25 — K-MEANS CLUSTER TABLE MODAL
   Opens a modal with a nutritional table for all foods
   in the selected K-Means cluster (0–3).
============================================================ */

/**
 * Opens a modal showing all foods in a given K-Means cluster.
 * @param {number} clusterIdx — 0, 1, 2, or 3
 */
function showClusterTable(clusterIdx) {
  const { FOOD_DATABASE, KMEANS_CLUSTERS } = window.NutriAgent;
  const cluster = KMEANS_CLUSTERS[clusterIdx];
  if (!cluster) return;

  const foods = FOOD_DATABASE.filter(f => f.cluster === clusterIdx);
  const validFoods   = foods.filter(f => f.dbscan >= 0);
  const outlierFoods = foods.filter(f => f.dbscan < 0);

  const clusterColors = {
    0: { color: '#22d3ee', bg: 'rgba(34,211,238,0.08)', border: 'rgba(34,211,238,0.2)' },
    1: { color: '#4ade80', bg: 'rgba(74,222,128,0.08)', border: 'rgba(74,222,128,0.2)' },
    2: { color: '#fbbf24', bg: 'rgba(251,191,36,0.08)', border: 'rgba(251,191,36,0.2)' },
    3: { color: '#c084fc', bg: 'rgba(192,132,252,0.08)', border: 'rgba(192,132,252,0.2)' },
  };
  const c = clusterColors[clusterIdx];

  function buildRows(items) {
    return items.map(item => {
      const servingCal = Math.round((item.per100g.calories * item.servingSizeG) / 100);
      const dbscanBadge = item.dbscan < 0
        ? `<span style="background:rgba(248,113,113,0.15);color:#f87171;border:1px solid rgba(248,113,113,0.3);border-radius:9999px;padding:1px 7px;font-size:10px;font-family:monospace">⛔ DBSCAN -1</span>`
        : `<span style="background:rgba(74,222,128,0.1);color:#4ade80;border:1px solid rgba(74,222,128,0.2);border-radius:9999px;padding:1px 7px;font-size:10px;font-family:monospace">✓ תקין</span>`;
      return `
        <tr style="border-bottom:1px solid rgba(255,255,255,0.04);transition:background 0.15s"
            onmouseover="this.style.background='rgba(255,255,255,0.03)'"
            onmouseout="this.style.background=''">
          <td style="padding:8px 10px;color:#e8f0fe;font-weight:500">${item.name}</td>
          <td style="padding:8px 10px;color:#8ba3c7;font-size:12px">${item.nameEn}</td>
          <td style="padding:8px 10px;text-align:center;font-family:monospace;font-size:12px">${item.per100g.calories}</td>
          <td style="padding:8px 10px;text-align:center;font-family:monospace;font-size:12px;color:#4ade80">${item.per100g.protein}</td>
          <td style="padding:8px 10px;text-align:center;font-family:monospace;font-size:12px;color:#fbbf24">${item.per100g.fat}</td>
          <td style="padding:8px 10px;text-align:center;font-family:monospace;font-size:12px;color:#c084fc">${item.per100g.carbs}</td>
          <td style="padding:8px 10px;text-align:center;font-family:monospace;font-size:12px;color:#8ba3c7">${item.per100g.fiber}</td>
          <td style="padding:8px 10px;text-align:center;font-family:monospace;font-size:12px">${item.servingSizeG}g <span style="color:#8ba3c7;font-size:10px">(${servingCal} קק"ל)</span></td>
          <td style="padding:8px 10px;text-align:center">${dbscanBadge}</td>
        </tr>`;
    }).join('');
  }

  const headerStyle = `padding:7px 10px;font-size:11px;font-weight:700;color:#8ba3c7;text-align:center;border-bottom:1px solid rgba(255,255,255,0.08);white-space:nowrap`;
  const headerStyleRight = `padding:7px 10px;font-size:11px;font-weight:700;color:#8ba3c7;text-align:right;border-bottom:1px solid rgba(255,255,255,0.08)`;

  const tableHTML = `
    <div style="margin-bottom:12px;padding:10px 14px;background:${c.bg};border:1px solid ${c.border};border-radius:10px">
      <div style="font-size:13px;font-weight:700;color:${c.color}">${cluster.name}</div>
      <div style="font-size:11px;color:#8ba3c7;margin-top:2px">${cluster.description}</div>
      <div style="font-size:11px;color:#4a6080;margin-top:4px">
        ${validFoods.length} פריטים תקינים · ${outlierFoods.length} חריגי DBSCAN -1
      </div>
    </div>
    <div style="overflow-x:auto;max-height:420px;overflow-y:auto">
      <table style="width:100%;border-collapse:collapse;font-size:12px;direction:rtl">
        <thead style="position:sticky;top:0;background:#0d1525;z-index:1">
          <tr>
            <th style="${headerStyleRight}">שם עברי</th>
            <th style="${headerStyleRight}">English</th>
            <th style="${headerStyle}">קל׳/100g</th>
            <th style="${headerStyle}">חלבון</th>
            <th style="${headerStyle}">שומן</th>
            <th style="${headerStyle}">פחמ׳</th>
            <th style="${headerStyle}">סיבים</th>
            <th style="${headerStyle}">מנה (קל׳)</th>
            <th style="${headerStyle}">DBSCAN</th>
          </tr>
        </thead>
        <tbody>
          ${buildRows(validFoods)}
          ${outlierFoods.length > 0 ? `
            <tr>
              <td colspan="9" style="padding:8px 10px;font-size:11px;color:#f87171;font-weight:600;background:rgba(248,113,113,0.05);border-top:1px dashed rgba(248,113,113,0.2)">
                ⛔ פריטי DBSCAN -1 — חסומים לפרופיל פרטי, גלויים בלבד למצב קליני
              </td>
            </tr>
            ${buildRows(outlierFoods)}
          ` : ''}
        </tbody>
      </table>
    </div>`;

  openModal(`🧬 אשכול ${clusterIdx} — ${cluster.nameShort}`, tableHTML);
}

/* ============================================================
   SECTION 26 — INIT
   Wait for all modules to load then boot.
============================================================ */
function waitForModules(callback, maxWait = 5000) {
  const start = Date.now();
  const check = () => {
    if (window.NutriAgent && window.NutriAgentAPI) {
      callback();
    } else if (Date.now() - start < maxWait) {
      setTimeout(check, 50);
    } else {
      console.error('[NutriAgent UI] Modules failed to load within timeout.');
      document.body.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#f87171;font-family:sans-serif;font-size:18px;">' +
        '❌ שגיאה בטעינת המודולים. אנא רענן את הדף.' +
        '</div>';
    }
  };
  check();
}

document.addEventListener('DOMContentLoaded', () => {
  waitForModules(boot);
});

console.log(
  '%c🎨 NutriAgent UI Controller Loaded',
  'color:#a78bfa;font-weight:bold;font-size:14px',
);
