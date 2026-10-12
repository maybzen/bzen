# -*- coding: utf-8 -*-
"""비젠 인트라넷 이용 매뉴얼 PPT 2종 생성 (관리자용 / 직원용).
실화면 PNG는 변형 없이 그대로 삽입한다."""
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(BASE, '이용매뉴얼', 'img')
FONT = '맑은 고딕'
NAVY = RGBColor(0x10, 0x17, 0x36)
BLUE = RGBColor(0x21, 0x48, 0xE6)
GREEN = RGBColor(0x0F, 0x9D, 0x58)
GRAY = RGBColor(0x4A, 0x55, 0x68)

def new(accent):
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    prs._accent = accent
    return prs

def blank(prs):
    return prs.slides.add_slide(prs.slide_layouts[6])

def cover(prs, tag, title, sub, accent):
    s = blank(prs)
    bg = s.background.fill
    bg.solid()
    bg.fore_color.rgb = NAVY
    tx = s.shapes.add_textbox(Inches(0.8), Inches(1.2), Inches(11.7), Inches(5)).text_frame
    tx.word_wrap = True
    p = tx.paragraphs[0]
    r = p.add_run(); r.text = tag
    r.font.size = Pt(16); r.font.bold = True
    r.font.color.rgb = accent; r.font.name = FONT
    p = tx.add_paragraph()
    r = p.add_run(); r.text = title
    r.font.size = Pt(44); r.font.bold = True
    r.font.color.rgb = RGBColor(255, 255, 255); r.font.name = FONT
    p.space_before = Pt(12)
    p = tx.add_paragraph()
    r = p.add_run(); r.text = sub
    r.font.size = Pt(18); r.font.color.rgb = RGBColor(0xC3, 0xCA, 0xD6); r.font.name = FONT
    p.space_before = Pt(18)
    return s

def section(prs, title, desc, accent):
    s = blank(prs)
    tx = s.shapes.add_textbox(Inches(0.8), Inches(0.5), Inches(11.7), Inches(1.2)).text_frame
    tx.word_wrap = True
    p = tx.paragraphs[0]
    r = p.add_run(); r.text = title
    r.font.size = Pt(34); r.font.bold = True
    r.font.color.rgb = accent; r.font.name = FONT
    p = tx.add_paragraph()
    r = p.add_run(); r.text = desc
    r.font.size = Pt(16); r.font.color.rgb = GRAY; r.font.name = FONT
    return s

def bullets(s, items, top=1.9, left=0.8, width=11.7, size=20, gap=10):
    tx = s.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(5)).text_frame
    tx.word_wrap = True
    first = True
    for it in items:
        p = tx.paragraphs[0] if first else tx.add_paragraph()
        first = False
        p.space_after = Pt(gap)
        p.level = 0
        if isinstance(it, tuple):
            h, b = it
            r = p.add_run(); r.text = h + '  '
            r.font.size = Pt(size); r.font.bold = True
            r.font.color.rgb = RGBColor(0x1A, 0x37, 0xC4); r.font.name = FONT
            r = p.add_run(); r.text = b
            r.font.size = Pt(size); r.font.color.rgb = RGBColor(0x1B, 0x24, 0x36); r.font.name = FONT
        else:
            r = p.add_run(); r.text = '▪  ' + it
            r.font.size = Pt(size); r.font.color.rgb = RGBColor(0x1B, 0x24, 0x36); r.font.name = FONT
    return s

def photo(s, path, caption, left=0.8, top=1.9, width=7.6, height=4.9):
    s.shapes.add_picture(path, Inches(left), Inches(top), Inches(width), Inches(height))
    tx = s.shapes.add_textbox(Inches(left), Inches(top + height + 0.05), Inches(width), Inches(0.5)).text_frame
    tx.word_wrap = True
    p = tx.paragraphs[0]
    r = p.add_run(); r.text = caption
    r.font.size = Pt(13); r.font.color.rgb = GRAY; r.font.name = FONT
    return s

def sidebullets(s, path, caption, items):
    photo(s, path, caption, width=7.2, height=4.9)
    bullets(s, items, top=1.9, left=8.3, width=4.2, size=16, gap=8)
    return s

