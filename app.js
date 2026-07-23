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
let workflowTool = "select";
let workflowConnectionSourceId = null;
let workflowSelectedStageId = null;
let workflowDrag = null;

const WORKFLOW_CANVAS_WIDTH = 720;
const WORKFLOW_CANVAS_HEIGHT = 520;

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

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function automaticWorkflowLayout(count) {
  if (count <= 4) {
    return Array.from({ length: count }, (_, index) => ({
      x: count === 1 ? 0.5 : 0.14 + (index * 0.72) / (count - 1),
      y: 0.5,
    }));
  }

  const columns = 3;
  const rows = Math.ceil(count / columns);
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns);
    const indexInRow = index % columns;
    const itemsInRow = Math.min(columns, count - row * columns);
    const orderedIndex = row % 2 === 0 ? indexInRow : itemsInRow - 1 - indexInRow;
    return {
      x: itemsInRow === 1 ? 0.5 : 0.16 + (orderedIndex * 0.68) / (itemsInRow - 1),
      y: rows === 1 ? 0.5 : 0.22 + (row * 0.56) / (rows - 1),
    };
  });
}

function ensureWorkflowLayout(workflow) {
  workflow.stages ||= [];
  workflow.connections ||= [];
  const fallback = automaticWorkflowLayout(workflow.stages.length);
  workflow.stages.forEach((stage, index) => {
    stage.x = clamp(Number.isFinite(Number(stage.x)) ? Number(stage.x) : fallback[index].x, 0.12, 0.88);
    stage.y = clamp(Number.isFinite(Number(stage.y)) ? Number(stage.y) : fallback[index].y, 0.12, 0.88);
  });
}

function workflowPoint(stage) {
  return {
    x: Number(stage.x) * WORKFLOW_CANVAS_WIDTH,
    y: Number(stage.y) * WORKFLOW_CANVAS_HEIGHT,
  };
}

function straightConnectionPath(from, to, curved = false) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.max(Math.hypot(dx, dy), 1);
  const ux = dx / distance;
  const uy = dy / distance;
  const horizontalBoundary = Math.abs(ux) > 0.001 ? 88 / Math.abs(ux) : Number.POSITIVE_INFINITY;
  const verticalBoundary = Math.abs(uy) > 0.001 ? 57 / Math.abs(uy) : Number.POSITIVE_INFINITY;
  const boundary = Math.min(horizontalBoundary, verticalBoundary);
  const startPadding = boundary + 5;
  const endPadding = boundary + 15;
  const start = { x: from.x + ux * startPadding, y: from.y + uy * startPadding };
  const end = { x: to.x - ux * endPadding, y: to.y - uy * endPadding };
  if (!curved) return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} L ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const control = { x: midpoint.x - uy * 58, y: midpoint.y + ux * 58 };
  return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${control.x.toFixed(1)} ${control.y.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
}

function loopConnectionPath(from, to, sameStage) {
  if (sameStage) {
    const direction = from.x < WORKFLOW_CANVAS_WIDTH / 2 ? 1 : -1;
    const edgeX = from.x + direction * 78;
    const arcX = from.x + direction * 148;
    return `M ${edgeX.toFixed(1)} ${(from.y - 28).toFixed(1)} C ${arcX.toFixed(1)} ${(from.y - 88).toFixed(1)}, ${arcX.toFixed(1)} ${(from.y + 88).toFixed(1)}, ${edgeX.toFixed(1)} ${(from.y + 28).toFixed(1)}`;
  }
  const useTop = Math.min(from.y, to.y) > 145;
  const arcY = useTop ? Math.max(22, Math.min(from.y, to.y) - 112) : Math.min(WORKFLOW_CANVAS_HEIGHT - 22, Math.max(from.y, to.y) + 112);
  const fromY = from.y + (useTop ? -48 : 48);
  const toY = to.y + (useTop ? -54 : 54);
  return `M ${from.x.toFixed(1)} ${fromY.toFixed(1)} C ${from.x.toFixed(1)} ${arcY.toFixed(1)}, ${to.x.toFixed(1)} ${arcY.toFixed(1)}, ${to.x.toFixed(1)} ${toY.toFixed(1)}`;
}

