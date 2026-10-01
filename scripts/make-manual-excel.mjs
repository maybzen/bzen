import ExcelJS from 'exceljs';

/* 비젠 회계관리 — 관리자용 / 직원용 엑셀 매뉴얼 2종 (예시 데이터만, 실제 DB 없음) */
const BLUE = 'FF1D3FAA', GREEN = 'FF0F9D58', SLATE = 'FF334155';
const DARK = 'FF171D38', HEAD = 'FFF1F5F9', RED = 'FFE5484D';
const THIN = { style: 'thin', color: { argb: 'FFCBD5E1' } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };

function base(name, color) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BZen Communication';
  wb.created = new Date('2026-10-01T00:00:00+09:00');
  wb.color = color;
  return wb;
}

/* 제목 바 */
function titleBar(ws, ncols, text, color) {
  ws.mergeCells(1, 1, 1, ncols);
  const c = ws.getCell(1, 1);
  c.value = text;
  c.font = { size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
  c.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 30;
}

/* 소제목 행 */
function section(ws, row, ncols, text, color) {
  ws.mergeCells(row, 1, row, ncols);
  const c = ws.getCell(row, 1);
  c.value = text;
  c.font = { size: 12, bold: true, color: { argb: color } };
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
  c.alignment = { vertical: 'center' };
  ws.getRow(row).height = 24;
  return row + 1;
}

/* 단계 표: rows = [순서, 화면, 따라하기, 확인] */
function steps(ws, r0, rows) {
  const heads = ['순서', '화면', '따라하기 (위에서 아래로)', '확인'];
  const hr = ws.getRow(r0);
  heads.forEach((h, i) => {
    const c = hr.getCell(i + 1);
    c.value = h; c.font = { bold: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD } };
    c.border = BORDER; c.alignment = { vertical: 'center', wrapText: true };
  });
  hr.height = 22;
  let r = r0 + 1;
  rows.forEach(([a, b, doIt, check]) => {
    const row = ws.getRow(r);
    row.getCell(1).value = a;
    row.getCell(2).value = b;
    row.getCell(3).value = { richText: [{ text: doIt }] };
    row.getCell(4).value = check || '';
    row.height = 34;
    for (let i = 1; i <= 4; i++) {
      const c = row.getCell(i);
      c.border = BORDER; c.alignment = { vertical: 'center', wrapText: true };
    }
    row.getCell(1).font = { bold: true };
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'center' };
    r++;
  });
  return r + 1;
}

/* 화면 그림: 사이드바 + 본문 (셀 디자인 목업) */
function mock(ws, r0, ncols, title, side, mains) {
  ws.mergeCells(r0, 1, r0, ncols);
  const bar = ws.getCell(r0, 1);
  bar.value = `● ● ●  ${title}`;
  bar.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
  bar.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
  let r = r0 + 1;
  const n = Math.max(side.length, mains.length);
  for (let i = 0; i < n; i++) {
    const row = ws.getRow(r);
    row.height = 26;
    const s = ws.getCell(r, 1);
    if (side[i]) {
      const [label, on] = side[i];
      s.value = label;
      s.font = { size: 10, bold: !!on, color: { argb: 'FFFFFFFF' } };
      s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: on ? BLUE : DARK } };
    } else {
      s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
    }
    s.alignment = { vertical: 'center' };
    ws.mergeCells(r, 2, r, ncols);
    const m = ws.getCell(r, 2);
    const line = mains[i];
    if (line) {
      if (typeof line === 'string') m.value = line;
      else {
        m.value = { richText: line.parts };
        if (line.fill) m.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: line.fill } };
        if (line.fontColor) m.font = { color: { argb: line.fontColor }, bold: true };
      }
    }
    m.border = BORDER;
    m.alignment = { vertical: 'center', wrapText: true };
    m.font = m.font || { size: 10 };
    r++;
  }
  return r + 1;
}

const num = (t) => [{ text: t + ' ', font: { bold: true, color: { argb: RED }, size: 12 } }];
const RT = (...parts) => parts;

import { readFileSync } from 'node:fs';
function pngSize(file) { const b = readFileSync(file); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; }

