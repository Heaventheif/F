import test from "node:test";
import assert from "node:assert/strict";
import {
  extractTranslation,
  parseAdviceResponse,
  parseFactResponse,
  parseJokeResponse,
  parseSurahResponse,
  parseTriviaResponse,
} from "../src/utils/fahimProviders.js";
import { hasArabicText } from "../src/utils/arabicOutput.js";

test("extracts Fahim V7 translation response", () => {
  assert.equal(extractTranslation({ success: true, result: ["صباح الخير"] }), "صباح الخير");
});

test("extracts nested translator payload", () => {
  assert.equal(extractTranslation({ raw: { data: { texts: [{ translation: "مرحبا" }] } } }), "مرحبا");
});

test("parses educational and advice responses", () => {
  assert.equal(parseFactResponse({ fact: "A fact" }), "A fact");
  assert.equal(parseAdviceResponse({ slip: { advice: "Be kind" } }), "Be kind");
});

test("parses dad jokes as a sentence or setup and punchline", () => {
  assert.equal(parseJokeResponse({ joke: "A short joke" }), "A short joke");
  assert.equal(parseJokeResponse({ setup: "Why?", punchline: "Because." }), "Why?\nBecause.");
});

test("parses trivia fields and decodes HTML entities", () => {
  const result = parseTriviaResponse({ results: [{
    question: "Which is &quot;red&quot;?",
    correct_answer: "Ruby",
    incorrect_answers: ["Sapphire", "Emerald"],
  }] });
  assert.equal(result.question, 'Which is "red"?');
  assert.deepEqual(result.options, ["Sapphire", "Emerald", "Ruby"]);
});

test("parses a surah response without changing the verse text", () => {
  const result = parseSurahResponse({ data: { number: 1, name: "الفاتحة", ayahs: [{ numberInSurah: 1, text: "بسم الله" }] } });
  assert.deepEqual(result, { number: 1, name: "الفاتحة", ayahs: [{ number: 1, text: "بسم الله" }] });
});

test("detects Arabic output and rejects English-only output", () => {
  assert.equal(hasArabicText("هذه رسالة عربية"), true);
  assert.equal(hasArabicText("English only"), false);
});