def build_admin():
    prs = new(BLUE)
    A = BLUE
    cover(prs, '관리자용 · ADMIN', '비젠 인트라넷\n관리자 이용 매뉴얼',
          '대상: 관리자  |  버전 1.2 (2026-10-12)  |  실화면은 원본 그대로', A)

    s = section(prs, '전체 지도 — 메뉴 18개', '장부 6 · 사업 3 · 인사관리 3 · 세금·정산 2 · 관리 4  (★ = 관리자 전용)', A)
    bullets(s, [
        ('장부:', '대시보드 / 매출 / 매입 / 수금관리 / 운영비 / 지출결의'),
        ('사업:', '프로젝트 / 거래처 / 고정비'),
        ('인사관리:', '구성원★ / 급여관리★ / 휴무대장'),
        ('세금·정산:', '세금관리 / 보고서'),
        ('관리:', '계정관리★ / 자금관리★ / 휴지통★ / 설정'),
        '직원은 설정 + 공통권한 메뉴만 보입니다. 대시보드·구성원·급여·계정·자금·휴지통은 관리자 전용입니다.',
    ])

    s = section(prs, '1. 로그인', '관리자 아이디는 이미 전달된 상태입니다', A)
    bullets(s, [
        '배포 주소 접속 → 전달받은 이메일·비밀번호로 로그인',
        '오른쪽 위 이름 → 설정에서 비밀번호를 본인 것으로 변경',
        '비밀번호 분실 시: 본인이 찾을 수 없음 → 계정관리에서 관리자가 재설정',
        '마지막 관리자 1명은 권한을 내리거나 삭제할 수 없습니다.',
    ])

    s = section(prs, '2. 계정관리 — 직원 승인·권한', '관리 → 계정관리', A)
    sidebullets(s, os.path.join(IMG, 'real-admin-users.png'), '▲ 실제 화면 (원본 그대로, 마스킹만 적용)', [
        ('① 계정 추가:', '[+ 계정 추가] → 이름·이메일·비밀번호·역할·부서'),
        ('② 가입 승인:', '승인대기 행 → 수정 → 사용함 체크'),
        ('③ 권한:', '설정→직원 공통권한(전원) + 계정 수정→개별권한, 합집합 적용'),
        ('④ 재설정:', '행 버튼 [비밀번호 변경]'),
    ])

    s = section(prs, '3. 대시보드 — 회사 숫자 보기', '장부 → 대시보드 (관리자 전용)', A)
    sidebullets(s, os.path.join(IMG, 'real-admin-dashboard.png'), '▲ 실제 화면 (원본 그대로, 마스킹만 적용)', [
        '기간: 이번 달 · 지난 달 · 이번 분기 · 분기선택 · 올해 · 직접선택',
        ('순매출액:', '매출 공급가액 합계'),
        ('영업이익:', '순매출 − 매입 − 운영비 (부가세 제외)'),
        ('부가세 납부예상:', '매출세액 − 매입세액(매입+운영비)'),
        '12개월 추이 → 프로젝트별 수익 → 최근 지출결의 → 데이터점검',
    ])

    s = section(prs, '4. 장부 입력 — 4개 화면 구조 동일', '매출 · 매입 · 운영비 · 지출결의', A)
    sidebullets(s, os.path.join(IMG, 'real-admin-sales.png'), '▲ 매출 실제 화면 — 지출결의·운영비도 같은 모양', [
        ('① 등록:', '[등록] → 일자·거래처·항목·적요'),
        ('② 금액:', '공급가액+부가세 분리 입력, 합계 자동'),
        ('③ 프로젝트:', '지정하면 손익 자동집계, 직접 입력 없음'),
        ('④ 증빙:', '파일당 20MB, 비공개 보관'),
        '원칙: 지출결의·운영비는 생길 때 바로 입력 (모아서 입력 금지)',
    ])

    s = section(prs, '5. CSV 일괄등록 · 내보내기', '엑셀에 정리해 둔 자료용', A)
    bullets(s, [
        ('양식:', '각 장부 → CSV 일괄등록 → 양식 다운로드'),
        ('필수 열:', '일자(YYYY-MM-DD) · 공급가액'),
        ('선택 열:', '거래처 · 항목 · 적요 · 부가세 · 결제수단 · 비고 · 프로젝트'),
        '프로젝트명은 등록된 이름과 정확히 일치해야 연결됩니다.',
        ('내보내기:', '각 장부 → CSV 내보내기 / 보고서 → 요약·상세 CSV · 인쇄/PDF'),
    ])

    s = section(prs, '6. 프로젝트 · 수금 · 거래처', '사업 메뉴', A)
    bullets(s, [
        ('프로젝트:', '먼저 등록(계약금액·기간·담당자) → 장부에서 지정 → 손익 자동집계. 삭제는 관리자만'),
        ('수금관리:', '[입금 등록] → 수금률·미수금 확인 (계약 공급가액 기준)'),
        ('거래처:', '등록·수정·서류첨부·중복 합치기 가능. 서류삭제는 관리자만'),
        '연도는 프로젝트를 고르는 기준, 카드 금액은 항상 전체기간 합계입니다.',
    ])

    s = section(prs, '7. 자금관리 · 급여관리 · 구성원 ★', '관리자 전용', A)
    bullets(s, [
        ('자금관리:', '자금현황 [잔고 기록] / 법인카드 파일업로드 → 분류 → 일괄등록'),
        ('급여관리:', '급여대장 CSV → 귀속월(일한 달) 집계. 장부급여 = 실지급액 − 지출결의'),
        ('구성원:', '인라인 편집 → 일괄저장. 내부/외부협력/외부단기 구분'),
        '지급일 기준 현금흐름은 장부·대시보드(입력일 기준)에서 봅니다.',
    ])

    s = section(prs, '8. 세금 · 보고서 · 휴지통', '', A)
    bullets(s, [
        ('세금관리:', '연도 선택 → 부가세·원천세·4대보험·법인세 탭 → 체크·토글'),
        ('보고서:', '기간 선택 → 요약CSV / 상세CSV / 인쇄·PDF (임원 보고용)'),
        ('휴지통 ★:', '삭제된 장부·프로젝트 보관 → 복원·영구삭제. 영구삭제는 되돌릴 수 없음'),
    ])

    s = section(prs, '핵심 규칙 · FAQ · 배포 체크', '', A)
    bullets(s, [
        ('손익:', '순매출액 − 매입 = 매출총이익 − 운영비 = 영업이익'),
        ('프로젝트 손익 0원:', '장부 입력 시 프로젝트 지정 확인'),
        ('CSV 실패:', '일자·공급가액 필수, 프로젝트명 일치 확인'),
        ('☐ 배포 체크:', '관리자 2개 · 전 직원 승인 · 공통권한 · 프로젝트/거래처 등록 · 테스트 1건 입력→확인→삭제'),
    ], size=18)

    out = os.path.join(BASE, '이용매뉴얼', '관리자-이용매뉴얼.pptx')
    prs.save(out)
    print('saved', out, len(prs.slides.__iter__.__self__._sldIdLst), 'slides')

