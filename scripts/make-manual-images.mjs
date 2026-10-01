import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

/* 미니 PNG 인코더 + 화면 목업 일러스트 (예시 화면, 실제 DB 없음) */
const FONT = {
  0: [0b111, 0b101, 0b101, 0b101, 0b111], 1: [0b010, 0b110, 0b010, 0b010, 0b111],
  2: [0b111, 0b001, 0b111, 0b100, 0b111], 3: [0b111, 0b001, 0b111, 0b001, 0b111],
  4: [0b101, 0b101, 0b111, 0b001, 0b001], 5: [0b111, 0b100, 0b111, 0b001, 0b111],
  6: [0b111, 0b100, 0b111, 0b101, 0b111], 7: [0b111, 0b001, 0b001, 0b010, 0b010],
  8: [0b111, 0b101, 0b111, 0b101, 0b111], 9: [0b111, 0b101, 0b111, 0b001, 0b111],
};
const C = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const BG = C('#f1f3f9'), DARK = C('#171d38'), WHITE = C('#ffffff'), BAR = C('#e2e8f0'),
  BLUE = C('#2f62f0'), GRN = C('#0f9d58'), RED = C('#e5484d'), CARD = C('#f8faff'), LINE = C('#d5dbe8');

function canvas(w, h, bg) {
  const px = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) { px[i * 3] = bg[0]; px[i * 3 + 1] = bg[1]; px[i * 3 + 2] = bg[2]; }
  return {
    w, h, px,
    rect(x, y, rw, rh, c) {
      for (let j = Math.max(0, y); j < Math.min(h, y + rh); j++)
        for (let i = Math.max(0, x); i < Math.min(w, x + rw); i++) {
          px[(j * w + i) * 3] = c[0]; px[(j * w + i) * 3 + 1] = c[1]; px[(j * w + i) * 3 + 2] = c[2];
        }
    },
    badge(cx, cy, n) {
      const r = 30;
      for (let j = cy - r; j <= cy + r; j++) for (let i = cx - r; i <= cx + r; i++) {
        if (i < 0 || j < 0 || i >= w || j >= h) continue;
        if ((i - cx) ** 2 + (j - cy) ** 2 <= r * r) { px[(j * w + i) * 3] = RED[0]; px[(j * w + i) * 3 + 1] = RED[1]; px[(j * w + i) * 3 + 2] = RED[2]; }
      }
      const g = FONT[n], s = 8, gw = 3 * s, gh = 5 * s, ox = cx - gw / 2, oy = cy - gh / 2;
      g.forEach((row, y) => { for (let x = 0; x < 3; x++) if (row & (1 << (2 - x)))
        this.rect(ox + x * s, oy + y * s, s, s, WHITE); });
    },
  };
}

