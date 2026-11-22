import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { APP_NAV_SECTIONS, COMMAND_MENU_SECONDARY_GROUPS } from "../client/src/lib/routes/section-metadata";
import {
  buildGuidedLearningTour,
  GUIDED_LEARNING_TOPICS,
} from "../client/src/lib/training/guided-learning";
import { getSpotlightTooltipPosition } from "../client/src/components/tutorial/spotlight-tour-layer";

const expectedRoutes = new Set([
  ...APP_NAV_SECTIONS.filter((section) => section.key !== "learning").flatMap((section) => section.items.map((item) => item.path)),
  ...COMMAND_MENU_SECONDARY_GROUPS.flatMap((group) => group.items.map((item) => item.path)),
]);

assert.equal(GUIDED_LEARNING_TOPICS.length, expectedRoutes.size, "every unique product tab must have one guide");
assert.equal(new Set(GUIDED_LEARNING_TOPICS.map((topic) => topic.id)).size, GUIDED_LEARNING_TOPICS.length, "topic ids must be unique");
assert.equal(new Set(GUIDED_LEARNING_TOPICS.map((topic) => topic.tourId)).size, GUIDED_LEARNING_TOPICS.length, "tour ids must be unique");

for (const route of expectedRoutes) {
  assert.ok(GUIDED_LEARNING_TOPICS.some((topic) => topic.route === route), `missing guide for ${route}`);
}

for (const topic of GUIDED_LEARNING_TOPICS) {
  assert.ok(topic.summary.length >= 20, `${topic.id} needs a useful summary`);
  assert.ok(topic.whyItMatters.length >= 30, `${topic.id} needs business context`);
  assert.ok(topic.instructions.length >= 2, `${topic.id} needs working instructions`);
  assert.ok(topic.watchFor.length >= 20, `${topic.id} needs a control warning`);
  const tour = buildGuidedLearningTour(topic);
  assert.equal(tour.length, 3, `${topic.id} needs purpose, workflow, and control steps`);
  assert.ok(tour.every((step) => step.route === topic.route), `${topic.id} must use its canonical route`);
}

const overviewPage = await readFile(new URL("../client/src/pages/get-educated.tsx", import.meta.url), "utf8");
const lessonPage = await readFile(new URL("../client/src/pages/get-educated-module.tsx", import.meta.url), "utf8");
const registration = await readFile(new URL("../client/src/components/tutorial/tutorial-steps.tsx", import.meta.url), "utf8");
assert.match(overviewPage, /guided-topic-select/);
assert.match(overviewPage, /guided-tour-start-button/);
assert.match(lessonPage, /training-tab-instructions/);
assert.match(lessonPage, /Show me on the live tab/);
assert.match(registration, /buildGuidedLearningTour/);

const viewport = { width: 1280, height: 720 };
const tooltip = { width: 340, height: 240 };
const nearBottom = getSpotlightTooltipPosition(
  { top: 600, right: 1000, bottom: 680, left: 300, width: 700, height: 80 },
  "bottom",
  viewport,
  tooltip,
);
assert.ok(nearBottom && nearBottom.top < 600, "bottom placement must flip above when the footer would leave the viewport");

const nearTop = getSpotlightTooltipPosition(
  { top: 20, right: 1000, bottom: 70, left: 300, width: 700, height: 50 },
  "top",
  viewport,
  tooltip,
);
assert.ok(nearTop && nearTop.top >= 82, "top placement must flip below when there is no room above");

const oversized = getSpotlightTooltipPosition(
  { top: 100, right: 1180, bottom: 700, left: 260, width: 920, height: 600 },
  "bottom",
  viewport,
  { width: 340, height: 1000 },
);
assert.ok(oversized && oversized.top >= 12 && oversized.top <= 12, "oversized tooltips must remain pinned inside the viewport");

console.log(`Guided learning contracts passed for ${GUIDED_LEARNING_TOPICS.length} product tabs.`);
