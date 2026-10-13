// 公開版(GitHub Pages など)をオフラインでも開けるようにする Service Worker。
// このファイルは原本。build_site.py が下の CONFIG を埋めて site/sw.js を作る(site/sw.js は直接編集しない)。
//
// 考え方
//   ・画面(index.html・アイコンなど)は「版ごとの保存場所」に入れる。版が変わると sw.js の中身が変わり、
//     ブラウザが新しい Service Worker を取りにいく → 新しい保存場所を作る → 切り替え後に古い保存場所を消す。
//   ・音声は版とは別の保存場所に入れる。ファイル名に中身のハッシュが付いているので、
//     画面だけ直した更新では音声を取り直さずに済む(1000語で約4MB を毎回取り直さない)。
"use strict";

const CONFIG = {
  "version": "2026-10-13-d13c18cc",
  "shellPrefix": "tangocho-shell-",
  "audioCache": "tangocho-audio-v1",
  "shell": [
    "./",
    "manifest.webmanifest",
    "icons/icon-192.png",
    "icons/icon-512.png",
    "icons/icon-maskable-512.png",
    "icons/apple-touch-icon.png",
    "icons/favicon-32.png"
  ],
  "audio": [
    "audio/p0001-cbc868c7.json"
  ]
};
const SHELL_CACHE = CONFIG.shellPrefix + CONFIG.version;
// このファイルの置き場所(= 公開フォルダ)の URL。ユーザー名やリポジトリ名を書かずに済むよう、自分の場所から求める
const ROOT_URL = new URL("./", self.location).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // cache: "reload" = ブラウザの通常のキャッシュを使わずに取りにいく。
      // GitHub Pages は10分ほどのキャッシュを指示するので、これが無いと古い index.html を新しい版として保存してしまう。
      // 1つでも取れなければ install は失敗し、今の版がそのまま使われ続ける(半端な版にはならない)
      await cache.addAll(CONFIG.shell.map((u) => new Request(u, { cache: "reload" })));
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        // 同じドメインの別のページ(<ユーザー名>.github.io の下の別リポジトリ)の保存場所を消さないよう、自分の接頭辞だけを見る
        if (name.startsWith(CONFIG.shellPrefix) && name !== SHELL_CACHE) await caches.delete(name);
      }
      // 作り直して名前が変わった音声ファイルの、古いほうを消す
      const keep = new Set(CONFIG.audio.map((u) => new URL(u, self.location).href));
      const audio = await caches.open(CONFIG.audioCache);
      for (const req of await audio.keys()) {
        if (!keep.has(req.url)) await audio.delete(req);
      }
      // はじめて開いたページも、読み込み直さずにこの Service Worker の管理下に入れる
      await self.clients.claim();
    })()
  );
});

// ページ側(pwa.js)から「切り替えてよい」と言われたら、待たずに新しい版になる。
// 勝手に切り替えないのは、単語を見ている最中にページが読み込み直されるのを避けるため
self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

async function respond(req, url) {
  const shell = await caches.open(SHELL_CACHE);
  if (req.mode === "navigate") {
    const bare = url.origin + url.pathname;
    if (bare === ROOT_URL || bare === ROOT_URL + "index.html") {
      // ?以降が付いていても同じ画面を返す(共有アプリなどが目印を付けて開くことがある)
      const page = await shell.match(ROOT_URL);
      if (page) return page;
    }
    return fetch(req);
  }
  const hit = (await shell.match(req)) || (await (await caches.open(CONFIG.audioCache)).match(req));
  // 保存に無いもの(まだ保存していない音声など)は通信で取る。圏外なら失敗し、ページ側は音が出ないだけで動き続ける
  return hit || fetch(req);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(respond(req, url));
});
