// Numacore — Stress Management App feature-discovery survey.
// Shows an invitation card on the homepage, runs the survey in a multi-step modal,
// saves answers to Firestore (`survey_responses`, one doc per respondent, updated
// after every step so partial answers are kept) and logs funnel events to Analytics.
//
// Force it open with ?survey=1 (e.g. for a link in an email or social post).

const FIREBASE_VERSION = "10.14.1";
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyClQjsIZVJ9Hzh1s00aaU-5Bguzk88WtI0",
  authDomain: "numacore-ios.firebaseapp.com",
  projectId: "numacore-ios",
  storageBucket: "numacore-ios.firebasestorage.app",
  messagingSenderId: "645099569919",
  appId: "1:645099569919:web:55b9efca03715f2e9cc2ca",
  measurementId: "G-D9QT6ZV8R7",
};
const SURVEY_ID = "feature_discovery_v1";
const COLLECTION = "survey_responses";
const STORAGE_KEY = "nmc_survey_" + SURVEY_ID;
const SHOW_AFTER_MS = 6000;
const SHOW_AFTER_SCROLL = 0.35;
const RESHOW_AFTER_DISMISS_DAYS = 14;

// ---------------------------------------------------------------------------
// Survey content (from the "Feature Discovery Survey" doc)
// ---------------------------------------------------------------------------

const FEATURES = [
  "Personalized stress-relief plans based on your behavior",
  "Quick exercises under 5 minutes",
  "AI-based recommendations based on mood",
  "Real-time stress detection (wearables / phone usage)",
  "Guided breathing & meditation",
  "Journaling with prompts",
  "Progress tracking & insights",
  "Reminders / nudges",
  "Sleep improvement tools",
  "Integration with calendar/work schedule",
  "Access to expert content (psychologists, coaches)",
  "Anonymous community support",
  "Gamification (streaks, rewards)",
];

const STEPS = [
  {
    id: "screening",
    title: "A bit about you",
    questions: [
      { id: "stress_frequency", type: "single", required: true, label: "How often do you feel stressed?",
        options: ["Daily", "Several times a week", "Occasionally", "Rarely"] },
      { id: "used_wellness_app", type: "single", required: true,
        label: "Have you ever used a stress, meditation, or mental wellness app?",
        options: ["Yes (currently using)", "Yes (used before, stopped)", "No"] },
      { id: "favorite_apps", type: "text", label: "What are your favorite 5 apps you use the most and why?" },
    ],
  },
  {
    id: "current_behavior",
    title: "How you handle stress today",
    questions: [
      { id: "manage_stress", type: "multi", required: true, other: true,
        label: "What do you currently do to manage stress?", hint: "Select all that apply.",
        options: ["Exercise", "Meditation / breathing", "Talking to someone", "Watching content (TV/social media)", "Nothing specific"] },
      { id: "frustrations", type: "text", label: "What frustrates you most about managing stress today?" },
      { id: "why_stopped", type: "multi", other: true,
        showIf: (a) => a.used_wellness_app && a.used_wellness_app !== "No",
        label: "If you’ve used apps before, why did you stop?", hint: "Select all that apply.",
        options: ["Didn’t see results", "Too time-consuming", "Too generic / not personalized", "Got bored", "Too expensive", "Hard to use consistently"] },
    ],
  },
  {
    id: "feature_importance",
    title: "Which features matter to you?",
    questions: [
      { id: "feature_ratings", type: "rating", required: true, items: FEATURES,
        label: "How valuable would these features be to you?",
        scale: ["Not important", "Very important"] },
    ],
  },
  {
    id: "prioritization",
    title: "If you had to choose",
    questions: [
      { id: "top_3_features", type: "multi", required: true, max: 3, options: FEATURES,
        label: "If you could only choose 3 features, which matter most?", hint: "Pick up to 3." },
      { id: "priority_ranking", type: "rank",
        label: "Rank these in order of importance", hint: "Use the arrows to move the most important to the top.",
        options: ["Speed (fast relief)", "Personalization", "Scientific credibility", "Ease of use", "Cost"] },
    ],
  },
  {
    id: "willingness_to_pay",
    title: "Pricing",
    questions: [
      { id: "would_pay", type: "single", required: true,
        label: "Would you pay for a stress management app that actually works?", options: ["Yes", "Maybe", "No"] },
      { id: "monthly_price", type: "single", required: true,
        label: "What would you expect to pay monthly?", options: ["Free only", "$1–5", "$5–10", "$10–20", "$20+"] },
      { id: "worth_paying_for", type: "text", label: "What would make it worth paying for?" },
    ],
  },
  {
    id: "usage_preferences",
    title: "How you'd use it",
    questions: [
      { id: "relief_moments", type: "multi", required: true, hint: "Select all that apply.",
        label: "When do you typically need stress relief most?",
        options: ["Morning", "During work", "Evening", "Before sleep", "During stressful events"] },
      { id: "session_length", type: "single", required: true,
        label: "How much time would you realistically spend per session?",
        options: ["< 2 minutes", "2–5 minutes", "5–10 minutes", "10+ minutes"] },
      { id: "preferred_format", type: "single", required: true, label: "Preferred format",
        options: ["Audio-guided", "Visual / interactive", "Text-based", "Combination"] },
    ],
  },
  {
    id: "differentiation",
    title: "One last big question",
    questions: [
      { id: "one_thing", type: "text",
        label: "If an app could do ONE thing perfectly to reduce your stress, what would it be?" },
    ],
  },
  {
    id: "segmentation",
    title: "About you (optional)",
    questions: [
      { id: "occupation", type: "short", label: "Occupation" },
      { id: "parent", type: "single", label: "Are you a parent?", options: ["Yes", "No", "Prefer not to say"] },
      { id: "age_range", type: "single", label: "Age range",
        options: ["Under 18", "18–24", "25–34", "35–44", "45–54", "55–64", "65+"] },
    ],
  },
  {
    id: "beta",
    title: "Join the beta",
    questions: [
      { id: "beta_interest", type: "single", required: true,
        label: "Would you like to become a beta user?", options: ["Yes", "No"] },
      { id: "beta_email", type: "email", required: true,
        showIf: (a) => a.beta_interest === "Yes",
        label: "Where should we send your invite?", hint: "We'll only use this to invite you to the Numacore beta." },
    ],
  },
];