def build_staff():
    prs = new(GREEN)
    A = GREEN
    cover(prs, '직원용 · STAFF', '비젠 인트라넷\n직원 이용 매뉴얼',
          '처음 쓰는 분도 10분이면 끝나는 그림 설명서  |  버전 1.2 (2026-10-12)', A)

    s = section(prs, '1. 로그인', '아이디는 전달받음, 처음 1번만', A)
    bullets(s, [
        '배포 주소 접속 → 전달받은 아이디·초기 비밀번호로 로그인',
        '오른쪽 위 이름 → 설정에서 비밀번호를 본인 것으로 변경',
        '비밀번호를 잊으면 본인이 찾을 수 없습니다 → 관리자에게 재설정 요청.',
    ])

    s = section(prs, '2. 내 메뉴', '기본 메뉴 + 회사 설정에 따라 추가', A)
    sidebullets(s, os.path.join(IMG, 'real-staff-menu.png'), '▲ 실제 직원 메뉴 (원본 그대로)', [
        ('기본:', '지출결의 · 운영비 · 프로젝트 · 거래처 · 휴무대장 · 설정'),
        ('추가 가능:', '매출 · 매입 · 수금 · 고정비 · 세금 · 보고서'),
        ('없음:', '대시보드 · 구성원 · 급여 · 계정 · 자금 · 휴지통 (관리자 전용)'),
        '기간 고르기: 이번 달·지난 달·이번 분기·올해·직접선택',
    ])

    s = section(prs, '3. 지출결의 — 생길 때 바로 입력 ★', '승인 절차 없이 기록하면 끝', A)
    sidebullets(s, os.path.join(IMG, 'real-staff-expense.png'), '▲ 실제 지출결의 화면 (원본 그대로)', [
        ('① 등록:', '[등록] 누르기'),
        ('② 내용:', '일자(쓴 날짜) · 적요 · 공급가액+부가세 (합계 자동)'),
        ('③ 증빙:', '영수증 사진 첨부 → [저장], 끝!'),
        '내 글만 수정·삭제 가능. 프로젝트 있으면 고르고, 없으면 비워두기.',
    ])

    s = section(prs, '4. 내 대시보드', '본인 내역 요약', A)
    sidebullets(s, os.path.join(IMG, 'real-staff-dashboard.png'), '▲ 실제 화면 (원본 그대로)', [
        '기간 고르기 → 내 지출결의 요약 확인',
        '[등록하러 가기]로 바로 이동',
    ])

    s = section(prs, '5. 프로젝트 · 거래처 · 휴무 · 내 정보', '', A)
    bullets(s, [
        ('프로젝트:', '카드 클릭 → 내역 확인. 등록·수정은 직접 가능, 삭제는 관리자에게 요청'),
        ('거래처:', '검색 → 등록·수정 가능, 삭제는 요청'),
        ('휴무:', '[휴무 등록] → 종류·날짜·사유 → 승인/반려 확인. 주말출근 신청 시 대휴 자동계산'),
        ('설정:', '이름·부서·전화 수정, 비밀번호 변경·로그아웃'),
    ])

    s = section(prs, '6. 할 수 있는 일 / 없는 일 · 문제 생기면', '', A)
    bullets(s, [
        ('할 수 있어요:', '지출결의·운영비 즉시입력(본인분), 거래처 등록·수정, 허용 장부 조회, 휴무 등록'),
        ('요청하세요:', '남의 글 수정·삭제, 프로젝트 삭제, 비밀번호 재설정'),
        ('문제 생기면:', '①어떤 메뉴 ②뭐 하다가 ③무슨 메시지인지 캡처해서 관리자에게 전달.'),
    ])

    out = os.path.join(BASE, '이용매뉴얼', '직원-이용매뉴얼.pptx')
    prs.save(out)
    print('saved', out, len(prs.slides.__iter__.__self__._sldIdLst), 'slides')

build_admin()
build_staff()
