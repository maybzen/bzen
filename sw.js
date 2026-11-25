/* BZen 회계관리 PWA 서비스워커 — 정적 에셋만 캐시, API(Supabase)는 항상 네트워크 */
const CACHE = 'bzen-shell-v2'
const SHELL = ['index.html', 'manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  // 같은 오리진 정적 파일만 처리 — Supabase 등 외부 API는 건드리지 않음
  if (url.origin !== self.location.origin) return

  // 화면 이동(네비게이션): 네트워크 우선, 실패하면 캐시된 index.html
  // (배포 직후 신·구버전 파일이 섞이지 않도록 index.html은 캐시에 오래 두지 않음)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((cache) => cache.put('index.html', copy).catch(() => {}))
          }
          return res
        })
        .catch(() => caches.match('index.html')),
    )
    return
  }

  // JS/CSS/폰트/이미지: 캐시 우선, 없으면 네트워크 후 캐시 저장 (정상 응답만)
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          if (res && res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy).catch(() => {}))
          }
          return res
        }),
    ),
  )
})