// ---------------------------------------------------------------------------
// Storage helpers (all wrapped: storage can be blocked or throw)
// ---------------------------------------------------------------------------

function readState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || {}; } catch { return {}; }
}
function writeState(patch) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readState(), ...patch })); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Firebase (loaded from the official CDN; Firestore only once someone starts)
// ---------------------------------------------------------------------------

const cdn = (m) => `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-${m}.js`;
let appPromise, analyticsPromise, dbPromise;

function getApp() {
  appPromise ??= import(cdn("app")).then(({ initializeApp, getApps }) =>
    getApps()[0] || initializeApp(FIREBASE_CONFIG));
  return appPromise;
}
function getAnalyticsInstance() {
  analyticsPromise ??= Promise.all([getApp(), import(cdn("analytics"))]).then(async ([app, mod]) =>
    (await mod.isSupported()) ? { analytics: mod.getAnalytics(app), logEvent: mod.logEvent } : null
  ).catch(() => null);
  return analyticsPromise;
}
function getDb() {
  dbPromise ??= Promise.all([getApp(), import(cdn("firestore"))]).then(([app, mod]) => ({ db: mod.getFirestore(app), mod }));
  return dbPromise;
}

function track(name, params = {}) {
  getAnalyticsInstance().then((a) => {
    if (a) a.logEvent(a.analytics, name, { survey_id: SURVEY_ID, ...params });
  });
}

