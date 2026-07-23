import { sections, questionIndex } from "./survey-schema.js";
import {
  computeCompletion,
  createInitialWorkflow,
  deepClone,
  isQuestionVisible,
  isSectionComplete,
  makeId,
  normalizeOption,
  screeningOutcome,
  validateQuestion,
  validateSection,
  validateSurvey,
  visibleMatrixRows,
  workflowToText,
} from "./survey-core.js";
import { surveyStore } from "./storage.js";

const elements = {
  sectionList: document.querySelector("#section-list"),
  sectionKicker: document.querySelector("#section-kicker"),
  sectionTitle: document.querySelector("#section-title"),
  sectionIntro: document.querySelector("#section-intro"),
  questionStack: document.querySelector("#question-stack"),
  form: document.querySelector("#survey-form"),
  backButton: document.querySelector("#back-button"),
  nextButton: document.querySelector("#next-button"),
  submitButton: document.querySelector("#submit-button"),
  saveButton: document.querySelector("#save-button"),
  railSaveButton: document.querySelector("#rail-save-button"),
  resumeButton: document.querySelector("#resume-button"),
  progressFill: document.querySelector("#progress-fill"),
  completionPercent: document.querySelector("#completion-percent"),
  answeredCount: document.querySelector("#answered-count"),
  ringValue: document.querySelector("#ring-value"),
  responseStatus: document.querySelector("#response-status"),
  responseVersion: document.querySelector("#response-version"),
  saveStatus: document.querySelector("#save-status"),
  screenoutPanel: document.querySelector("#screenout-panel"),
  recoveryDialog: document.querySelector("#recovery-dialog"),
  recoveryInput: document.querySelector("#recovery-input"),
  recoveryError: document.querySelector("#recovery-error"),
  recoveryLoadButton: document.querySelector("#recovery-load-button"),
  keyDialog: document.querySelector("#key-dialog"),
  keyDialogKicker: document.querySelector("#key-dialog-kicker"),
  keyDialogTitle: document.querySelector("#key-dialog-title"),
  keyDialogMessage: document.querySelector("#key-dialog-message"),
  keyDialogClose: document.querySelector("#key-dialog-close"),
  keyDialogDone: document.querySelector("#key-dialog-done"),
  recoveryKeyDisplay: document.querySelector("#recovery-key-display"),
  copyKeyButton: document.querySelector("#copy-key-button"),
  downloadKeyButton: document.querySelector("#download-key-button"),
  submitDialog: document.querySelector("#submit-dialog"),
  submittedVersion: document.querySelector("#submitted-version"),
  submittedKey: document.querySelector("#submitted-key"),
  copySubmittedKey: document.querySelector("#copy-submitted-key"),
  submitDialogDone: document.querySelector("#submit-dialog-done"),
  exportResponseButton: document.querySelector("#export-response-button"),
  demoFillButton: document.querySelector("#demo-fill-button"),
  mobileNavToggle: document.querySelector("#mobile-nav-toggle"),
  sidebar: document.querySelector("#section-nav"),
  toastRegion: document.querySelector("#toast-region"),
};

const state = {
  currentSection: 0,
  answers: {},
  status: "new",
  version: 0,
  createdAt: new Date().toISOString(),
  updatedAt: null,
  submittedAt: null,
  recoveryKey: surveyStore.getActiveKey(),
  validationErrors: new Map(),
  lastSavedAt: null,
};

let autosaveTimer = null;
let draggedStageId = null;

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function answerValue(id, fallback = "") {
  return state.answers[id] ?? fallback;
}

function ensureSpecialAnswer(question) {
  if (question.type === "constantSum" && !state.answers[question.id]) {
    state.answers[question.id] = Object.fromEntries(question.items.map((item) => [item.key, ""]));
  }
  if (question.type === "matrix" && !state.answers[question.id]) state.answers[question.id] = {};
  if (question.type === "fields" && !state.answers[question.id]) state.answers[question.id] = {};
  if (question.type === "toolRepeater" && !state.answers[question.id]) state.answers[question.id] = [];
  if (question.type === "workflow" && !state.answers[question.id]) state.answers[question.id] = createInitialWorkflow();
}

function questionHeader(question) {
  const required = question.required ? '<span class="required-mark" aria-label="required">*</span>' : "";
  return `
    <header class="question-header">
      <span class="question-code">${escapeHtml(question.id)}</span>
      <div class="question-title-wrap">
        <h3 class="question-title" id="label-${escapeHtml(question.id)}">${escapeHtml(question.prompt)} ${required}</h3>
        ${question.help ? `<p class="question-help">${escapeHtml(question.help)}</p>` : ""}
        ${question.example ? `<p class="question-example"><strong>Example:</strong> ${escapeHtml(question.example)}</p>` : ""}
      </div>
    </header>`;
}

function wrapQuestion(question, body) {
  const error = state.validationErrors.get(question.id) || "";
  return `
    <article class="question-card ${error ? "has-error" : ""}" id="q-${escapeHtml(question.id)}" data-question-card="${escapeHtml(question.id)}">
      ${questionHeader(question)}
      ${body}
      <p class="field-error" id="error-${escapeHtml(question.id)}" role="alert">${escapeHtml(error)}</p>
    </article>`;
}