function workflowEdgesInner(questionId, workflow) {
  const stageMap = new Map(workflow.stages.map((stage) => [stage.id, stage]));
  const markerPrefix = `workflow-${questionId}`;
  const paths = workflow.connections
    .map((connection) => {
      const fromStage = stageMap.get(connection.from);
      const toStage = stageMap.get(connection.to);
      if (!fromStage || !toStage) return "";
      const from = workflowPoint(fromStage);
      const to = workflowPoint(toStage);
      const path =
        connection.type === "loop"
          ? loopConnectionPath(from, to, connection.from === connection.to)
          : straightConnectionPath(from, to, connection.type === "branch");
      const type = ["flow", "branch", "loop"].includes(connection.type) ? connection.type : "branch";
      return `<path class="workflow-edge ${type}" d="${path}" marker-end="url(#${markerPrefix}-${type})"></path>`;
    })
    .join("");

  return `
    <defs>
      <marker id="${markerPrefix}-flow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker>
      <marker id="${markerPrefix}-branch" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker>
      <marker id="${markerPrefix}-loop" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker>
    </defs>
    ${paths}`;
}

function connectionTypeLabel(type) {
  if (type === "loop") return "↺ Loop";
  if (type === "branch") return "⇢ Branch";
  return "→ Flow";
}

function workflowPreviewInner(workflow) {
  const lines = workflowToText(workflow)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return `
    <h4>Text outline generated from the canvas</h4>
    <div class="workflow-preview-connections">
      ${lines.length ? lines.map((line) => `<span>${escapeHtml(line)}</span>`).join("") : '<span class="muted">Name and connect blocks to build the outline.</span>'}
    </div>`;
}

function workflowModeHint() {
  if (workflowConnectionSourceId) return "Source selected. Now click the destination block.";
  if (workflowTool === "flow") return "Click a source block, then a destination block to draw a solid arrow.";
  if (workflowTool === "branch") return "Click a source block, then a destination block to draw a decision branch.";
  if (workflowTool === "loop") return "Click a later block, then the block to repeat. A block may also loop to itself.";
  return "Drag blocks by their grip. Click a block name to type directly into it.";
}