/* 화면 그림 시트 (PNG 삽입, 가로 760px로 축소 표시) */
function picSheet(wb, title, color, items) {
  const ws = wb.addWorksheet('화면 그림');
  ws.columns = [{ width: 112 }];
  ws.pageSetup = { orientation: 'portrait', fitToWidth: 1, fitToHeight: 0, paperSize: 9, fitToPage: true };
  titleBar(ws, 1, title, color);
  let r = 3;
  items.forEach(({ file, caption }) => {
    const c = ws.getCell(r, 1);
    c.value = caption;
    c.font = { bold: true, size: 11 };
    r++;
    const { w, h } = pngSize(file);
    const dispW = 760, dispH = Math.round((dispW * h) / w);
    const id = wb.addImage({ filename: file, extension: 'png' });
    ws.addImage(id, { tl: { col: 0, row: r - 1 }, ext: { width: dispW, height: dispH } });
    r += Math.ceil(dispH / 20) + 2;
  });
}

/* ============ 표지 ============ */
function cover(ws, ncols, color, lines) {
  titleBar(ws, ncols, lines[0], color);
  let r = 3;
  lines.slice(1).forEach((t) => {
    ws.mergeCells(r, 1, r, ncols);
    const c = ws.getCell(r, 1);
    c.value = t; c.alignment = { wrapText: true, vertical: 'center' };
    if (t.startsWith('■')) c.font = { bold: true, size: 11 };
    r++;
  });
  return r;
}