const crcTable = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc(b) { let c = -1; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const cs = Buffer.alloc(4); cs.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, cs]);
}
function toPNG(cv) {
  const raw = Buffer.alloc((cv.w * 3 + 1) * cv.h);
  for (let y = 0; y < cv.h; y++) { raw[y * (cv.w * 3 + 1)] = 0; cv.px.copy(raw, y * (cv.w * 3 + 1) + 1, y * cv.w * 3, (y + 1) * cv.w * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(cv.w, 0); ihdr.writeUInt32BE(cv.h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/* 공통 앱틀: 사이드바 메뉴 + 상단바, 반환 {cv, mainX, mainY, mainW} */
function appFrame(sideItems, activeColor) {
  const W = 1200, H = 760, cv = canvas(W, H, BG);
  cv.rect(0, 0, W, 46, WHITE);
  [[24, '#ff5f57'], [48, '#febc2e'], [72, '#28c840']].forEach(([x, cc]) => {
    const c = C(cc);
    for (let j = 14; j < 34; j++) for (let i = x; i < x + 20; i++) {
      if ((i - x - 10) ** 2 + (j - 24) ** 2 <= 100) { cv.px[(j * W + i) * 3] = c[0]; cv.px[(j * W + i) * 3 + 1] = c[1]; cv.px[(j * W + i) * 3 + 2] = c[2]; }
    }
  });
  const SX = 0, SW = 300;
  cv.rect(SX, 46, SW, H - 46, DARK);
  cv.rect(24, 66, 56, 56, activeColor); // 로고 블록
  let y = 150;
  sideItems.forEach(([on]) => {
    if (on) cv.rect(14, y, SW - 28, 44, activeColor);
    else cv.rect(30, y + 12, SW - 90, 20, C('#3a4370'));
    y += 56;
  });
  const MX = SW + 24, MW = W - MX - 24;
  cv.rect(MX, 66, MW, 64, WHITE); // 상단 헤더바
  return { cv, MX, MW };
}
function table(cv, x, y, w, rows, rh = 44) {
  cv.rect(x, y, w, rh, BAR);
  for (let i = 0; i < rows; i++) {
    const ry = y + rh + i * (rh + 8);
    cv.rect(x, ry, w, rh, WHITE);
    cv.rect(x + 16, ry + 14, Math.floor(w * 0.16), 16, BAR);
    cv.rect(x + Math.floor(w * 0.24), ry + 14, Math.floor(w * 0.22), 16, BAR);
    cv.rect(x + Math.floor(w * 0.52), ry + 14, Math.floor(w * 0.18), 16, BAR);
    cv.rect(x + Math.floor(w * 0.76), ry + 14, Math.floor(w * 0.14), 16, CARD);
  }
  return y + rh + rows * (rh + 8);
}

/* 관리자-1 계정관리 */
{
  const { cv, MX, MW } = appFrame([[0], [1], [0]], BLUE);
  cv.rect(MX, 150, 190, 52, BLUE); // 계정 추가 버튼
  const ty = table(cv, MX, 220, MW, 3);
  cv.badge(MX + 190 + 40, 176, 1);
  cv.badge(MX + MW - 60, 220 + 44 + 52 + 22, 2);
  cv.badge(MX + MW - 150, ty + 60, 3);
  cv.rect(MX, ty + 36, 150, 48, C('#eef1f7')); cv.rect(MX + 165, ty + 36, 150, 48, C('#eef1f7')); cv.rect(MX + 330, ty + 36, 150, 48, RED);
  mkdirSync('이용매뉴얼/img', { recursive: true });
  writeFileSync('이용매뉴얼/img/admin-1.png', toPNG(cv));
}
/* 관리자-2 장부 */
{
  const { cv, MX, MW } = appFrame([[1], [0], [0], [0]], BLUE);
  for (let i = 0; i < 4; i++) { const cx = MX + i * Math.floor((MW + 16) / 4); cv.rect(cx, 150, Math.floor((MW - 48) / 4), 96, CARD); cv.rect(cx + 16, 170, 110, 16, BAR); cv.rect(cx + 16, 196, 150, 22, BLUE); }
  cv.rect(MX, 262, 220, 48, BLUE);
  cv.rect(MX + 236, 262, MW - 236, 48, WHITE);
  const ty = table(cv, MX, 326, MW, 3);
  cv.badge(MX + 220 + 40, 286, 1);
  cv.badge(MX + 300, 350 - 24, 2);
  cv.badge(MX + MW - 60, ty - 40, 3);
  writeFileSync('이용매뉴얼/img/admin-2.png', toPNG(cv));
}
/* 직원-1 지출결의 */
{
  const { cv, MX, MW } = appFrame([[1], [0], [0]], GRN);
  const stepsY = [150, 320, 490];
  stepsY.forEach((sy, i) => {
    cv.rect(MX + 70, sy, MW - 70, 140, WHITE);
    cv.rect(MX + 100, sy + 24, 200, 18, BAR);
    cv.rect(MX + 100, sy + 56, 320, 18, BAR);
    cv.rect(MX + 100, sy + 92, 180, 34, i === 2 ? GRN : C('#eef1f7'));
    cv.badge(MX + 35, sy + 70, i + 1);
  });
  writeFileSync('이용매뉴얼/img/staff-1.png', toPNG(cv));
}
console.log('images done');
