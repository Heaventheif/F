"use strict";
import { Innertube } from "youtubei.js";
import {
  getApiUrl,
  downloadYoutubeAudio,
} from "../utils/yyApi.js";

// تُترك قابلة للتخصيص لخدمة yy المستضافة ذاتيًا؛ القيمة الافتراضية عنوان مستودع yy المنشور.
export { getApiUrl };

/** تنزيل الصوت من YouTube أو SoundCloud عبر /api/v1/audio في yy. */
export async function downloadAudio(sourceUrl, format = "mp3") {
  const media = await downloadYoutubeAudio(sourceUrl, format);
  return media.filePath;
}

let ytPromise = null;
function getYT() {
  if (!ytPromise) {
    ytPromise = Innertube.create({ lang: "en", location: "US" }).catch((err) => {
      ytPromise = null;
      throw err;
    });
  }
  return ytPromise;
}

/** البحث في YouTube Music وإرجاع نتائج بالشكل الذي تستخدمه song.js. */
export async function search(query, limit = 1) {
  const yt = await getYT();
  const res = await yt.music.search(String(query || "").trim(), { type: "song" });
  const items = (res.songs?.contents ?? []).filter((item) => item?.id);
  if (!items.length) throw new Error("no_results");
  return items.slice(0, limit).map((item) => ({
    id: item.id,
    videoId: item.id,
    title: item.title || "",
    artists: (item.artists || []).map((artist) => artist.name).join(", "),
    duration: item.duration?.seconds ?? null,
    thumbnail: item.thumbnails?.[0]?.url ?? null,
  }));
}

/** تحميل أغنية YouTube Music (الـ API يقبل رابط YouTube القياسي). */
export async function download(videoId) {
  if (!/^[\w-]{11}$/.test(String(videoId || ""))) {
    throw new Error("معرّف فيديو غير صالح");
  }
  const media = await downloadYoutubeAudio(`https://music.youtube.com/watch?v=${videoId}`, "m4a");
  return media.filePath;
}