/* ================= 관리자 ================= */
{
  const wb = base('admin', BLUE);
  const W = [10, 20, 52, 36];
  const ws = wb.addWorksheet('따라하기');
  ws.columns = W.map((w) => ({ width: w }));
  ws.pageSetup = { orientation: 'landscape', fitToWidth: 1, fitToHeight: 0, paperSize: 9, fitToPage: true };
  titleBar(ws, 4, '관리자 이용 매뉴얼  |  비젠 회계관리 시스템 v1.0 (2026-10-01)', BLUE);
  let r = 3;
  r = section(ws, r, 4, '1 · 로그인 (관리자 아이디는 이미 전달됨)', BLUE);
  r = steps(ws, r, [
    [1, '로그인', '배포 주소 접속 → 전달받은 이메일·비밀번호 → [로그인]', '왼쪽 메뉴 17개가 보이면 성공'],
    [2, '비밀번호 변경', '오른쪽 위 이름 → 설정에서 본인 비밀번호로 변경', ''],
  ]);
  r = section(ws, r, 4, '2 · 계정관리 — 직원 계정 만들기·승인·권한', BLUE);
  r = steps(ws, r, [
    [1, '계정 추가', '관리 → 계정관리 → [+ 계정 추가] → 이름·이메일·비밀번호·역할(직원)·부서 → 저장', '목록에 새 직원이 보이면 OK'],
    [2, '가입 승인', '가입 신청분은 [승인대기] 표시 → 행의 [수정] → 사용함 체크 → 저장', '직원에게 “됐어요” 알리기'],
    [3, '권한 주기', '설정 → 직원 공통 권한 토글 저장 (전원 공통) + 특정인은 계정관리→수정→개별권한', '공통+개별 합집합 적용'],
    [4, '비번 재설정', '잊었다는 직원 → 해당 행 [비밀번호 변경]으로 직접 재설정', ''],
  ]);
  r = mock(ws, r, 4, '계정관리 화면 (관리 → 계정관리)', [['계정관리', 1], ['자금관리', 0], ['설정', 0]], [
    { parts: RT(...num('①'), { text: '[+ 계정 추가]를 누릅니다' }) },
    '이름 · 이메일 · 역할(관리자/직원) · 상태(사용중/승인대기) 목록',
    { parts: RT(...num('②'), { text: '승인대기 행 → [수정]에서 사용함 체크' }) },
    { parts: RT(...num('③'), { text: '행 버튼: [수정] [비밀번호 변경] [삭제]' }) },
  ]);
  r = section(ws, r, 4, '3 · 장부 입력 — 지결·운영비는 생길 때 바로 입력', BLUE);
  r = steps(ws, r, [
    [1, '등록', '해당 장부 → [등록] → 일자·거래처·항목·적요 입력', '모아서 입력 금지, 생길 때 바로'],
    [2, '금액', '공급가액+부가세 나눠 입력 (합계 자동 계산)', '합계 눈으로 확인'],
    [3, '프로젝트', '프로젝트 지정 → 저장 (미지정 시 “프로젝트 미지정”으로 남음)', '손익에 자동 집계됨'],
    [4, '증빙·일괄', '영수증 첨부(파일당 20MB) / 엑셀분량은 [CSV 일괄등록]→양식 다운로드→업로드', '프로젝트명은 등록명과 정확히 일치'],
  ]);
  r = mock(ws, r, 4, '장부 화면 (예: 매출)', [['매출', 1], ['매입', 0], ['운영비', 0], ['지출결의', 0]], [
    { parts: RT(...num('①'), { text: '[등록] [CSV 내보내기] [CSV 일괄등록]' }) },
    { parts: RT(...num('②'), { text: '필터: [기간▾] [검색어] [프로젝트▾] [담당자▾]' }) },
    '일자 · 거래처 · 공급가액 · 부가세 · 합계(자동) · 프로젝트',
    { parts: RT(...num('③'), { text: '행 클릭 → 수정·삭제·증빙 첨부' }) },
  ]);
  r = section(ws, r, 4, '4 · 프로젝트·수금·거래처', BLUE);
  r = steps(ws, r, [
    [1, '프로젝트 등록', '사업 → 프로젝트 → [프로젝트 등록]을 먼저 (계약금액·기간·담당자)', '연도는 고르는 기준, 금액은 전체기간 합계'],
    [2, '손익 확인', '카드 클릭 → 월별 손익·거래 내역 (직접 입력란 없음, 자동 집계)', '부대비용만이면 손실(−)이 정상'],
    [3, '수금·거래처', '수금관리 [입금 등록]→수금률 확인 / 거래처 등록·서류첨부·중복은 합치기', '서류삭제·프로젝트삭제는 관리자만 (등록·수정은 직원도 가능)'],
  ]);
  r = section(ws, r, 4, '5 · 자금관리·급여관리 (관리자 전용 ★)', BLUE);
  r = steps(ws, r, [
    [1, '자금관리', '관리 → 자금관리 → 자금현황 [잔고 기록] / 법인카드 파일업로드→분류→[일괄등록]', '카드번호 뒤4자리 마스킹'],
    [2, '급여관리', '급여대장 CSV 올리기 → 귀속월(근무한 달) 집계 확인', '장부급여=실지급액−지출결의'],
    [3, '구성원', '인라인 편집 → [수정중 N건 일괄저장]', '근속·생일 자동계산'],
  ]);
  r = section(ws, r, 4, '6 · 세금·보고서', BLUE);
  r = steps(ws, r, [
    [1, '세금관리', '연도 선택 → 유형탭(부가세·원천세·4대보험·법인세) → 체크·토글', '부가세 예상=매출세액−매입세액'],
    [2, '보고서', '기간 → 요약 보기 → [요약CSV/상세CSV]·[인쇄/PDF]', '사이드바는 인쇄 제외, 임원 보고용'],
  ]);
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const w2 = wb.addWorksheet('규칙·FAQ·배포체크');
  w2.columns = [{ width: 24 }, { width: 94 }];
  w2.pageSetup = { orientation: 'landscape', fitToWidth: 1, fitToHeight: 0, paperSize: 9, fitToPage: true };
  titleBar(w2, 2, '규칙 · FAQ · 배포 체크리스트  |  관리자용', SLATE);
  let q = 3;
  q = section(w2, q, 2, '핵심 규칙', BLUE);
  [['금액', '공급가액+부가세 분리 입력, 합계 자동'], ['손익', '순매출−매입=매출총이익−운영비=영업이익 (부가세는 손익 제외)'],
   ['프로젝트', '손익 자동집계, 직접 입력 없음'], ['급여', '귀속월(근무한 달) 기준'],
   ['지출결의', '승인 절차 없는 기록 전용, 급여에 포함해 지급'],
   ['관리자 유지', '마지막 관리자 1명은 권한·삭제 불가']].forEach(([a, b]) => {
    const row = w2.getRow(q); row.getCell(1).value = a; row.getCell(2).value = b;
    row.height = 24;
    for (let i = 1; i <= 2; i++) { row.getCell(i).border = BORDER; row.getCell(i).alignment = { vertical: 'center', wrapText: true }; }
    row.getCell(1).font = { bold: true }; q++;
  });
  q = section(w2, q + 1, 2, 'FAQ', BLUE);
  [['메뉴가 안 보여요(직원)', '설정→직원공통권한 + 계정관리→개별권한 확인'], ['프로젝트 손익 0원', '장부 입력 시 프로젝트 지정 확인'],
   ['CSV 실패', '일자(YYYY-MM-DD)·공급가액 필수, 프로젝트명 정확히 일치'], ['급여 월이 달라요', '귀속월 기준이 정상 (지급일 흐름은 장부·대시보드)']].forEach(([a, b]) => {
    const row = w2.getRow(q); row.getCell(1).value = `Q. ${a}`; row.getCell(2).value = `A. ${b}`;
    row.height = 24;
    for (let i = 1; i <= 2; i++) { row.getCell(i).border = BORDER; row.getCell(i).alignment = { vertical: 'center', wrapText: true }; }
    q++;
  });
  q = section(w2, q + 1, 2, '배포 전 체크리스트 (배포 당일 체크)', BLUE);
  ['관리자 계정 2개 이상 만들기', '전 직원 가입+승인 완료', '직원 공통 권한 설정', '프로젝트·거래처 등록',
   '테스트 입력 1건 → 대시보드·보고서 확인 → 삭제', '이 엑셀(관리자용·직원용) 전 직원에게 전달'].forEach((t) => {
    const row = w2.getRow(q); row.getCell(1).value = '☐'; row.getCell(2).value = t;
    row.height = 24;
    for (let i = 1; i <= 2; i++) { row.getCell(i).border = BORDER; row.getCell(i).alignment = { vertical: 'center', wrapText: true }; }
    q++;
  });
  picSheet(wb, '화면 그림 — 실제 화면 (숫자·이름은 마스킹됨)  |  관리자용', BLUE, [
    { file: '이용매뉴얼/img/real-admin-dashboard.png', caption: '그림 1 · 대시보드 — 기간 고르기 → 숫자·추이·최근 지출결의·데이터점검' },
    { file: '이용매뉴얼/img/real-admin-users.png', caption: '그림 2 · 계정관리 — ① [+ 계정 추가] ② 승인대기 [수정]→사용함 체크 ③ [수정][비밀번호 변경][삭제]' },
    { file: '이용매뉴얼/img/real-admin-sales.png', caption: '그림 3 · 매출 장부 — [매출 등록][CSV 내보내기][CSV 일괄등록] + 기간·검색·프로젝트 필터 (지결·운영비도 같은 모양, 생길 때 바로 입력)' },
  ]);
  await wb.xlsx.writeFile('이용매뉴얼/관리자-이용매뉴얼.xlsx');
  console.log('admin done');
}

