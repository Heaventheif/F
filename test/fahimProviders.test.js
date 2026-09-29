import test from "node:test";
import assert from "node:assert/strict";
import {
  extractTranslation,
  parseFactResponse,
  parseSurahResponse,
} from "../src/utils/fahimProviders.js";
import { hasArabicText } from "../src/utils/arabicOutput.js";

test("extracts Fahim V7 translation response", () => {
  assert.equal(extractTranslation({ success: true, result: ["صباح الخير"] }), "صباح الخير");
});

test("extracts nested translator payload", () => {
  assert.equal(extractTranslation({ raw: { data: { texts: [{ translation: "مرحبا" }] } } }), "مرحبا");
});

test("parses educational responses", () => {
  assert.equal(parseFactResponse({ fact: "A fact" }), "A fact");
});

test("parses a surah response without changing the verse text", () => {
  const result = parseSurahResponse({ data: { number: 1, name: "الفاتحة", ayahs: [{ numberInSurah: 1, text: "بسم الله" }] } });
  assert.deepEqual(result, { number: 1, name: "الفاتحة", ayahs: [{ number: 1, text: "بسم الله" }] });
});

test("detects Arabic output and rejects English-only output", () => {
  assert.equal(hasArabicText("هذه رسالة عربية"), true);
  assert.equal(hasArabicText("English only"), false);
});