let responseId = null;
const SAVE_TIMEOUT_MS = 10000;
async function saveResponse(answers, extra) {
  try {
    return await Promise.race([
      writeResponse(answers, extra),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), SAVE_TIMEOUT_MS)),
    ]);
  } catch (err) {
    console.warn("[survey] could not save response", err);
    return false;
  }
}
async function writeResponse(answers, extra) {
  {
    const { db, mod } = await getDb();
    const { doc, collection, setDoc, serverTimestamp } = mod;
    const isNew = !responseId;
    const ref = isNew ? doc(collection(db, COLLECTION)) : doc(db, COLLECTION, responseId);
    responseId = ref.id;
    const data = { surveyId: SURVEY_ID, answers, updatedAt: serverTimestamp(), ...extra };
    if (isNew) {
      Object.assign(data, {
        createdAt: serverTimestamp(),
        page: location.pathname + location.hash,
        referrer: document.referrer || null,
        language: navigator.language || null,
        device: matchMedia("(max-width: 768px)").matches ? "mobile" : "desktop",
        source: new URLSearchParams(location.search).get("utm_source") || null,
      });
    }
    await setDoc(ref, data, { merge: true });
    return true;
  }
}

// A completed response that could not be sent is kept on this device and retried on
// the next visit (same document id, so a late delivery never creates a duplicate).
async function flushPending() {
  const { pending } = readState();
  if (!pending) return;
  responseId = pending.id;
  if (await saveResponse(pending.answers, pending.extra)) {
    writeState({ pending: null });
    track("survey_pending_flushed");
  }
  responseId = null;
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "text") el.textContent = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
}

// ---------------------------------------------------------------------------
// Invitation card
// ---------------------------------------------------------------------------

let inviteEl = null;

function showInvite() {
  if (inviteEl || document.querySelector(".nmc-survey-backdrop")) return;
  inviteEl = h("aside", { class: "nmc-survey-invite", role: "dialog", "aria-labelledby": "nmc-invite-title" },
    h("button", { class: "nmc-survey-close", "aria-label": "Close", onclick: () => dismissInvite() }, "×"),
    h("span", { class: "nmc-survey-invite__eyebrow", text: "Help shape Numacore" }),
    h("h2", { id: "nmc-invite-title", text: "What would make stress easier to manage for you?" }),
    h("p", { text: "Take our 4-minute survey and tell us which features you'd actually use. You can also sign up for the beta." }),
    h("div", { class: "nmc-survey-invite__actions" },
      h("button", { class: "nmc-btn nmc-btn--primary", onclick: () => { removeInvite(); openSurvey("invite"); } }, "Take the survey"),
      h("button", { class: "nmc-btn nmc-btn--ghost", onclick: () => dismissInvite() }, "Not now"),
    ),
  );
  document.body.append(inviteEl);
  requestAnimationFrame(() => requestAnimationFrame(() => inviteEl && inviteEl.classList.add("is-visible")));
  writeState({ lastShownAt: Date.now() });
  track("survey_invite_shown");
}

function removeInvite() {
  if (!inviteEl) return;
  inviteEl.remove();
  inviteEl = null;
}

function dismissInvite() {
  removeInvite();
  writeState({ status: "dismissed", dismissedAt: Date.now() });
  track("survey_invite_dismissed");
}

// ---------------------------------------------------------------------------
// Survey modal
// ---------------------------------------------------------------------------

