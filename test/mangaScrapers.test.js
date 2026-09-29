import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMangalikOnePieceChapterUrl,
  buildStarzOnePieceChapterUrl,
  extractReaderImages,
  findMangalikChapterRedirect,
  getMangaSourceOrder,
  isOnePieceTitle,
  normalizeReaderImageUrl,
  parseMangalikSearchResults,
  pickBestMangalik,
} from "../src/utils/mangaScrapers.js";

const starzChapterHtml = `<img src="https://starz.starzmanga.com/logo.png">
  <div class="reading-content">
    <div class="page-break"><img id="image-0" src="https://smanhwa.starzmanga.com/manga2/arb4/data/chapter/01.jpg"></div>
    <div class="page-break"><img id="image-1" src="https://smanhwa.starzmanga.com/manga2/arb4/data/chapter/02.jpg"></div>
  </div>`;

const mangalikChapterHtml = `<div class="reading-content">
  <div class="page-break"><img src="https://ssolo.mangalik.net/manga2/data/01.png?sig=x"></div>
  <div class="page-break"><img data-src="https://leksolo.mangalik.net/manga2/data/02.webp"></div>
</div>`;

test("One Piece uses StarzManga first and Mangalik as the alternate", () => {
  assert.deepEqual(getMangaSourceOrder("One Piece"), ["StarzManga", "Mangalik"]);
  assert.deepEqual(getMangaSourceOrder("ون بيس"), ["StarzManga", "Mangalik"]);
  assert.deepEqual(getMangaSourceOrder("SPY×FAMILY"), ["Mangalik"]);
  assert.equal(isOnePieceTitle("ون بيس"), true);
});

test("builds the verified StarzManga and Mangalik One Piece chapter URLs", () => {
  assert.equal(buildStarzOnePieceChapterUrl("1085"), "https://starzmanga.com/manga/one-piece/1085/");
  assert.equal(buildStarzOnePieceChapterUrl("1085.5"), "https://starzmanga.com/manga/one-piece/1085-5/");
  assert.equal(buildMangalikOnePieceChapterUrl("1085"), "https://mangalik.net/manga/pieceone/1085/");
  assert.equal(buildMangalikOnePieceChapterUrl("bad"), null);
});

test("extracts only reader images from StarzManga and Mangalik and preserves query strings", () => {
  assert.deepEqual(extractReaderImages(starzChapterHtml, "https://starzmanga.com/manga/one-piece/1085/", "StarzManga"), [
    "https://smanhwa.starzmanga.com/manga2/arb4/data/chapter/01.jpg",
    "https://smanhwa.starzmanga.com/manga2/arb4/data/chapter/02.jpg",
  ]);
  assert.deepEqual(extractReaderImages(mangalikChapterHtml, "https://mangalik.net/manga/pieceone/1085/", "Mangalik"), [
    "https://ssolo.mangalik.net/manga2/data/01.png?sig=x",
    "https://leksolo.mangalik.net/manga2/data/02.webp",
  ]);
});

test("blocks image hosts outside the configured manga source", () => {
  assert.equal(normalizeReaderImageUrl("https://evil.example/image.jpg", "StarzManga"), null);
  assert.equal(normalizeReaderImageUrl("http://smanhwa.starzmanga.com/image.jpg", "StarzManga"), null);
  assert.equal(normalizeReaderImageUrl("https://ssolo.mangalik.net/image.png", "Mangalik"), "https://ssolo.mangalik.net/image.png");
});

test("parses Mangalik search results and exact fractional chapter redirects", () => {
  const search = `<div class="c-tabs-item"><div class="post-title"><a href="https://mangalik.net/manga/spyxfamily/">SPY×FAMILY</a></div></div>`;
  const results = parseMangalikSearchResults(search);
  assert.equal(pickBestMangalik("Spy x Family", results).manga.url, "https://mangalik.net/manga/spyxfamily/");
  const detail = `<select class="single-chapter-select"><option value="139-2" data-redirect="https://mangalik.net/manga/spyxfamily/139-2/">139.2</option></select>`;
  assert.equal(findMangalikChapterRedirect(detail, "https://mangalik.net/manga/spyxfamily/", "139.2"), "https://mangalik.net/manga/spyxfamily/139-2/");
});