function renderWorkflow(question) {
  const workflow = answerValue(question.id, createInitialWorkflow());
  ensureWorkflowLayout(workflow);
  if (workflowConnectionSourceId && !workflow.stages.some((stage) => stage.id === workflowConnectionSourceId)) {
    workflowConnectionSourceId = null;
  }

  const stageMap = new Map(workflow.stages.map((stage) => [stage.id, stage]));
  const nodes = workflow.stages
    .map(
      (stage, index) => `
        <div
          class="workflow-node ${workflowConnectionSourceId === stage.id ? "is-connection-source" : ""} ${workflowSelectedStageId === stage.id ? "is-selected" : ""}"
          data-workflow-node="${stage.id}"
          data-question="${question.id}"
          style="left: ${(stage.x * 100).toFixed(2)}%; top: ${(stage.y * 100).toFixed(2)}%;"
        >
          <button class="workflow-port workflow-port-in" type="button" data-action="choose-workflow-node" data-question="${question.id}" data-stage-id="${stage.id}" aria-label="Use block ${index + 1} as a connection endpoint"></button>
          <button class="workflow-port workflow-port-out" type="button" data-action="choose-workflow-node" data-question="${question.id}" data-stage-id="${stage.id}" aria-label="Use block ${index + 1} as a connection endpoint"></button>
          <div class="workflow-studs" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
          <div class="workflow-node-header">
            <button class="workflow-drag-handle" type="button" data-workflow-drag-handle data-question="${question.id}" data-stage-id="${stage.id}" aria-label="Drag block ${index + 1}; use arrow keys for precise movement">
              <span aria-hidden="true">⠿</span> BLOCK ${String(index + 1).padStart(2, "0")}
            </button>
            <button class="workflow-node-remove" type="button" data-action="remove-stage" data-question="${question.id}" data-stage-id="${stage.id}" ${workflow.stages.length <= 2 ? "disabled" : ""} aria-label="Remove block ${index + 1}">×</button>
          </div>
          <label class="sr-only" for="${question.id}-stage-${stage.id}-label">Block ${index + 1} name</label>
          <input class="workflow-node-name" id="${question.id}-stage-${stage.id}-label" data-kind="workflow-stage" data-question="${question.id}" data-stage-id="${stage.id}" data-stage-key="label" value="${escapeHtml(stage.label)}" placeholder="Click to name this step" />
          <label class="sr-only" for="${question.id}-stage-${stage.id}-detail">Block ${index + 1} optional detail</label>
          <input class="workflow-node-detail" id="${question.id}-stage-${stage.id}-detail" data-kind="workflow-stage" data-question="${question.id}" data-stage-id="${stage.id}" data-stage-key="detail" value="${escapeHtml(stage.detail || "")}" placeholder="Optional method or output" />
        </div>`,
    )
    .join("");

  const connections = workflow.connections
    .map((connection, index) => {
      const from = stageMap.get(connection.from);
      const to = stageMap.get(connection.to);
      if (!from || !to) return "";
      const fromLabel = from.label.trim() || `Block ${workflow.stages.indexOf(from) + 1}`;
      const toLabel = to.label.trim() || `Block ${workflow.stages.indexOf(to) + 1}`;
      return `
        <div class="workflow-connection-row ${connection.type}">
          <span class="workflow-connection-type">${connectionTypeLabel(connection.type)}</span>
          <span class="workflow-connection-route">
            <strong data-workflow-label-stage="${from.id}">${escapeHtml(fromLabel)}</strong>
            <span aria-hidden="true">${connection.type === "loop" ? "↺" : connection.type === "branch" ? "⇢" : "→"}</span>
            <strong data-workflow-label-stage="${to.id}">${escapeHtml(toLabel)}</strong>
          </span>
          ${
            connection.type === "flow"
              ? '<span class="workflow-connection-note">Direct step</span>'
              : `<input class="workflow-connection-condition" data-kind="workflow-connection" data-question="${question.id}" data-connection-id="${connection.id}" value="${escapeHtml(connection.condition || "")}" placeholder="Optional condition, e.g. if validation fails" aria-label="Condition for ${escapeHtml(fromLabel)} to ${escapeHtml(toLabel)}" />`
          }
          <button class="workflow-connection-remove" type="button" data-action="remove-connection" data-question="${question.id}" data-connection-index="${index}" aria-label="Remove ${connectionTypeLabel(connection.type)} connection">×</button>
        </div>`;
    })
    .join("");

  const body = `
    <div class="workflow-builder">
      <div class="workflow-toolbar">
        <div class="workflow-toolbar-copy">
          <strong>WORKFLOW SCRATCHPAD</strong>
          <span>Build it like Lego: add, name, drag, then connect blocks.</span>
        </div>
        <div class="workflow-toolbar-actions">
          <button class="button button-small" type="button" data-action="load-workflow-example" data-question="${question.id}">Load example</button>
          <button class="button button-small" type="button" data-action="auto-layout-workflow" data-question="${question.id}">Auto-layout</button>
          <button class="button button-small workflow-add-block" type="button" data-action="add-stage" data-question="${question.id}">+ Add block</button>
        </div>
      </div>
      <div class="workflow-modebar" role="toolbar" aria-label="Workflow canvas tools">
        <button type="button" data-action="set-workflow-tool" data-question="${question.id}" data-workflow-tool="select" aria-pressed="${workflowTool === "select"}">↖ Move / edit</button>
        <button type="button" data-action="set-workflow-tool" data-question="${question.id}" data-workflow-tool="flow" aria-pressed="${workflowTool === "flow"}">→ Connect</button>
        <button type="button" data-action="set-workflow-tool" data-question="${question.id}" data-workflow-tool="branch" aria-pressed="${workflowTool === "branch"}">⇢ Branch</button>
        <button type="button" data-action="set-workflow-tool" data-question="${question.id}" data-workflow-tool="loop" aria-pressed="${workflowTool === "loop"}">↺ Loop</button>
        <span class="workflow-mode-hint" aria-live="polite">${escapeHtml(workflowModeHint())}</span>
      </div>
      <div class="workflow-canvas-scroll" tabindex="0" aria-label="Scrollable workflow scratchpad">
        <div class="workflow-canvas" id="workflow-canvas-${question.id}" data-workflow-canvas="${question.id}">
          <svg class="workflow-edge-layer" id="workflow-edges-${question.id}" viewBox="0 0 ${WORKFLOW_CANVAS_WIDTH} ${WORKFLOW_CANVAS_HEIGHT}" preserveAspectRatio="none" aria-hidden="true">${workflowEdgesInner(question.id, workflow)}</svg>
          <div class="workflow-canvas-label" aria-hidden="true">DRAG BLOCKS · CLICK TO CONNECT</div>
          ${nodes}
        </div>
      </div>
      <div class="workflow-connections-panel">
        <div class="workflow-connections-header">
          <div><span class="eyebrow">CONNECTIONS</span><strong>${workflow.connections.length} drawn</strong></div>
          <button class="text-button" type="button" data-action="clear-workflow-connections" data-question="${question.id}" ${workflow.connections.length ? "" : "disabled"}>Clear all arrows</button>
        </div>
        <div class="workflow-connection-list">${connections || '<p class="workflow-empty-connections">No arrows yet. Choose Connect, Branch, or Loop above.</p>'}</div>
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
    if (target.dataset.stageKey === "label") {
      const stageIndex = state.answers[questionId].stages.findIndex((item) => item.id === target.dataset.stageId);
      const label = target.value.trim() || `Block ${stageIndex + 1}`;
      document
        .querySelectorAll(`[data-workflow-label-stage="${CSS.escape(target.dataset.stageId)}"]`)
        .forEach((element) => (element.textContent = label));
    }
    const preview = document.querySelector(`#workflow-preview-${CSS.escape(questionId)}`);
    if (preview) preview.innerHTML = workflowPreviewInner(state.answers[questionId]);
  } else if (kind === "workflow-connection") {
    const connection = state.answers[questionId].connections.find((item) => item.id === target.dataset.connectionId);
    if (connection) connection.condition = target.value;
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

function nextWorkflowPosition(workflow) {
  const candidates = [
    { x: 0.5, y: 0.2 },
    { x: 0.5, y: 0.8 },
    { x: 0.2, y: 0.2 },
    { x: 0.8, y: 0.2 },
    { x: 0.2, y: 0.8 },
    { x: 0.8, y: 0.8 },
    { x: 0.35, y: 0.5 },
    { x: 0.65, y: 0.5 },
  ];
  return candidates.reduce(
    (best, candidate) => {
      const nearest = workflow.stages.reduce(
        (distance, stage) => Math.min(distance, Math.hypot(candidate.x - stage.x, candidate.y - stage.y)),
        Number.POSITIVE_INFINITY,
      );
      return nearest > best.distance ? { ...candidate, distance: nearest } : best;
    },
    { ...candidates[0], distance: -1 },
  );
}

function addStage(questionId) {
  const workflow = state.answers[questionId];
  ensureWorkflowLayout(workflow);
  const position = nextWorkflowPosition(workflow);
  const stage = { id: makeId("stage"), label: "", detail: "", x: position.x, y: position.y };
  workflow.stages.push(stage);
  workflowSelectedStageId = stage.id;
  workflowTool = "select";
  workflowConnectionSourceId = null;
  markChanged(questionId);
  render();
  requestAnimationFrame(() => {
    document.querySelector(`[data-workflow-node="${CSS.escape(stage.id)}"] .workflow-node-name`)?.focus();
  });
}

function createExampleWorkflow() {
  const labels = ["Research question", "Material synthesis", "Spectroscopy measurement", "Data processing", "Structure analysis", "Validation", "Interpretation"];
  const positions = [
    { x: 0.16, y: 0.2 },
    { x: 0.5, y: 0.2 },
    { x: 0.84, y: 0.2 },
    { x: 0.84, y: 0.5 },
    { x: 0.84, y: 0.8 },
    { x: 0.5, y: 0.8 },
    { x: 0.16, y: 0.8 },
  ];
  const stages = labels.map((label, index) => ({ id: makeId("stage"), label, detail: "", ...positions[index] }));
  const flows = stages.slice(0, -1).map((stage, index) => ({
    id: makeId("connection"),
    type: "flow",
    from: stage.id,
    to: stages[index + 1].id,
    condition: "",
  }));
  return {
    stages,
    connections: [
      ...flows,
      { id: makeId("connection"), type: "loop", from: stages[4].id, to: stages[1].id, condition: "if validation indicates a problem" },
    ],
  };
}

function loadWorkflowExample(questionId) {
  state.answers[questionId] = createExampleWorkflow();
  workflowTool = "select";
  workflowConnectionSourceId = null;
  workflowSelectedStageId = null;
  markChanged(questionId);
  render();
}

function setWorkflowTool(tool) {
  workflowTool = ["select", "flow", "branch", "loop"].includes(tool) ? tool : "select";
  workflowConnectionSourceId = null;
  render();
}

function autoLayoutWorkflow(questionId) {
  const workflow = state.answers[questionId];
  const positions = automaticWorkflowLayout(workflow.stages.length);
  workflow.stages.forEach((stage, index) => Object.assign(stage, positions[index]));
  workflowConnectionSourceId = null;
  markChanged(questionId);
  render();
  showToast("Blocks arranged automatically.");
}

function clearWorkflowConnections(questionId) {
  state.answers[questionId].connections = [];
  workflowConnectionSourceId = null;
  markChanged(questionId);
  render();
  showToast("All workflow arrows removed.");
}

function connectWorkflowStages(questionId, stageId) {
  if (!workflowConnectionSourceId) {
    workflowConnectionSourceId = stageId;
    workflowSelectedStageId = stageId;
    render();
    return;
  }

  const from = workflowConnectionSourceId;
  const to = stageId;
  if (from === to && workflowTool !== "loop") {
    showToast("Choose a different destination block, or use Loop for a self-loop.");
    return;
  }

  const workflow = state.answers[questionId];
  const duplicate = workflow.connections.some(
    (connection) => connection.type === workflowTool && connection.from === from && connection.to === to,
  );
  if (duplicate) {
    showToast("That arrow already exists.");
    workflowConnectionSourceId = null;
    render();
    return;
  }

  workflow.connections.push({ id: makeId("connection"), type: workflowTool, from, to, condition: "" });
  workflowConnectionSourceId = null;
  workflowSelectedStageId = to;
  markChanged(questionId);
  render();
  showToast(`${connectionTypeLabel(workflowTool)} arrow added.`);
}

function handleWorkflowNodeClick(node) {
  const questionId = node.dataset.question;
  const stageId = node.dataset.workflowNode;
  if (workflowTool !== "select") {
    connectWorkflowStages(questionId, stageId);
    return;
  }

  workflowSelectedStageId = stageId;
  document.querySelectorAll("[data-workflow-node]").forEach((item) => item.classList.toggle("is-selected", item === node));
  node.querySelector(".workflow-node-name")?.focus();
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
  if (action === "choose-workflow-node") handleWorkflowNodeClick(button.closest("[data-workflow-node]"));
  if (action === "set-workflow-tool") setWorkflowTool(button.dataset.workflowTool);
  if (action === "auto-layout-workflow") autoLayoutWorkflow(questionId);
  if (action === "clear-workflow-connections") clearWorkflowConnections(questionId);
  if (action === "remove-stage") {
    const workflow = state.answers[questionId];
    workflow.stages = workflow.stages.filter((stage) => stage.id !== button.dataset.stageId);
    workflow.connections = workflow.connections.filter(
      (connection) => connection.from !== button.dataset.stageId && connection.to !== button.dataset.stageId,
    );
    if (workflowConnectionSourceId === button.dataset.stageId) workflowConnectionSourceId = null;
    if (workflowSelectedStageId === button.dataset.stageId) workflowSelectedStageId = null;
    markChanged(questionId);
    render();
  }
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

function renderWorkflowEdges(questionId) {
  const workflow = state.answers[questionId];
  const edgeLayer = document.querySelector(`#workflow-edges-${CSS.escape(questionId)}`);
  if (workflow && edgeLayer) edgeLayer.innerHTML = workflowEdgesInner(questionId, workflow);
}

function beginWorkflowDrag(event, handle) {
  if (event.button !== undefined && event.button !== 0) return;
  const questionId = handle.dataset.question;
  const stageId = handle.dataset.stageId;
  const node = handle.closest("[data-workflow-node]");
  const canvas = handle.closest("[data-workflow-canvas]");
  if (!node || !canvas) return;

  event.preventDefault();
  workflowTool = "select";
  workflowConnectionSourceId = null;
  workflowSelectedStageId = stageId;
  workflowDrag = { questionId, stageId, node, canvas, handle, pointerId: event.pointerId };
  node.classList.add("is-dragging", "is-selected");
  handle.setPointerCapture?.(event.pointerId);
}

function moveWorkflowDrag(event) {
  if (!workflowDrag || event.pointerId !== workflowDrag.pointerId) return;
  const rect = workflowDrag.canvas.getBoundingClientRect();
  const stage = state.answers[workflowDrag.questionId].stages.find((item) => item.id === workflowDrag.stageId);
  if (!stage || !rect.width || !rect.height) return;

  stage.x = clamp((event.clientX - rect.left) / rect.width, 0.12, 0.88);
  stage.y = clamp((event.clientY - rect.top) / rect.height, 0.12, 0.88);
  workflowDrag.node.style.left = `${(stage.x * 100).toFixed(2)}%`;
  workflowDrag.node.style.top = `${(stage.y * 100).toFixed(2)}%`;
  renderWorkflowEdges(workflowDrag.questionId);
}

function endWorkflowDrag(event) {
  if (!workflowDrag || event.pointerId !== workflowDrag.pointerId) return;
  workflowDrag.handle.releasePointerCapture?.(event.pointerId);
  workflowDrag.node.classList.remove("is-dragging");
  const questionId = workflowDrag.questionId;
  workflowDrag = null;
  markChanged(questionId);
}

function nudgeWorkflowStage(event, handle) {
  const deltas = {
    ArrowLeft: [-0.015, 0],
    ArrowRight: [0.015, 0],
    ArrowUp: [0, -0.02],
    ArrowDown: [0, 0.02],
  };
  const delta = deltas[event.key];
  if (!delta) return;
  event.preventDefault();
  const questionId = handle.dataset.question;
  const stage = state.answers[questionId].stages.find((item) => item.id === handle.dataset.stageId);
  if (!stage) return;
  stage.x = clamp(stage.x + delta[0], 0.12, 0.88);
  stage.y = clamp(stage.y + delta[1], 0.12, 0.88);
  const node = handle.closest("[data-workflow-node]");
  node.style.left = `${(stage.x * 100).toFixed(2)}%`;
  node.style.top = `${(stage.y * 100).toFixed(2)}%`;
  renderWorkflowEdges(questionId);
  markChanged(questionId);
}

function bindEvents() {
  elements.form.addEventListener("input", handleFormInput);
  elements.form.addEventListener("change", handleFormChange);
  elements.form.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (button) {
      handleActionClick(button);
      return;
    }
    const workflowNode = event.target.closest("[data-workflow-node]");
    if (workflowNode && workflowTool !== "select" && !event.target.closest("button")) {
      event.preventDefault();
      handleWorkflowNodeClick(workflowNode);
    } else if (workflowNode && !event.target.closest("input, button")) {
      handleWorkflowNodeClick(workflowNode);
    }
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

  elements.questionStack.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest("[data-workflow-drag-handle]");
    if (handle) beginWorkflowDrag(event, handle);
  });
  elements.questionStack.addEventListener("pointermove", moveWorkflowDrag);
  elements.questionStack.addEventListener("pointerup", endWorkflowDrag);
  elements.questionStack.addEventListener("pointercancel", endWorkflowDrag);
  elements.questionStack.addEventListener("keydown", (event) => {
    const handle = event.target.closest("[data-workflow-drag-handle]");
    if (handle) nudgeWorkflowStage(event, handle);
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