function openSurvey(entry) {
  if (document.querySelector(".nmc-survey-backdrop")) return;
  const answers = {};
  let stepIndex = 0;
  let finished = false;
  const lastFocus = document.activeElement;

  track("survey_started", { entry });
  writeState({ status: "started", startedAt: Date.now() });

  const progressBar = h("div", { class: "nmc-survey-progress__bar" });
  const stepLabel = h("div", { class: "nmc-survey-step-label" });
  const title = h("h2", { id: "nmc-survey-title" });
  const body = h("div", { class: "nmc-survey-body" });
  const error = h("p", { class: "nmc-survey-error", role: "alert" });
  const backBtn = h("button", { class: "nmc-btn nmc-btn--ghost", onclick: () => go(-1) }, "Back");
  const nextBtn = h("button", { class: "nmc-btn nmc-btn--primary", onclick: () => go(1) }, "Next");
  const footer = h("div", { class: "nmc-survey-footer" }, backBtn, nextBtn);
  const modal = h("div", { class: "nmc-survey-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "nmc-survey-title" },
    h("div", { class: "nmc-survey-progress" }, progressBar),
    h("button", { class: "nmc-survey-close", "aria-label": "Close survey", onclick: () => close() }, "×"),
    h("div", { class: "nmc-survey-header" }, stepLabel, title),
    body,
    footer,
  );
  const backdrop = h("div", { class: "nmc-survey-backdrop", onclick: (e) => { if (e.target === backdrop) close(); } }, modal);
  const prevOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = "hidden";
  document.body.append(backdrop);

  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key !== "Tab") return;
    const focusable = [...modal.querySelectorAll("button, input, textarea, [tabindex]:not([tabindex='-1'])")]
      .filter((el) => !el.disabled && el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  document.addEventListener("keydown", onKey);

  function visibleQuestions(step) {
    return step.questions.filter((q) => !q.showIf || q.showIf(answers));
  }

  function render() {
    const step = STEPS[stepIndex];
    stepLabel.textContent = `Step ${stepIndex + 1} of ${STEPS.length}`;
    title.textContent = step.title;
    progressBar.style.width = `${(stepIndex / STEPS.length) * 100}%`;
    backBtn.style.visibility = stepIndex === 0 ? "hidden" : "visible";
    nextBtn.textContent = stepIndex === STEPS.length - 1 ? "Submit" : "Next";
    error.textContent = "";
    body.replaceChildren(...visibleQuestions(step).map(renderQuestion), error);
    body.scrollTop = 0;
    const firstInput = body.querySelector("input, textarea");
    (firstInput || nextBtn).focus({ preventScroll: true });
  }

  function questionShell(q, ...content) {
    const name = `nmc-${q.id}`;
    const optional = !q.required ? h("span", { class: "nmc-q__optional", text: " (optional)" }) : null;
    const usesFieldset = ["single", "multi", "rating", "rank"].includes(q.type);
    const labelEl = usesFieldset
      ? h("legend", {}, q.label, optional)
      : h("label", { class: "nmc-q__title", for: name }, q.label, optional);
    return h(usesFieldset ? "fieldset" : "div", { class: "nmc-q" },
      labelEl,
      q.hint ? h("p", { class: "nmc-q__hint", text: q.hint }) : null,
      ...content);
  }

  function renderQuestion(q) {
    const name = `nmc-${q.id}`;
    switch (q.type) {
      case "single":
      case "multi": {
        const isMulti = q.type === "multi";
        const current = answers[q.id];
        const selected = new Set(isMulti ? current || [] : current ? [current] : []);
        const otherInput = q.other
          ? h("input", { class: "nmc-input nmc-other", type: "text", placeholder: "Other (please specify)",
              "aria-label": `${q.label} — other`, value: answers[`${q.id}_other`] || "",
              oninput: (e) => { answers[`${q.id}_other`] = e.target.value.trim(); } })
          : null;
        const inputs = [];
        const syncMax = () => {
          if (!q.max) return;
          const full = (answers[q.id] || []).length >= q.max;
          inputs.forEach((i) => { i.disabled = full && !i.checked; });
        };
        const opts = q.options.map((opt) => {
          const input = h("input", { type: isMulti ? "checkbox" : "radio", name, value: opt, checked: selected.has(opt) });
          input.addEventListener("change", () => {
            if (isMulti) {
              answers[q.id] = inputs.filter((i) => i.checked).map((i) => i.value);
              syncMax();
            } else {
              answers[q.id] = opt;
              // Re-render when a later question depends on this answer.
              if (STEPS[stepIndex].questions.some((x) => x.showIf)) rerenderKeepingScroll();
            }
          });
          inputs.push(input);
          return h("label", { class: "nmc-opt" }, input, h("span", { text: opt }));
        });
        const wrap = questionShell(q, h("div", { class: "nmc-opts" }, opts), otherInput);
        syncMax();
        return wrap;
      }
      case "text":
        return questionShell(q, h("textarea", { id: name, class: "nmc-textarea", maxlength: "2000",
          oninput: (e) => { answers[q.id] = e.target.value.trim(); } }, answers[q.id] || ""));
      case "short":
      case "email":
        return questionShell(q, h("input", { id: name, class: "nmc-input", type: q.type === "email" ? "email" : "text",
          autocomplete: q.type === "email" ? "email" : "organization-title", maxlength: "200", value: answers[q.id] || "",
          oninput: (e) => { answers[q.id] = e.target.value.trim(); } }));
      case "rating": {
        const ratings = answers[q.id] || (answers[q.id] = {});
        const rows = q.items.map((item, idx) => {
          const group = `${name}-${idx}`;
          return h("div", { class: "nmc-rating", role: "radiogroup", "aria-label": item },
            h("span", { class: "nmc-rating__label", text: item }),
            h("div", { class: "nmc-rating__dots" }, [1, 2, 3, 4, 5].map((n) => {
              const input = h("input", { type: "radio", name: group, value: String(n), checked: ratings[item] === n,
                "aria-label": `${item}: ${n} of 5` });
              input.addEventListener("change", () => { ratings[item] = n; });
              return h("label", { class: "nmc-opt" }, input, h("span", { text: String(n) }));
            })));
        });
        return questionShell(q,
          h("div", { class: "nmc-scale-legend" }, h("span", { text: `1 = ${q.scale[0]}` }), h("span", { text: `5 = ${q.scale[1]}` })),
          rows);
      }
      case "rank": {
        if (!answers[q.id]) answers[q.id] = [...q.options];
        const list = h("ol", { class: "nmc-rank" });
        const draw = (focusIdx, dir) => {
          const order = answers[q.id];
          list.replaceChildren(...order.map((opt, i) => h("li", {},
            h("span", { class: "nmc-rank__pos", text: String(i + 1) }),
            h("span", { class: "nmc-rank__label", text: opt }),
            h("button", { class: "nmc-rank__btn", type: "button", "aria-label": `Move ${opt} up`, disabled: i === 0,
              onclick: () => move(i, -1) }, "↑"),
            h("button", { class: "nmc-rank__btn", type: "button", "aria-label": `Move ${opt} down`, disabled: i === order.length - 1,
              onclick: () => move(i, 1) }, "↓"),
          )));
          if (focusIdx != null) {
            const btn = list.children[focusIdx]?.querySelectorAll("button")[dir < 0 ? 0 : 1];
            (btn && !btn.disabled ? btn : list.children[focusIdx]?.querySelector("button:not(:disabled)"))?.focus();
          }
        };
        const move = (i, dir) => {
          const order = answers[q.id];
          const j = i + dir;
          [order[i], order[j]] = [order[j], order[i]];
          answers[`${q.id}_touched`] = true;
          draw(j, dir);
        };
        draw();
        return questionShell(q, list);
      }
    }
    return null;
  }

  function rerenderKeepingScroll() {
    const top = body.scrollTop;
    const active = document.activeElement?.value;
    render();
    body.scrollTop = top;
    if (active) body.querySelector(`input[value="${CSS.escape(active)}"]`)?.focus({ preventScroll: true });
  }

  function validate(step) {
    for (const q of visibleQuestions(step)) {
      if (!q.required) continue;
      const v = answers[q.id];
      if (q.type === "rating") {
        const missing = q.items.filter((i) => !(v && v[i]));
        if (missing.length) return `Please rate every feature (${missing.length} left).`;
      } else if (q.type === "multi") {
        if (!(v && v.length) && !answers[`${q.id}_other`]) return `Please answer: “${q.label}”`;
      } else if (q.type === "email") {
        if (!v || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "Please enter a valid email address.";
      } else if (!v) {
        return `Please answer: “${q.label}”`;
      }
    }
    return "";
  }

  // Only keep answers to questions that are currently visible (e.g. drop the email if
  // someone said "Yes" to the beta and then changed their mind).
  function cleanAnswers() {
    const out = {};
    for (const step of STEPS) {
      for (const q of visibleQuestions(step)) {
        if (answers[q.id] !== undefined && answers[q.id] !== "") out[q.id] = answers[q.id];
        if (answers[`${q.id}_other`]) out[`${q.id}_other`] = answers[`${q.id}_other`];
      }
    }
    if (out.priority_ranking && !answers.priority_ranking_touched) delete out.priority_ranking;
    return out;
  }

  async function go(dir) {
    const step = STEPS[stepIndex];
    if (dir > 0) {
      const msg = validate(step);
      if (msg) { error.textContent = msg; return; }
      track("survey_step_completed", { step: stepIndex + 1, step_name: step.id });
      const isLast = stepIndex === STEPS.length - 1;
      if (isLast) {
        nextBtn.disabled = true;
        nextBtn.textContent = "Sending…";
        const final = cleanAnswers();
        const extra = { status: "completed", lastStep: step.id, completedAt: new Date().toISOString() };
        const ok = await saveResponse(final, extra);
        finished = true;
        writeState({ status: "completed", completedAt: Date.now(), pending: ok ? null : { id: responseId, answers: final, extra } });
        // Closed answers also go to Analytics, so the headline numbers are there even
        // without Firestore. Open-ended text and the email stay out of Analytics.
        track("survey_completed", {
          saved: ok,
          beta_optin: answers.beta_interest === "Yes",
          stress_frequency: final.stress_frequency,
          used_wellness_app: final.used_wellness_app,
          would_pay: final.would_pay,
          monthly_price: final.monthly_price,
          session_length: final.session_length,
          preferred_format: final.preferred_format,
          top_3_features: (final.top_3_features || []).join(" | ").slice(0, 100),
        });
        if (answers.beta_interest === "Yes") track("survey_beta_optin");
        showThanks();
        return;
      }
      // Keep partial answers in case people drop off later on.
      saveResponse(cleanAnswers(), { status: "in_progress", lastStep: step.id });
    }
    stepIndex = Math.max(0, Math.min(STEPS.length - 1, stepIndex + dir));
    render();
  }

  function showThanks() {
    progressBar.style.width = "100%";
    const beta = answers.beta_interest === "Yes";
    const closeBtn = h("button", { class: "nmc-btn nmc-btn--primary", onclick: () => close() }, "Back to Numacore");
    modal.replaceChildren(
      h("div", { class: "nmc-survey-progress" }, progressBar),
      h("div", { class: "nmc-survey-thanks" },
        h("div", { class: "nmc-survey-thanks__icon", "aria-hidden": "true", text: "💚" }),
        h("h2", { id: "nmc-survey-title", text: "Thank you!" }),
        h("p", { text: beta
          ? "Your answers help us build something that actually works. We'll be in touch about the beta soon."
          : "Your answers help us build something that actually works." }),
        closeBtn));
    closeBtn.focus();
  }

  function close() {
    if (!finished) {
      track("survey_closed", { step: stepIndex + 1, step_name: STEPS[stepIndex].id });
      writeState({ status: "dismissed", dismissedAt: Date.now() });
    }
    document.removeEventListener("keydown", onKey);
    document.documentElement.style.overflow = prevOverflow;
    backdrop.remove();
    if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
  }

  render();
}

// ---------------------------------------------------------------------------
// When to show the invitation
// ---------------------------------------------------------------------------

function isHomepage() {
  const route = (location.hash.replace(/^#/, "") || "/").split("?")[0];
  return route === "/" || route === "";
}

function shouldInvite() {
  const s = readState();
  if (s.status === "completed") return false;
  if (s.status === "dismissed" && Date.now() - (s.dismissedAt || 0) < RESHOW_AFTER_DISMISS_DAYS * 864e5) return false;
  return true;
}

function init() {
  // Warm up Analytics so page-level data flows even if nobody opens the survey.
  getAnalyticsInstance();
  flushPending();

  if (new URLSearchParams(location.search).get("survey") === "1") {
    openSurvey("link");
    return;
  }
  if (!shouldInvite()) return;

  let timer = null;
  const trigger = () => {
    cleanup();
    if (isHomepage() && shouldInvite()) showInvite();
  };
  const onScroll = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    if (max > 0 && scrollY / max >= SHOW_AFTER_SCROLL) trigger();
  };
  const arm = () => {
    if (timer || !isHomepage()) return;
    timer = setTimeout(trigger, SHOW_AFTER_MS);
    addEventListener("scroll", onScroll, { passive: true });
  };
  const cleanup = () => {
    clearTimeout(timer);
    removeEventListener("scroll", onScroll);
  };
  // The site is a hash-routed SPA: hide the card when people leave the homepage.
  addEventListener("hashchange", () => {
    if (!isHomepage()) { removeInvite(); cleanup(); timer = null; }
    else arm();
  });
  arm();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