function renderInfo(question) {
  return `
    <article class="info-card ${question.tone === "accent" ? "info-accent" : ""}">
      <h3>${escapeHtml(question.title)}</h3>
      ${(question.paragraphs || []).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
      ${question.bullets?.length ? `<ul>${question.bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
    </article>`;
}

function renderText(question) {
  const value = answerValue(question.id);
  const inputType = question.type === "email" ? "email" : question.type === "url" ? "url" : "text";
  return wrapQuestion(
    question,
    `<input
      class="text-input"
      id="input-${escapeHtml(question.id)}"
      aria-labelledby="label-${escapeHtml(question.id)}"
      aria-describedby="error-${escapeHtml(question.id)}"
      data-kind="scalar"
      data-question="${escapeHtml(question.id)}"
      type="${inputType}"
      value="${escapeHtml(value)}"
      placeholder="${escapeHtml(question.placeholder || "")}"
      ${question.autocomplete ? `autocomplete="${escapeHtml(question.autocomplete)}"` : ""}
    />`,
  );
}

function renderTextarea(question) {
  const value = answerValue(question.id);
  return wrapQuestion(
    question,
    `<textarea
      class="text-area"
      id="input-${escapeHtml(question.id)}"
      aria-labelledby="label-${escapeHtml(question.id)}"
      aria-describedby="error-${escapeHtml(question.id)}"
      data-kind="scalar"
      data-question="${escapeHtml(question.id)}"
      rows="${question.rows || 4}"
    >${escapeHtml(value)}</textarea>`,
  );
}

function renderFields(question) {
  const answer = answerValue(question.id, {});
  const body = `<div class="field-grid">${question.fields
    .map(
      (field) => `
        <div class="field-group">
          <label class="field-label" for="${question.id}-${field.key}">${escapeHtml(field.label)}</label>
          <input
            class="text-input"
            id="${question.id}-${field.key}"
            data-kind="field"
            data-question="${question.id}"
            data-field-key="${field.key}"
            value="${escapeHtml(answer[field.key] || "")}"
            placeholder="${escapeHtml(field.placeholder || "")}"
          />
        </div>`,
    )
    .join("")}</div>`;
  return wrapQuestion(question, body);
}

function renderChoices(question) {
  const isCheckbox = question.type === "checkboxes";
  const selected = isCheckbox ? answerValue(question.id, []) : answerValue(question.id);
  const inputType = isCheckbox ? "checkbox" : "radio";
  const options = question.options.map(normalizeOption);
  const body = `<div class="choice-list" role="${isCheckbox ? "group" : "radiogroup"}" aria-labelledby="label-${question.id}">
    ${options
      .map((option, index) => {
        const checked = isCheckbox ? selected.includes(option.value) : selected === option.value;
        const otherValue = answerValue(`${question.id}__other`);
        return `
          <label class="choice-row">
            <input
              type="${inputType}"
              name="${question.id}"
              value="${escapeHtml(option.value)}"
              data-kind="${isCheckbox ? "checkbox" : "radio"}"
              data-question="${question.id}"
              ${checked ? "checked" : ""}
            />
            <span class="choice-label">${escapeHtml(option.label)}</span>
            ${
              option.other && checked
                ? `<input class="text-input inline-other" data-kind="other" data-question="${question.id}" value="${escapeHtml(otherValue)}" placeholder="Please specify" aria-label="Other response for ${question.id}" />`
                : ""
            }
          </label>`;
      })
      .join("")}
  </div>`;
  return wrapQuestion(question, body);
}

function renderLikert(question) {
  const selected = answerValue(question.id);
  const body = `<div class="scale-grid" role="radiogroup" aria-labelledby="label-${question.id}">
    ${question.options
      .map(
        (option, index) => `
          <label class="scale-option">
            <input type="radio" name="${question.id}" value="${escapeHtml(option.value)}" data-kind="radio" data-question="${question.id}" ${selected === option.value ? "checked" : ""} />
            <span class="scale-number">${index + 1}</span>
            <span class="scale-label">${escapeHtml(option.label)}</span>
          </label>`,
      )
      .join("")}
  </div>`;
  return wrapQuestion(question, body);
}

function renderConstantSum(question) {
  const answer = answerValue(question.id, {});
  const total = question.items.reduce((sum, item) => sum + Number(answer[item.key] || 0), 0);
  const body = `
    <div class="constant-sum-list">
      ${question.items
        .map(
          (item) => `
            <div class="constant-sum-row">
              <label for="${question.id}-${item.key}">${escapeHtml(item.label)}</label>
              <div class="number-wrap">
                <input class="number-input" id="${question.id}-${item.key}" type="number" min="0" max="100" step="1" inputmode="numeric" data-kind="constant" data-question="${question.id}" data-item-key="${item.key}" value="${escapeHtml(answer[item.key] ?? "")}" />
                <span>%</span>
              </div>
            </div>`,
        )
        .join("")}
    </div>
    <div class="sum-total ${total === 100 ? "" : "is-invalid"}" id="sum-${question.id}"><span>Total</span><strong>${total}% / 100%</strong></div>`;
  return wrapQuestion(question, body);
}

function renderMatrix(question) {
  const answer = answerValue(question.id, {});
  const rows = visibleMatrixRows(question, state.answers);
  const body = `
    <div class="matrix-scroll">
      <table class="matrix-table">
        <thead>
          <tr>
            <th class="matrix-row-label" scope="col">Stage / statement</th>
            ${question.columns.map((column) => `<th scope="col">${escapeHtml(column.label)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  <td class="matrix-row-label">${escapeHtml(row.label)}</td>
                  ${question.columns
                    .map(
                      (column) => `
                        <td class="matrix-cell">
                          <label>
                            <input
                              type="radio"
                              name="${question.id}-${row.key}"
                              value="${escapeHtml(column.value)}"
                              data-kind="matrix"
                              data-question="${question.id}"
                              data-row-key="${row.key}"
                              aria-label="${escapeHtml(row.label)}: ${escapeHtml(column.label)}"
                              ${answer[row.key] === column.value ? "checked" : ""}
                            />
                          </label>
                        </td>`,
                    )
                    .join("")}
                </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
  return wrapQuestion(question, body);
}

const TOOL_CATEGORIES = [
  "Instrument or experimental equipment",
  "Modeling or simulation software",
  "Data-processing, analysis, or visualization software",
  "Theoretical, symbolic, or formal-computation software",
  "Workflow or orchestration system",
  "Custom or lab-built code",
  "Other",
];

const TOOL_INTERACTIONS = ["Physical controls", "GUI / vendor software", "Web interface", "Command line", "Scripts / macros / notebooks", "API / SDK", "Workflow system"];
const TOOL_LOCATIONS = ["Laboratory / field / shared facility", "Instrument-connected computer", "Local computer / workstation", "HPC cluster", "Cloud / remote service"];
const TOOL_ACCESS = ["Open source", "Free for academic use", "Commercial / institutional license", "Custom / lab-built", "Shared-facility access", "Other"];

function miniChecks(questionId, toolIndex, key, options, selected = []) {
  return `<div class="mini-check-grid">${options
    .map(
      (option) => `
        <label class="mini-check">
          <input type="checkbox" value="${escapeHtml(option)}" data-kind="tool-check" data-question="${questionId}" data-tool-index="${toolIndex}" data-tool-key="${key}" ${selected.includes(option) ? "checked" : ""} />
          <span>${escapeHtml(option)}</span>
        </label>`,
    )
    .join("")}</div>`;
}

function renderToolRepeater(question) {
  const tools = answerValue(question.id, []);
  const cards = tools
    .map(
      (tool, index) => `
        <div class="repeater-card">
          <div class="repeater-card-header">
            <span>TOOL ${String(index + 1).padStart(2, "0")}</span>
            <button class="button button-small button-danger" type="button" data-action="remove-tool" data-question="${question.id}" data-tool-index="${index}">Remove</button>
          </div>
          <div class="repeater-card-body">
            <div class="field-group">
              <label class="field-label" for="${question.id}-tool-${index}-name">Name / model / version</label>
              <input class="text-input" id="${question.id}-tool-${index}-name" data-kind="tool" data-question="${question.id}" data-tool-index="${index}" data-tool-key="name" value="${escapeHtml(tool.name || "")}" />
            </div>
            <div class="field-group">
              <label class="field-label" for="${question.id}-tool-${index}-category">Category</label>
              <select class="select-input" id="${question.id}-tool-${index}-category" data-kind="tool" data-question="${question.id}" data-tool-index="${index}" data-tool-key="category">
                <option value="">Select category</option>
                ${TOOL_CATEGORIES.map((category) => `<option value="${escapeHtml(category)}" ${tool.category === category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}
              </select>
            </div>
            <div class="field-group span-2">
              <label class="field-label" for="${question.id}-tool-${index}-purpose">Main purpose in the workflow</label>
              <input class="text-input" id="${question.id}-tool-${index}-purpose" data-kind="tool" data-question="${question.id}" data-tool-index="${index}" data-tool-key="purpose" value="${escapeHtml(tool.purpose || "")}" placeholder="One sentence" />
            </div>
            <div class="field-group span-2">
              <span class="field-label">How you interact with it</span>
              ${miniChecks(question.id, index, "interaction", TOOL_INTERACTIONS, tool.interaction || [])}
            </div>
            <div class="field-group span-2">
              <span class="field-label">Where it is accessed or run</span>
              ${miniChecks(question.id, index, "location", TOOL_LOCATIONS, tool.location || [])}
            </div>
            <div class="field-group span-2">
              <span class="field-label">Access or license</span>
              ${miniChecks(question.id, index, "access", TOOL_ACCESS, tool.access || [])}
            </div>
          </div>
        </div>`,
    )
    .join("");

  return wrapQuestion(
    question,
    `<div class="repeater-list">${cards || '<div class="info-card"><p>No tools added yet.</p></div>'}</div>
     <div class="repeater-actions"><button class="button button-secondary" type="button" data-action="add-tool" data-question="${question.id}">+ Add central tool</button></div>`,
  );
}

function workflowPreviewInner(workflow) {
  const stages = (workflow.stages || []).filter((stage) => stage.label.trim());
  const labels = new Map(stages.map((stage, index) => [stage.id, { label: stage.label, index: index + 1 }]));
  return `
    <h4>Live workflow preview</h4>
    <div class="workflow-preview-line">
      ${
        stages.length
          ? stages
              .map(
                (stage, index) => `${index ? '<span class="workflow-preview-arrow">→</span>' : ""}<span class="workflow-preview-node">${escapeHtml(stage.label)}</span>`,
              )
              .join("")
          : '<span class="muted">Name stages to build the preview.</span>'
      }
    </div>
    <div class="workflow-preview-connections">
      ${(workflow.connections || [])
        .filter((connection) => labels.has(connection.from) && labels.has(connection.to))
        .map((connection) => {
          const from = labels.get(connection.from);
          const to = labels.get(connection.to);
          return `<span>${connection.type === "loop" ? "↺ LOOP" : "⇢ BRANCH"} · ${escapeHtml(from.label)} → ${escapeHtml(to.label)}${connection.condition ? ` · ${escapeHtml(connection.condition)}` : ""}</span>`;
        })
        .join("")}
    </div>`;
}

function workflowStageOptions(workflow) {
  return workflow.stages
    .map((stage, index) => `<option value="${stage.id}">${index + 1}. ${escapeHtml(stage.label || `Stage ${index + 1}`)}</option>`)
    .join("");
}

function renderWorkflow(question) {
  const workflow = answerValue(question.id, createInitialWorkflow());
  const stageCards = workflow.stages
    .map(
      (stage, index) => `
        <div class="workflow-stage-wrap" data-drop-stage="${stage.id}">
          <div class="workflow-stage" draggable="true" data-stage-id="${stage.id}">
            <span class="stage-number">${String(index + 1).padStart(2, "0")}</span>
            <div class="stage-fields">
              <input class="text-input" data-kind="workflow-stage" data-question="${question.id}" data-stage-id="${stage.id}" data-stage-key="label" value="${escapeHtml(stage.label)}" placeholder="Stage name" aria-label="Stage ${index + 1} name" />
              <input class="text-input" data-kind="workflow-stage" data-question="${question.id}" data-stage-id="${stage.id}" data-stage-key="detail" value="${escapeHtml(stage.detail || "")}" placeholder="Optional method, output, or decision detail" aria-label="Stage ${index + 1} detail" />
            </div>
            <div class="stage-actions">
              <button class="stage-action" type="button" data-action="move-stage-up" data-question="${question.id}" data-stage-index="${index}" ${index === 0 ? "disabled" : ""} aria-label="Move stage ${index + 1} up">↑</button>
              <button class="stage-action" type="button" data-action="move-stage-down" data-question="${question.id}" data-stage-index="${index}" ${index === workflow.stages.length - 1 ? "disabled" : ""} aria-label="Move stage ${index + 1} down">↓</button>
              <button class="stage-action" type="button" data-action="remove-stage" data-question="${question.id}" data-stage-id="${stage.id}" ${workflow.stages.length <= 2 ? "disabled" : ""} aria-label="Remove stage ${index + 1}">×</button>
            </div>
          </div>
        </div>`,
    )
    .join("");

  const connectionChips = (workflow.connections || [])
    .map((connection, index) => {
      const fromIndex = workflow.stages.findIndex((stage) => stage.id === connection.from);
      const toIndex = workflow.stages.findIndex((stage) => stage.id === connection.to);
      if (fromIndex < 0 || toIndex < 0) return "";
      return `<span class="connection-chip ${connection.type}">
        ${connection.type === "loop" ? "↺ LOOP" : "⇢ BRANCH"} · ${fromIndex + 1} → ${toIndex + 1}${connection.condition ? ` · ${escapeHtml(connection.condition)}` : ""}
        <button type="button" data-action="remove-connection" data-question="${question.id}" data-connection-index="${index}" aria-label="Remove connection">×</button>
      </span>`;
    })
    .join("");

  const body = `
    <div class="workflow-builder">
      <div class="workflow-toolbar">
        <span>DRAG OR USE ↑ ↓ TO REORDER</span>
        <div>
          <button class="button button-small" type="button" data-action="load-workflow-example" data-question="${question.id}">Load example</button>
          <button class="button button-small" type="button" data-action="add-stage" data-question="${question.id}">+ Add stage</button>
        </div>
      </div>
      <div class="workflow-stage-list">${stageCards}</div>
      <div class="connection-editor">
        <h4>Add a decision branch or loop</h4>
        <div class="connection-form" data-connection-form="${question.id}">
          <select class="select-input" data-connection-field="type" aria-label="Connection type">
            <option value="loop">Loop back ↺</option>
            <option value="branch">Branch ⇢</option>
          </select>
          <select class="select-input" data-connection-field="from" aria-label="Connection from stage">${workflowStageOptions(workflow)}</select>
          <span class="connection-arrow">→</span>
          <select class="select-input" data-connection-field="to" aria-label="Connection to stage">${workflowStageOptions(workflow)}</select>
          <input class="text-input connection-condition" data-connection-field="condition" placeholder="Condition, e.g. if validation fails" aria-label="Connection condition" />
          <button class="button button-secondary" type="button" data-action="add-connection" data-question="${question.id}">Add</button>
        </div>
        <div class="connection-list">${connectionChips}</div>
      </div>
      <div class="workflow-preview" id="workflow-preview-${question.id}">${workflowPreviewInner(workflow)}</div>
    </div>`;
  return wrapQuestion(question, body);
}

function renderQuestion(question) {
  if (question.type === "info") return renderInfo(question);
  ensureSpecialAnswer(question);
  if (!isQuestionVisible(question, state.answers)) return "";

  if (["text", "email", "url"].includes(question.type)) return renderText(question);
  if (question.type === "textarea") return renderTextarea(question);
  if (question.type === "fields") return renderFields(question);
  if (["radio", "checkboxes"].includes(question.type)) return renderChoices(question);
  if (question.type === "likert") return renderLikert(question);
  if (question.type === "constantSum") return renderConstantSum(question);
  if (question.type === "matrix") return renderMatrix(question);
  if (question.type === "toolRepeater") return renderToolRepeater(question);
  if (question.type === "workflow") return renderWorkflow(question);
  return "";
}

function renderSectionIntro(section) {
  elements.sectionIntro.innerHTML = `
    <h2>${escapeHtml(section.introTitle)}</h2>
    <p>${escapeHtml(section.intro)}</p>
    ${section.bullets?.length ? `<ul>${section.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>` : ""}`;
}

function renderNavigation() {
  elements.sectionList.innerHTML = sections
    .map((section, index) => {
      const complete = isSectionComplete(section, state.answers);
      return `<li>
        <button class="section-nav-button ${complete ? "is-complete" : ""}" type="button" data-nav-section="${index}" ${index === state.currentSection ? 'aria-current="step"' : ""}>
          <span class="section-nav-code">${escapeHtml(section.code)}</span>
          <span class="section-nav-label">${escapeHtml(section.shortTitle)}</span>
          <span class="section-nav-state" aria-hidden="true">${complete ? "✓" : "·"}</span>
        </button>
      </li>`;
    })
    .join("");
}

function renderDashboard() {
  const completion = computeCompletion(sections, state.answers);
  const circumference = 2 * Math.PI * 48;
  const offset = circumference * (1 - completion.percent / 100);
  elements.completionPercent.textContent = `${completion.percent}%`;
  elements.answeredCount.textContent = String(completion.answered);
  elements.ringValue.style.strokeDashoffset = String(offset);
  elements.responseStatus.textContent = state.status === "new" ? "New" : state.status[0].toUpperCase() + state.status.slice(1);
  elements.responseVersion.textContent = state.version ? `v${state.version}` : "—";

  if (state.lastSavedAt) {
    elements.saveStatus.textContent = `Saved ${new Date(state.lastSavedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  } else if (state.recoveryKey) {
    elements.saveStatus.textContent = "Recovery key active";
  } else {
    elements.saveStatus.textContent = "Not saved yet";
  }
}

function render() {
  const section = sections[state.currentSection];
  elements.sectionKicker.textContent = `SECTION ${section.code}`;
  elements.sectionTitle.textContent = section.title;
  elements.progressFill.style.width = `${((state.currentSection + 1) / sections.length) * 100}%`;
  renderSectionIntro(section);
  elements.questionStack.innerHTML = section.questions.map(renderQuestion).join("");
  renderNavigation();
  renderDashboard();

  const screenedOut = section.id === "screening" && screeningOutcome(state.answers) !== "eligible_or_pending";
  elements.screenoutPanel.hidden = !screenedOut;
  elements.backButton.disabled = state.currentSection === 0;
  elements.nextButton.hidden = state.currentSection === sections.length - 1 || screenedOut;
  elements.submitButton.hidden = state.currentSection !== sections.length - 1 || screenedOut;
  elements.saveButton.hidden = screenedOut;
  document.title = `${section.code} · ${section.title} — USW Survey`;
}

function clearQuestionError(questionId) {
  if (!state.validationErrors.has(questionId)) return;
  state.validationErrors.delete(questionId);
  const card = document.querySelector(`[data-question-card="${CSS.escape(questionId)}"]`);
  card?.classList.remove("has-error");
  const error = document.querySelector(`#error-${CSS.escape(questionId)}`);
  if (error) error.textContent = "";
}

function markChanged(questionId) {
  clearQuestionError(questionId);
  if (state.status === "submitted") state.status = "editing";
  renderDashboard();
  scheduleAutosave();
}

function handleFormInput(event) {
  const target = event.target;
  const questionId = target.dataset.question;
  const kind = target.dataset.kind;
  if (!questionId || !kind) return;

  if (kind === "scalar" || kind === "other") {
    const id = kind === "other" ? `${questionId}__other` : questionId;
    state.answers[id] = target.value;
  } else if (kind === "field") {
    state.answers[questionId] ||= {};
    state.answers[questionId][target.dataset.fieldKey] = target.value;
  } else if (kind === "constant") {
    state.answers[questionId] ||= {};
    state.answers[questionId][target.dataset.itemKey] = target.value;
    const question = questionIndex.get(questionId);
    const total = question.items.reduce((sum, item) => sum + Number(state.answers[questionId][item.key] || 0), 0);
    const totalElement = document.querySelector(`#sum-${CSS.escape(questionId)}`);
    if (totalElement) {
      totalElement.classList.toggle("is-invalid", total !== 100);
      totalElement.querySelector("strong").textContent = `${total}% / 100%`;
    }
  } else if (kind === "tool") {
    const index = Number(target.dataset.toolIndex);
    state.answers[questionId][index][target.dataset.toolKey] = target.value;
  } else if (kind === "workflow-stage") {
    const stage = state.answers[questionId].stages.find((item) => item.id === target.dataset.stageId);
    if (stage) stage[target.dataset.stageKey] = target.value;
    const preview = document.querySelector(`#workflow-preview-${CSS.escape(questionId)}`);
    if (preview) preview.innerHTML = workflowPreviewInner(state.answers[questionId]);
  }
  markChanged(questionId);
}

function handleFormChange(event) {
  const target = event.target;
  const questionId = target.dataset.question;
  const kind = target.dataset.kind;
  if (!questionId || !kind) return;

  let requiresRender = false;
  if (kind === "radio") {
    state.answers[questionId] = target.value;
    requiresRender = true;
  } else if (kind === "checkbox") {
    const question = questionIndex.get(questionId);
    let selected = Array.isArray(state.answers[questionId]) ? [...state.answers[questionId]] : [];
    if (target.checked) {
      if (question.exclusiveValue === target.value) {
        selected = [target.value];
      } else {
        selected = selected.filter((value) => value !== question.exclusiveValue);
        if (!selected.includes(target.value)) selected.push(target.value);
      }
    } else {
      selected = selected.filter((value) => value !== target.value);
    }
    state.answers[questionId] = selected;
    requiresRender = true;
  } else if (kind === "matrix") {
    state.answers[questionId] ||= {};
    state.answers[questionId][target.dataset.rowKey] = target.value;
  } else if (kind === "tool-check") {
    const tool = state.answers[questionId][Number(target.dataset.toolIndex)];
    const key = target.dataset.toolKey;
    tool[key] ||= [];
    tool[key] = target.checked ? [...new Set([...tool[key], target.value])] : tool[key].filter((value) => value !== target.value);
  }
  markChanged(questionId);
  if (requiresRender) render();
}

function moveArrayItem(array, from, to) {
  if (from === to || from < 0 || to < 0 || from >= array.length || to >= array.length) return;
  const [item] = array.splice(from, 1);
  array.splice(to, 0, item);
}

function addTool(questionId) {
  state.answers[questionId] ||= [];
  state.answers[questionId].push({ name: "", category: "", purpose: "", interaction: [], location: [], access: [] });
  markChanged(questionId);
  render();
  requestAnimationFrame(() => {
    const inputs = document.querySelectorAll(`[data-kind="tool"][data-question="${CSS.escape(questionId)}"][data-tool-key="name"]`);
    inputs[inputs.length - 1]?.focus();
  });
}

function addStage(questionId) {
  state.answers[questionId].stages.push({ id: makeId("stage"), label: "", detail: "" });
  markChanged(questionId);
  render();
}

function createExampleWorkflow() {
  const labels = ["Research question", "Material synthesis", "Spectroscopy measurement", "Data processing", "Structure analysis", "Validation", "Interpretation"];
  const stages = labels.map((label) => ({ id: makeId("stage"), label, detail: "" }));
  return {
    stages,
    connections: [{ id: makeId("connection"), type: "loop", from: stages[4].id, to: stages[1].id, condition: "if validation indicates a problem" }],
  };
}

function loadWorkflowExample(questionId) {
  state.answers[questionId] = createExampleWorkflow();
  markChanged(questionId);
  render();
}

function addConnection(questionId, button) {
  const form = button.closest(`[data-connection-form="${CSS.escape(questionId)}"]`);
  const type = form.querySelector('[data-connection-field="type"]').value;
  const from = form.querySelector('[data-connection-field="from"]').value;
  const to = form.querySelector('[data-connection-field="to"]').value;
  const condition = form.querySelector('[data-connection-field="condition"]').value.trim();
  if (!from || !to || from === to) {
    showToast("Choose two different stages for the connection.");
    return;
  }
  state.answers[questionId].connections.push({ id: makeId("connection"), type, from, to, condition });
  markChanged(questionId);
  render();
}

function handleActionClick(button) {
  const action = button.dataset.action;
  const questionId = button.dataset.question;
  if (!action) return false;

  if (action === "add-tool") addTool(questionId);
  if (action === "remove-tool") {
    state.answers[questionId].splice(Number(button.dataset.toolIndex), 1);
    markChanged(questionId);
    render();
  }
  if (action === "add-stage") addStage(questionId);
  if (action === "load-workflow-example") loadWorkflowExample(questionId);
  if (action === "move-stage-up" || action === "move-stage-down") {
    const index = Number(button.dataset.stageIndex);
    moveArrayItem(state.answers[questionId].stages, index, action === "move-stage-up" ? index - 1 : index + 1);
    markChanged(questionId);
    render();
  }
  if (action === "remove-stage") {
    const workflow = state.answers[questionId];
    workflow.stages = workflow.stages.filter((stage) => stage.id !== button.dataset.stageId);
    workflow.connections = workflow.connections.filter(
      (connection) => connection.from !== button.dataset.stageId && connection.to !== button.dataset.stageId,
    );
    markChanged(questionId);
    render();
  }
  if (action === "add-connection") addConnection(questionId, button);
  if (action === "remove-connection") {
    state.answers[questionId].connections.splice(Number(button.dataset.connectionIndex), 1);
    markChanged(questionId);
    render();
  }
  return true;
}

function goToSection(index, { focus = true } = {}) {
  state.currentSection = Math.max(0, Math.min(index, sections.length - 1));
  state.validationErrors.clear();
  render();
  if (focus) window.scrollTo({ top: 0, behavior: "smooth" });
  elements.sidebar.classList.remove("is-open");
  elements.mobileNavToggle.setAttribute("aria-expanded", "false");
}

function showValidation(errors) {
  state.validationErrors = new Map(errors.map((error) => [error.id, error.message]));
  render();
  const first = errors[0];
  if (first) {
    requestAnimationFrame(() => {
      const card = document.querySelector(`[data-question-card="${CSS.escape(first.id)}"]`);
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
      card?.querySelector("input, textarea, select, button")?.focus({ preventScroll: true });
    });
  }
}

function nextSection() {
  const section = sections[state.currentSection];
  const errors = validateSection(section, state.answers);
  if (errors.length) {
    showValidation(errors);
    showToast(`${errors.length} response${errors.length === 1 ? " needs" : "s need"} attention.`);
    return;
  }
  if (section.id === "screening" && screeningOutcome(state.answers) !== "eligible_or_pending") {
    showToast("This response does not meet the current eligibility criteria.");
    render();
    return;
  }
  goToSection(state.currentSection + 1);
}

function responsePayload() {
  return {
    schemaVersion: "2.0",
    answers: deepClone(state.answers),
    workflowText: workflowToText(state.answers.D0),
    status: state.status,
    version: state.version,
    currentSection: state.currentSection,
    createdAt: state.createdAt,
    submittedAt: state.submittedAt,
  };
}

async function ensureRecoveryKey() {
  if (!state.recoveryKey) {
    state.recoveryKey = await surveyStore.createKey();
    surveyStore.setActiveKey(state.recoveryKey);
  }
  return state.recoveryKey;
}

async function saveDraft({ showKey = false, quiet = false } = {}) {
  const wasNew = !state.recoveryKey;
  const key = await ensureRecoveryKey();
  try {
    const entry = await surveyStore.saveDraft(key, responsePayload());
    Object.assign(state, {
      status: entry.record.status,
      version: entry.record.version,
      createdAt: entry.record.createdAt,
      updatedAt: entry.record.updatedAt,
      lastSavedAt: entry.record.updatedAt,
    });
    renderDashboard();
    if (!quiet) showToast("Draft saved in this browser.");
    if (showKey || wasNew) showKeyDialog("draft");
  } catch (error) {
    console.error(error);
    showToast("The browser could not save this draft. Export a JSON copy before leaving.");
  }
}

function scheduleAutosave() {
  if (!state.recoveryKey) return;
  clearTimeout(autosaveTimer);
  elements.saveStatus.textContent = "Unsaved changes";
  autosaveTimer = setTimeout(() => saveDraft({ quiet: true }), 650);
}

function showKeyDialog(mode = "draft") {
  elements.keyDialogKicker.textContent = mode === "submitted" ? "SUBMISSION KEY" : "DRAFT SAVED";
  elements.keyDialogTitle.textContent = mode === "submitted" ? "Keep your edit key" : "Keep your recovery key";
  elements.keyDialogMessage.textContent =
    "This prototype stores responses only in this browser. Save the key exactly as shown to reopen the response later on this device.";
  elements.recoveryKeyDisplay.textContent = state.recoveryKey;
  elements.keyDialog.showModal();
}

async function loadRecoveryKey() {
  const key = elements.recoveryInput.value.trim().toUpperCase();
  elements.recoveryError.textContent = "";
  if (!key) {
    elements.recoveryError.textContent = "Enter a recovery key.";
    return;
  }
  const entry = await surveyStore.load(key);
  if (!entry) {
    elements.recoveryError.textContent = "No response with this key exists in this browser.";
    return;
  }
  Object.assign(state, {
    answers: entry.record.answers || {},
    status: entry.record.status || "draft",
    version: entry.record.version || 0,
    currentSection: entry.record.currentSection || 0,
    createdAt: entry.record.createdAt,
    updatedAt: entry.record.updatedAt,
    submittedAt: entry.record.submittedAt || null,
    recoveryKey: key,
    lastSavedAt: entry.record.updatedAt,
    validationErrors: new Map(),
  });
  surveyStore.setActiveKey(key);
  elements.recoveryDialog.close();
  elements.recoveryInput.value = "";
  render();
  window.scrollTo({ top: 0 });
  showToast(`Loaded ${state.status} response${state.version ? ` v${state.version}` : ""}.`);
}

async function submitSurvey() {
  const errors = validateSurvey(sections, state.answers);
  if (errors.length) {
    const firstSection = sections.findIndex((section) => section.id === errors[0].sectionId);
    state.currentSection = firstSection;
    showValidation(errors.filter((error) => error.sectionId === errors[0].sectionId));
    showToast(`${errors.length} required response${errors.length === 1 ? " is" : "s are"} incomplete.`);
    return;
  }

  const key = await ensureRecoveryKey();
  try {
    const entry = await surveyStore.submit(key, responsePayload());
    Object.assign(state, {
      status: entry.record.status,
      version: entry.record.version,
      createdAt: entry.record.createdAt,
      updatedAt: entry.record.updatedAt,
      submittedAt: entry.record.submittedAt,
      lastSavedAt: entry.record.updatedAt,
    });
    renderDashboard();
    elements.submittedVersion.textContent = String(state.version);
    elements.submittedKey.textContent = state.recoveryKey;
    elements.submitDialog.showModal();
  } catch (error) {
    console.error(error);
    showToast("Submission could not be stored. Export your response and try again.");
  }
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    showToast("Copied to clipboard.");
  } catch {
    showToast("Copy failed. Select the text and copy it manually.");
  }
}

function downloadText(filename, text, type = "text/plain") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function exportResponse() {
  const exported = {
    ...responsePayload(),
    exportedAt: new Date().toISOString(),
    storageMode: "local-prototype",
  };
  downloadText(`usw-survey-response-v${state.version || 0}.json`, JSON.stringify(exported, null, 2), "application/json");
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  elements.toastRegion.append(toast);
  setTimeout(() => toast.remove(), 3600);
}

function setFirstOption(question) {
  if (question.type === "radio" || question.type === "likert") {
    state.answers[question.id] = normalizeOption(question.options[0]).value;
  } else if (question.type === "checkboxes") {
    state.answers[question.id] = [normalizeOption(question.options[0]).value];
  } else if (["text", "textarea"].includes(question.type)) {
    state.answers[question.id] = `Fictional test response for ${question.id}. This response is used only to exercise the survey prototype.`;
  } else if (question.type === "email") {
    state.answers[question.id] = "test.scientist@university.example";
  } else if (question.type === "url") {
    state.answers[question.id] = question.id === "A4" ? "https://orcid.org/0000-0000-0000-0000" : "https://example.org/researcher";
  } else if (question.type === "fields") {
    state.answers[question.id] = Object.fromEntries(question.fields.map((field) => [field.key, `Test ${field.label}`]));
  } else if (question.type === "constantSum") {
    state.answers[question.id] = Object.fromEntries(question.items.map((item) => [item.key, 25]));
  } else if (question.type === "matrix") {
    state.answers[question.id] = Object.fromEntries(visibleMatrixRows(question, state.answers).map((row) => [row.key, question.columns[0].value]));
  } else if (question.type === "toolRepeater") {
    state.answers[question.id] = [
      {
        name: "FictionalLab Tool 1.0",
        category: TOOL_CATEGORIES[1],
        purpose: "Runs a fictional model used to test the survey interface.",
        interaction: [TOOL_INTERACTIONS[3]],
        location: [TOOL_LOCATIONS[3]],
        access: [TOOL_ACCESS[0]],
      },
    ];
  } else if (question.type === "workflow") {
    state.answers[question.id] = createExampleWorkflow();
  }
}

function fillDemoResponse() {
  state.answers = {
    CONSENT: ["consent"],
    S1: "Ph.D. student",
    S2: "Physics",
    S2a: "Computational materials physics",
    S4: "3–5",
    S5: "Led a sub-project",
    A1: "Test Scientist",
    A2: "test.scientist@university.example",
    A3: { institution: "Example University", country: "United States" },
    A4: "https://orcid.org/0000-0000-0000-0000",
    A6: "2–5",
    A7: "No",
    A8: "No",
    C1: ["physical", "simulation", "data_analysis"],
    D3: "3",
    E1: "tried",
    E6: "Yes, once or twice",
    F5d: "Full credit",
  };

  for (let pass = 0; pass < 3; pass += 1) {
    for (const section of sections) {
      for (const question of section.questions) {
        if (!question.id || !isQuestionVisible(question, state.answers) || state.answers[question.id] !== undefined) continue;
        setFirstOption(question);
      }
    }
  }
  state.answers.D0 = createExampleWorkflow();
  state.status = state.version ? "editing" : "draft";
  state.validationErrors.clear();
  render();
  showToast("Loaded fictional answers for prototype testing.");
  scheduleAutosave();
}

function bindEvents() {
  elements.form.addEventListener("input", handleFormInput);
  elements.form.addEventListener("change", handleFormChange);
  elements.form.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (button) handleActionClick(button);
  });
  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitSurvey();
  });

  elements.sectionList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-nav-section]");
    if (button) goToSection(Number(button.dataset.navSection));
  });
  elements.backButton.addEventListener("click", () => goToSection(state.currentSection - 1));
  elements.nextButton.addEventListener("click", nextSection);
  elements.saveButton.addEventListener("click", () => saveDraft({ showKey: true }));
  elements.railSaveButton.addEventListener("click", () => saveDraft({ showKey: true }));
  elements.resumeButton.addEventListener("click", () => elements.recoveryDialog.showModal());
  elements.recoveryLoadButton.addEventListener("click", loadRecoveryKey);
  elements.recoveryInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      loadRecoveryKey();
    }
  });
  elements.keyDialogClose.addEventListener("click", () => elements.keyDialog.close());
  elements.keyDialogDone.addEventListener("click", () => elements.keyDialog.close());
  elements.copyKeyButton.addEventListener("click", () => copyText(state.recoveryKey));
  elements.downloadKeyButton.addEventListener("click", () =>
    downloadText("usw-survey-recovery-key.txt", `USW survey recovery key\n\n${state.recoveryKey}\n\nKeep this key private.`),
  );
  elements.copySubmittedKey.addEventListener("click", () => copyText(state.recoveryKey));
  elements.submitDialogDone.addEventListener("click", () => elements.submitDialog.close());
  elements.exportResponseButton.addEventListener("click", exportResponse);
  elements.demoFillButton.addEventListener("click", fillDemoResponse);
  elements.mobileNavToggle.addEventListener("click", () => {
    const open = elements.sidebar.classList.toggle("is-open");
    elements.mobileNavToggle.setAttribute("aria-expanded", String(open));
  });

  elements.questionStack.addEventListener("dragstart", (event) => {
    const stage = event.target.closest("[data-stage-id]");
    if (!stage) return;
    draggedStageId = stage.dataset.stageId;
    stage.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
  });
  elements.questionStack.addEventListener("dragend", (event) => {
    event.target.closest("[data-stage-id]")?.classList.remove("is-dragging");
    draggedStageId = null;
  });
  elements.questionStack.addEventListener("dragover", (event) => {
    if (event.target.closest("[data-drop-stage]")) event.preventDefault();
  });
  elements.questionStack.addEventListener("drop", (event) => {
    const target = event.target.closest("[data-drop-stage]");
    if (!target || !draggedStageId) return;
    event.preventDefault();
    const workflow = state.answers.D0;
    const from = workflow.stages.findIndex((stage) => stage.id === draggedStageId);
    const to = workflow.stages.findIndex((stage) => stage.id === target.dataset.dropStage);
    moveArrayItem(workflow.stages, from, to);
    markChanged("D0");
    render();
  });
}

async function hydrateActiveResponse() {
  if (!state.recoveryKey) return;
  const entry = await surveyStore.load(state.recoveryKey);
  if (!entry) {
    state.recoveryKey = "";
    surveyStore.clearActiveKey();
    return;
  }
  Object.assign(state, {
    answers: entry.record.answers || {},
    status: entry.record.status || "draft",
    version: entry.record.version || 0,
    currentSection: entry.record.currentSection || 0,
    createdAt: entry.record.createdAt,
    updatedAt: entry.record.updatedAt,
    submittedAt: entry.record.submittedAt || null,
    lastSavedAt: entry.record.updatedAt,
  });
}

async function init() {
  bindEvents();
  await hydrateActiveResponse();
  render();
}

init();
