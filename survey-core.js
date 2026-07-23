const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
  "mail.com",
]);

export function normalizeOption(option) {
  if (typeof option === "string") return { value: option, label: option };
  return option;
}

export function isConditionMet(condition, answers) {
  if (!condition) return true;
  const answer = answers[condition.question];

  if (Object.prototype.hasOwnProperty.call(condition, "equals")) return answer === condition.equals;
  if (Object.prototype.hasOwnProperty.call(condition, "notEquals")) return Boolean(answer) && answer !== condition.notEquals;
  if (condition.in) return condition.in.includes(answer);
  if (condition.includes) return Array.isArray(answer) && answer.includes(condition.includes);
  if (condition.includesAny) return Array.isArray(answer) && condition.includesAny.some((value) => answer.includes(value));
  if (condition.numericAtLeast) return Number(answer) >= condition.numericAtLeast;
  if (condition.hasAnyExcept) return Array.isArray(answer) && answer.some((value) => value !== condition.hasAnyExcept);
  return true;
}

export function isQuestionVisible(question, answers) {
  return isConditionMet(question.showIf, answers);
}

export function visibleMatrixRows(question, answers) {
  return (question.rows || []).filter((row) => isConditionMet(row.showIf, answers));
}

export function isAnswerPresent(question, answers) {
  const answer = answers[question.id];
  if (answer == null) return false;

  switch (question.type) {
    case "checkboxes":
      return Array.isArray(answer) && answer.length > 0;
    case "fields":
      return question.fields.every((field) => String(answer?.[field.key] || "").trim());
    case "constantSum":
      return question.items.some((item) => answer?.[item.key] !== undefined && answer?.[item.key] !== "");
    case "matrix":
      return Object.keys(answer || {}).length > 0;
    case "toolRepeater":
      return Array.isArray(answer) && answer.some((tool) => String(tool.name || "").trim());
    case "workflow":
      return Array.isArray(answer?.stages) && answer.stages.some((stage) => String(stage.label || "").trim());
    default:
      return String(answer).trim().length > 0;
  }
}

function isValidUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function validateQuestion(question, answers) {
  if (!question.id || !isQuestionVisible(question, answers)) return "";
  const answer = answers[question.id];

  if (!question.required && !isAnswerPresent(question, answers)) return "";
  if (question.required && !isAnswerPresent(question, answers)) return "Please answer this question before continuing.";

  if (question.type === "email") {
    const value = String(answer || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Enter a valid email address.";
    if (question.institutionalEmail && PERSONAL_EMAIL_DOMAINS.has(value.split("@")[1])) {
      return "Please use an institutional email address rather than personal webmail.";
    }
  }

  if (question.type === "url" && answer && !isValidUrl(String(answer).trim())) {
    return "Enter a complete URL beginning with https:// or http://.";
  }

  if (question.type === "checkboxes") {
    const otherOption = (question.options || []).map(normalizeOption).find((option) => option.other);
    if (otherOption && answer.includes(otherOption.value) && !String(answers[`${question.id}__other`] || "").trim()) {
      return "Please describe your ‘Other’ response.";
    }
  }

  if (question.type === "radio") {
    const selected = (question.options || []).map(normalizeOption).find((option) => option.value === answer);
    if (selected?.other && !String(answers[`${question.id}__other`] || "").trim()) {
      return "Please describe your ‘Other’ response.";
    }
  }

  if (question.type === "constantSum") {
    const values = question.items.map((item) => Number(answer?.[item.key] || 0));
    if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) {
      return "Each percentage must be between 0 and 100.";
    }
    const total = values.reduce((sum, value) => sum + value, 0);
    if (total !== 100) return `The percentages currently total ${total}%. Please make them add up to 100%.`;
  }

  if (question.type === "matrix") {
    const rows = visibleMatrixRows(question, answers);
    const missing = rows.some((row) => !answer?.[row.key]);
    if (missing) return "Please select one response for each visible row.";
  }

  if (question.type === "toolRepeater") {
    if (!Array.isArray(answer) || answer.length === 0) return "Add at least one central tool.";
    const incomplete = answer.some(
      (tool) => !String(tool.name || "").trim() || !String(tool.category || "").trim() || !String(tool.purpose || "").trim(),
    );
    if (incomplete) return "For each tool, provide its name, category, and main purpose.";
  }

  if (question.type === "workflow") {
    const labeledStages = (answer?.stages || []).filter((stage) => String(stage.label || "").trim());
    if (labeledStages.length < 2) return "Add and name at least two workflow stages.";
    const stageIds = new Set(labeledStages.map((stage) => stage.id));
    const invalidConnection = (answer?.connections || []).some(
      (connection) => !stageIds.has(connection.from) || !stageIds.has(connection.to) || connection.from === connection.to,
    );
    if (invalidConnection) return "One of the branch or loop connections points to an unavailable stage.";
  }

  return "";
}

export function validateSection(section, answers) {
  return section.questions
    .filter((question) => question.id && isQuestionVisible(question, answers))
    .map((question) => ({ id: question.id, message: validateQuestion(question, answers) }))
    .filter((item) => item.message);
}

export function validateSurvey(sections, answers) {
  return sections.flatMap((section) =>
    validateSection(section, answers).map((error) => ({ ...error, sectionId: section.id })),
  );
}

export function computeCompletion(sections, answers) {
  const questions = sections.flatMap((section) =>
    section.questions.filter((question) => question.id && isQuestionVisible(question, answers)),
  );
  const answered = questions.filter((question) => isAnswerPresent(question, answers)).length;
  return {
    answered,
    total: questions.length,
    percent: questions.length ? Math.round((answered / questions.length) * 100) : 0,
  };
}

export function isSectionComplete(section, answers) {
  const required = section.questions.filter(
    (question) => question.id && question.required && isQuestionVisible(question, answers),
  );
  return required.length > 0 && required.every((question) => !validateQuestion(question, answers));
}

export function screeningOutcome(answers) {
  if (answers.S2 === "Computer science / AI" && answers.S3 === "No") return "ineligible_field";
  if (answers.S4 === "0") return "ineligible_publications";
  return "eligible_or_pending";
}

export function makeId(prefix = "item") {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

export function createInitialWorkflow() {
  return {
    stages: [
      { id: makeId("stage"), label: "", detail: "" },
      { id: makeId("stage"), label: "", detail: "" },
      { id: makeId("stage"), label: "", detail: "" },
    ],
    connections: [],
  };
}

export function workflowToText(workflow) {
  const stages = (workflow?.stages || []).filter((stage) => String(stage.label || "").trim());
  if (!stages.length) return "";
  const labels = new Map(stages.map((stage, index) => [stage.id, { label: stage.label.trim(), number: index + 1 }]));
  const main = stages.map((stage) => stage.label.trim()).join(" → ");
  const extras = (workflow?.connections || [])
    .filter((connection) => labels.has(connection.from) && labels.has(connection.to))
    .map((connection) => {
      const from = labels.get(connection.from);
      const to = labels.get(connection.to);
      const arrow = connection.type === "loop" ? "↺" : "⇢";
      const condition = String(connection.condition || "").trim();
      return `${from.label} ${arrow} ${to.label}${condition ? ` [${condition}]` : ""}`;
    });
  return [main, ...extras].join("\n");
}

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}
