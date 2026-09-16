/* =========================================================================
 * 领队英语学习台 — Service Worker
 *
 * 缓存策略（核心原则：绝不成为新的“缓存陷阱”）：
 *   1. HTML 导航请求 → network-first
 *      每次打开/刷新都优先请求网络，保证用户总能拿到最新页面；
 *      只有网络失败时才回退到缓存。
 *   2. 其他同源静态资源（图标、manifest 等）→ cache-first
 *      这类资源内容稳定，命中缓存即可，未命中再走网络并写入缓存。
 *   3. 版本号 CACHE_NAME 变更后，activate 阶段会删除所有旧版本缓存，
 *      彻底避免“新旧缓存混用”。
 *   4. install 阶段 skipWaiting + activate 阶段 clients.claim，
 *      新 SW 一就绪就立即接管所有页面，无需用户二次刷新。
 *   5. sw.js 自身永远不缓存，保证脚本本身也能及时更新。
 *
 * 发版注意：改了 HTML 或静态资源后，请把 CACHE_NAME 的版本号 +1
 *（例如 tour-leader-v1 -> tour-leader-v2），旧缓存会被自动清空。
 * ========================================================================= */

const CACHE_NAME = 'tour-leader-v3';

/* 预缓存清单：应用外壳 + 静态资源（全部为相对路径，适配 /tour-leader-english/ 子路径） */
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

/* 完全离线且无任何缓存时的兜底页面 */
const OFFLINE_HTML =
  '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1.0">' +
  '<title>离线 — 领队英语学习台</title>' +
  '<style>body{font-family:-apple-system,"Segoe UI",Roboto,sans-serif;display:flex;' +
  'align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f7fa;' +
  'color:#1a1a2e;text-align:center;padding:24px}div p{color:#8892a4;font-size:14px;margin-top:8px}</style>' +
  '</head><body><div><h2>当前处于离线状态</h2>' +
  '<p>网络恢复后刷新页面即可继续学习</p></div></body></html>';

/* ------------------------------ install ---------------------------------- */
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .catch((err) => console.warn('[SW] precache failed:', err))
  );
});

/* ------------------------------ activate --------------------------------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

/* ------------------------------- fetch ----------------------------------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 只处理同源 GET 请求；sw.js 自身永不缓存
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/sw.js')) return;

  // 页面导航 / HTML 请求 → network-first
  const acceptsHtml = (req.headers.get('accept') || '').indexOf('text/html') !== -1;
  if (req.mode === 'navigate' || acceptsHtml) {
    event.respondWith(networkFirst(req));
    return;
  }

  // 其余静态资源 → cache-first
  event.respondWith(cacheFirst(req));
});

/* ---------------------------- strategies --------------------------------- */
async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    // 必须绕过浏览器 HTTP 缓存：GitHub Pages 对 HTML 返回 Cache-Control: max-age=600，
    // 若沿用 req 默认的 cache:'default'，新鲜期内会直接复用 HTTP 缓存里的旧页面、
    // 根本不发网络请求，network-first 就形同虚设（QA 已 curl 实测确认）。
    const fresh = await fetch(new Request(req.url, { cache: 'reload', credentials: 'same-origin' }));
    if (fresh && fresh.ok) {
      // 用 URL 字符串作为缓存键，避免 navigate 模式 Request 的存储限制
      cache.put(req.url, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (err) {
    const cached =
      (await cache.match(req.url, { ignoreSearch: true })) ||
      (await cache.match('./index.html')) ||
      (await cache.match('./'));
    if (cached) return cached;
    return new Response(OFFLINE_HTML, {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok && (fresh.type === 'basic' || fresh.type === 'default')) {
      cache.put(req, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (err) {
    return Response.error();
  }
}

/* ------------------------- manual update hook ---------------------------- */
// 页面侧可 postMessage('SKIP_WAITING') 主动要求新 SW 立即接管（预留扩展）
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