/* ================= 직원 ================= */
{
  const wb = base('staff', GREEN);
  const ws = wb.addWorksheet('따라하기');
  ws.columns = [10, 20, 52, 36].map((w) => ({ width: w }));
  ws.pageSetup = { orientation: 'landscape', fitToWidth: 1, fitToHeight: 0, paperSize: 9, fitToPage: true };
  titleBar(ws, 4, '직원 이용 매뉴얼  |  비젠 회계관리 시스템 v1.0 (2026-10-01)', GREEN);
  let r = 3;
  r = section(ws, r, 4, '1 · 로그인 — 아이디는 전달받음, 처음 1번만', GREEN);
  r = steps(ws, r, [
    [1, '로그인', '배포 주소 접속 → 전달받은 아이디·초기 비밀번호 → [로그인]', '왼쪽 메뉴가 보이면 성공'],
    [2, '비밀번호 변경', '오른쪽 위 이름 → 설정에서 본인 비밀번호로 변경', '초기 비번 그대로 쓰기 금지'],
  ]);
  r = mock(ws, r, 4, '내 사이드바 (기본 5개)', [['대시보드', 1], ['지출결의', 1], ['프로젝트', 1], ['거래처', 1], ['설정', 1]], [
    '기본: 대시보드 · 지출결의 · 프로젝트 · 거래처 · 설정',
    '회사 설정에 따라 매출·보고서·휴무대장 등이 추가될 수 있음',
    '구성원·급여·계정·자금은 관리자만 (내 화면에 없음)',
  ]);
  r = section(ws, r, 4, '2 · 지출결의·운영비 — 생길 때 바로 입력 ★', GREEN);
  r = steps(ws, r, [
    [1, '등록', '장부 → 지출결의(또는 운영비) → [등록]', '모아서 입력 금지'],
    [2, '내용', '일자(쓴 날짜) · 적요(예: 고객사 미팅 교통비) 입력', ''],
    [3, '금액', '공급가액+부가세 나눠 입력 (합계 자동)', '합계 눈으로 확인'],
    [4, '증빙·저장', '영수증 사진 첨부(20MB까지) → [저장]', '목록에 내 글이 보이면 끝'],
    [5, '수정', '내 글만 고치고 지울 수 있음 (남의 글은 보기만)', '프로젝트 있으면 고르기, 없으면 비워두기'],
  ]);
  r = mock(ws, r, 4, '지출결의 등록 흐름', [['지출결의', 1]], [
    { parts: RT(...num('①'), { text: '[등록]을 누릅니다' }) },
    { parts: RT(...num('②'), { text: '일자 · 적요 · 공급가액+부가세 입력' }) },
    { parts: RT(...num('③'), { text: '영수증 사진 첨부 → [저장], 끝!' }) },
  ]);
  r = section(ws, r, 4, '3 · 조회하기 — 대시보드·장부·프로젝트·거래처', GREEN);
  r = steps(ws, r, [
    [1, '대시보드', '기간 고르기(이번달/지난달/분기/올해/작년/직접) → 숫자·추이 확인', ''],
    [2, '장부(허용 시)', '매출·매입·운영비 → 필터로 조회, CSV 내보내기 가능', '남의 글은 보기만'],
    [3, '프로젝트', '카드 연필(수정)·[프로젝트 등록]으로 등록·수정 가능', '삭제만 관리자에게 요청 (비용만 보일 수 있음, 정상)'],
    [4, '거래처', '검색 → 등록·수정 가능', '삭제는 관리자에게 요청'],
  ]);
  r = section(ws, r, 4, '4 · 휴무·내 정보', GREEN);
  r = steps(ws, r, [
    [1, '휴무(허용 시)', '[휴무 등록] → 종류·날짜·사유 → 저장 → 승인/반려 확인', '잔여 자동계산'],
    [2, '내 정보', '오른쪽 위 이름 → 내 정보·설정 → 저장 / 비밀번호 변경·로그아웃', '모바일은 ☰ 버튼'],
  ]);
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const w2 = wb.addWorksheet('FAQ');
  w2.columns = [{ width: 34 }, { width: 84 }];
  w2.pageSetup = { orientation: 'landscape', fitToWidth: 1, fitToHeight: 0, paperSize: 9, fitToPage: true };
  titleBar(w2, 2, 'FAQ — 모르면 여기  |  직원용', SLATE);
  let q = 3;
  q = section(w2, q, 2, '할 수 있는 일 / 없는 일', GREEN);
  [['할 수 있어요', '지출결의 등록·수정·삭제(본인분), 거래처 등록·수정, 허용된 장부 조회, 휴무 등록, 내 정보 변경'],
   ['안 돼요 (요청하세요)', '남의 글 수정·삭제, 프로젝트 삭제, 비밀번호 찾기(재설정 요청)']].forEach(([a, b]) => {
    const row = w2.getRow(q); row.getCell(1).value = a; row.getCell(2).value = b;
    row.height = 30;
    for (let i = 1; i <= 2; i++) { row.getCell(i).border = BORDER; row.getCell(i).alignment = { vertical: 'center', wrapText: true }; }
    row.getCell(1).font = { bold: true }; q++;
  });
  q = section(w2, q + 1, 2, '자주 묻는 질문', GREEN);
  [['비밀번호를 잊었어요', '본인이 찾을 수 없어요. 관리자에게 재설정을 요청하세요'],
   ['대표카드 내역이 안 보여요', '본인이 등록한 것만 보이는 정책이라 정상이에요'],
   ['파일 첨부가 안 돼요', '20MB 이하로 줄여보세요. 그래도 안 되면 캡처해서 관리자에게 전달'],
   ['문제 생기면', '①어떤 메뉴 ②뭐 하다가 ③뭔 메시지가 떴는지 캡처해서 관리자에게 보내주세요']].forEach(([a, b]) => {
    const row = w2.getRow(q); row.getCell(1).value = `Q. ${a}`; row.getCell(2).value = `A. ${b}`;
    row.height = 30;
    for (let i = 1; i <= 2; i++) { row.getCell(i).border = BORDER; row.getCell(i).alignment = { vertical: 'center', wrapText: true }; }
    q++;
  });
  picSheet(wb, '화면 그림 — 실제 화면 (숫자·이름은 마스킹됨)  |  직원용', GREEN, [
    { file: '이용매뉴얼/img/real-staff-menu.png', caption: '그림 1 · 직원 메뉴 — 기본 5개: 대시보드·운영비·지출결의·프로젝트·거래처·설정 (왼쪽 ☰ 버튼을 누르면 열림)' },
    { file: '이용매뉴얼/img/real-staff-dashboard.png', caption: '그림 2 · 직원 대시보드 — 내 지출결의 요약 + [등록하러 가기]' },
    { file: '이용매뉴얼/img/real-staff-expense.png', caption: '그림 3 · 지출결의 — [+ 지출결의 등록]을 눌러 생길 때 바로 입력 (일자·적요·금액→영수증 사진→저장)' },
  ]);
  await wb.xlsx.writeFile('이용매뉴얼/직원-이용매뉴얼.xlsx');
  console.log('staff done');
}
