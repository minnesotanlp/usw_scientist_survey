import test from "node:test";
import assert from "node:assert/strict";

import { questionIndex, sections } from "../survey-schema.js";
import {
  computeCompletion,
  createInitialWorkflow,
  isQuestionVisible,
  screeningOutcome,
  validateQuestion,
  visibleMatrixRows,
  workflowToText,
} from "../survey-core.js";

test("survey v2.0 contains nine sections and unique question IDs", () => {
  const questions = sections.flatMap((section) => section.questions.filter((question) => question.id));
  const ids = questions.map((question) => question.id);

  assert.equal(sections.length, 9);
  assert.equal(ids.length, 79);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(
    sections.map((section) => section.id),
    ["welcome", "screening", "profile", "goals", "tools", "workflows", "ai", "benchmark", "background"],
  );
});

test("schema branches reference existing questions and supported controls", () => {
  const supportedTypes = new Set([
    "info",
    "text",
    "email",
    "url",
    "textarea",
    "fields",
    "radio",
    "checkboxes",
    "likert",
    "constantSum",
    "matrix",
    "toolRepeater",
    "workflow",
  ]);

  for (const section of sections) {
    for (const question of section.questions) {
      assert.ok(supportedTypes.has(question.type), `unsupported type ${question.type}`);
      if (question.showIf) assert.ok(questionIndex.has(question.showIf.question), `${question.id} has an unknown dependency`);
      for (const row of Array.isArray(question.rows) ? question.rows : []) {
        if (row.showIf) assert.ok(questionIndex.has(row.showIf.question), `${question.id}.${row.key} has an unknown dependency`);
      }
    }
  }
});

test("screening rules identify field and publication exclusions", () => {
  assert.equal(screeningOutcome({ S2: "Computer science / AI", S3: "No", S4: "6–10" }), "ineligible_field");
  assert.equal(screeningOutcome({ S2: "Physics", S4: "0" }), "ineligible_publications");
  assert.equal(screeningOutcome({ S2: "Physics", S4: "1–2" }), "eligible_or_pending");
});

test("conditional AI-agent questions appear only for users with hands-on experience", () => {
  const E3 = questionIndex.get("E3");

  assert.equal(isQuestionVisible(E3, { E1: "heard" }), false);
  assert.equal(isQuestionVisible(E3, { E1: "tried" }), true);
  assert.equal(isQuestionVisible(E3, { E1: "weekly" }), true);
});

test("computational automation matrix exposes only selected activities", () => {
  const C4a = questionIndex.get("C4a");
  const answers = { C1: ["simulation", "formal_computation"] };

  assert.deepEqual(
    visibleMatrixRows(C4a, answers).map((row) => row.key),
    ["simulation", "formal_computation"],
  );
});

test("constant-sum question accepts exactly 100 percent", () => {
  const B3 = questionIndex.get("B3");
  const valid = { B3: { experimental: 25, theoretical: 25, simulation: 25, analysis: 25 } };
  const invalid = { B3: { experimental: 25, theoretical: 25, simulation: 25, analysis: 20 } };

  assert.equal(validateQuestion(B3, valid), "");
  assert.match(validateQuestion(B3, invalid), /total 95%/);
});

test("workflow builder requires two named stages and serializes loop connections", () => {
  const D0 = questionIndex.get("D0");
  const workflow = createInitialWorkflow();
  assert.equal(workflow.connections.filter((connection) => connection.type === "flow").length, 2);
  assert.ok(workflow.stages.every((stage) => Number.isFinite(stage.x) && Number.isFinite(stage.y)));
  workflow.stages[0].label = "Question";

  assert.match(validateQuestion(D0, { D0: workflow }), /at least two/);

  workflow.stages[1].label = "Experiment";
  workflow.connections.push({
    id: "loop-1",
    type: "loop",
    from: workflow.stages[1].id,
    to: workflow.stages[0].id,
    condition: "if validation fails",
  });

  assert.equal(validateQuestion(D0, { D0: workflow }), "");
  assert.match(workflowToText(workflow), /Question → Experiment/);
  assert.match(workflowToText(workflow), /Experiment ↺ Question \[if validation fails\]/);

  workflow.connections.push({
    id: "self-loop",
    type: "loop",
    from: workflow.stages[1].id,
    to: workflow.stages[1].id,
    condition: "repeat until stable",
  });
  assert.equal(validateQuestion(D0, { D0: workflow }), "");
  assert.match(workflowToText(workflow), /Experiment ↺ Experiment \[repeat until stable\]/);
});

test("completion denominator follows visible branching", () => {
  const withoutExperience = computeCompletion(sections, { E1: "heard" });
  const withExperience = computeCompletion(sections, { E1: "tried" });

  assert.ok(withExperience.total > withoutExperience.total);
});
