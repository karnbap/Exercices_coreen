// Netlify Function: analyze-pronunciation
// 입력(JSON):
// { referenceText: "하나둘셋", audio: { base64, filename, mimeType, duration } }
// 출력(JSON):
// { accuracy: 0.92, transcript: "하나둘셋", details: { explain: ["..."] } }

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const refRaw = String(body.referenceText || '').trim();
    const audio = body.audio || {};

    // 1) STT (기존 transcribe 함수가 있으면 사용, 없으면 안전 폴백)
    let transcript = '';
    try {
      const { transcribeWhisper } = require('./transcribe-whisper.js'); // 프로젝트에 이미 존재
      transcript = await transcribeWhisper(audio.base64, audio.mimeType || 'audio/webm');
    } catch (_e) {
      // 폴백: STT 불가 시 빈 문자열 유지
      transcript = '';
    }

    // 2) 전처리
    const ref = normalizeKorean(replaceDigitSequencesWithSino(collapse(refRaw)));
    const hyp = normalizeKorean(collapse(transcript));

    // 3) 자모 단위 정렬/정확도
    const A = toJamo(ref);
    const B = toJamo(hyp);
    const { distance, ops } = levenshteinOps(A, B);
    const maxLen = Math.max(A.length, 1);
    const cer = Math.min(1, distance / maxLen);
    const accuracy = +(1 - cer);

    // 4) 혼동 탐지(자음 + 모음 세부쌍) — ★ 개선 포인트
    const tags = detectConfusions(ref, hyp, ops);

    // 5) 설명 메시지 구성
    const explain = explainMistakes({ ref, hyp, ops, tags, accuracy });

    return json(200, {
      accuracy,
      transcript,
      details: { explain }
    });

  } catch (e) {
    return json(500, { error: e.message || 'Analyse échouée' });
  }
};

/* ---------------- Utils ---------------- */

function json(code, obj) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

function collapse(s) { return String(s || '').replace(/\s+/g, ''); }

function replaceDigitSequencesWithSino(s) {
  // 예: 22345 → 이이삼사오 (간단 변환; 문맥 따라 더 고도화 가능)
  const sino = ['영','일','이','삼','사','오','육','칠','팔','구'];
  return String(s).replace(/\d/g, d => sino[+d] || d);
}

function normalizeKorean(s) {
  // 대소문자 제거, 특수문자 최소화
  return s.normalize('NFC').replace(/[^\p{Letter}\p{Number}]/gu, '');
}

/* ---- 한글 → 자모 분해 ---- */
const HANGUL_BASE = 0xAC00;
const CHOSEONG = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const JUNGSEONG = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
const JONGSEONG = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

function toJamo(s) {
  const out = [];
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) {
      const syllableIndex = code - HANGUL_BASE;
      const cho = Math.floor(syllableIndex / (21 * 28));
      const jung = Math.floor((syllableIndex % (21 * 28)) / 28);
      const jong = syllableIndex % 28;
      out.push(CHOSEONG[cho], JUNGSEONG[jung]);
      if (JONGSEONG[jong]) out.push(JONGSEONG[jong]);
    } else {
      out.push(ch);
    }
  }
  return out;
}

/* ---- Levenshtein with ops ---- */
function levenshteinOps(aArr, bArr) {
  const n = aArr.length, m = bArr.length;
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = (aArr[i - 1] === bArr[j - 1]) ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // 삭제
        dp[i][j - 1] + 1,      // 삽입
        dp[i - 1][j - 1] + cost // 치환
      );
    }
  }
  // backtrack
  const ops = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) { ops.push({ op: 'D', a: aArr[i - 1] }); i--; continue; }
    if (j > 0 && dp[i][j] === dp[i][j - 1] + 1) { ops.push({ op: 'I', b: bArr[j - 1] }); j--; continue; }
    const cost = (aArr[i - 1] === bArr[j - 1]) ? 0 : 1;
    ops.push({ op: cost ? 'S' : 'M', a: aArr[i - 1], b: bArr[j - 1] });
    i--; j--;
  }
  ops.reverse();
  return { distance: dp[n][m], ops };
}

/* ---- 받침 카운트 보조 ---- */
function countJong(s) {
  let total = 0, count = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) {
      total++;
      const idx = (code - HANGUL_BASE) % 28;
      if (idx !== 0) count++;
    }
  }
  return { total, count };
}

/* ---- 모음/자음 혼동 탐지 (개선된 버전) ---- */
function isPair(a, b, x, y) { return (a === x && b === y) || (a === y && b === x); }

const VOWELS_SET = new Set('ㅏㅑㅓㅕㅗㅛㅜㅠㅡㅣㅔㅐㅖㅒㅘㅙㅚㅝㅞㅟㅢ'.split(''));
function isVowelJamo(j){ return VOWELS_SET.has(j); }
function isPairEither(a,b,x,y){ return (a===x && b===y) || (a===y && b===x); }

function detectConfusions(refText, hypText, ops) {
  const tags = new Set();

  // 받침 누락 경향
  const refTails = countJong(replaceDigitSequencesWithSino(refText));
  const hypTails = countJong(replaceDigitSequencesWithSino(hypText));
  if (refTails.total > 0 && hypTails.count < refTails.count * 0.7) tags.add('받침 누락');

  for (const step of ops) {
    if (step.op !== 'S') continue;

    // 자음 대표쌍
    if (isPair(step.a,step.b,'ㄴ','ㄹ')) tags.add('ㄴ/ㄹ 혼동');
    if (isPair(step.a,step.b,'ㅂ','ㅍ')) tags.add('ㅂ/ㅍ 혼동');
    if (isPair(step.a,step.b,'ㄷ','ㅌ')) tags.add('ㄷ/ㅌ 혼동');
    if (isPair(step.a,step.b,'ㅈ','ㅊ')) tags.add('ㅈ/ㅊ 혼동');
    if (isPair(step.a,step.b,'ㅅ','ㅆ')) tags.add('ㅅ/ㅆ 혼동');

    // ★ 모음 세부 혼동 (추가)
    if (isVowelJamo(step.a) && isVowelJamo(step.b)) {
      const A = step.a, B = step.b;
      const before = tags.size;

      // 기본 축
      if (isPairEither(A,B,'ㅗ','ㅓ')) tags.add('ㅗ/ㅓ 혼동');
      if (isPairEither(A,B,'ㅗ','ㅜ')) tags.add('ㅗ/ㅜ 혼동');
      if (isPairEither(A,B,'ㅏ','ㅓ')) tags.add('ㅏ/ㅓ 혼동');
      if (isPairEither(A,B,'ㅔ','ㅐ')) tags.add('ㅔ/ㅐ 혼동');

      // y-첨가(ㅠ ㅑ ㅕ ㅛ ㅖ ㅒ)
      if (isPairEither(A,B,'ㅜ','ㅠ')) tags.add('ㅜ/ㅠ 혼동');
      if (isPairEither(A,B,'ㅏ','ㅑ')) tags.add('ㅏ/ㅑ 혼동');
      if (isPairEither(A,B,'ㅓ','ㅕ')) tags.add('ㅓ/ㅕ 혼동');
      if (isPairEither(A,B,'ㅗ','ㅛ')) tags.add('ㅗ/ㅛ 혼동');
      if (isPairEither(A,B,'ㅔ','ㅖ')) tags.add('ㅔ/ㅖ 혼동');
      if (isPairEither(A,B,'ㅐ','ㅒ')) tags.add('ㅐ/ㅒ 혼동');

      // 이중모음 vs 단모음
      if (isPairEither(A,B,'ㅘ','ㅗ') || isPairEither(A,B,'ㅘ','ㅏ')) tags.add('ㅘ 혼동(ㅗ/ㅏ)');
      if (isPairEither(A,B,'ㅙ','ㅗ') || isPairEither(A,B,'ㅙ','ㅐ')) tags.add('ㅙ 혼동(ㅗ/ㅐ)');
      if (isPairEither(A,B,'ㅚ','ㅗ') || isPairEither(A,B,'ㅚ','ㅣ')) tags.add('ㅚ 혼동(ㅗ/ㅣ)');
      if (isPairEither(A,B,'ㅝ','ㅜ') || isPairEither(A,B,'ㅝ','ㅓ')) tags.add('ㅝ 혼동(ㅜ/ㅓ)');
      if (isPairEither(A,B,'ㅞ','ㅜ') || isPairEither(A,B,'ㅞ','ㅔ')) tags.add('ㅞ 혼동(ㅜ/ㅔ)');
      if (isPairEither(A,B,'ㅟ','ㅜ') || isPairEither(A,B,'ㅟ','ㅣ')) tags.add('ㅟ 혼동(ㅜ/ㅣ)');
      if (isPairEither(A,B,'ㅢ','ㅡ') || isPairEither(A,B,'ㅢ','ㅣ')) tags.add('ㅢ 혼동(ㅡ/ㅣ)');

      // 아무 태그도 붙지 않았으면 일반 모음 혼동
      if (tags.size === before) tags.add(`모음 혼동(${A}/${B})`);
    }
  }
  return Array.from(tags);
}

function explainMistakes({ ref, hyp, ops, tags, accuracy }) {
  const msgs = [];
  const pct = Math.round((accuracy || 0) * 100);
  msgs.push(`점수: ${pct}%`);

  if (tags.length) {
    tags.forEach(t => msgs.push(t));
  } else if (pct < 100) {
    msgs.push('소리 길이/리듬 또는 모음/받침 미세 차이 가능');
  } else {
    msgs.push('아주 좋습니다! 리듬 유지!');
  }

  // 추가 가이드: 대표 모음쌍 팁
  if (tags.some(t => /ㅜ\/ㅠ/.test(t))) msgs.push('Tip: ㅠ는 ㅜ 시작에 짧은 y-소리(“y”)를 살짝 붙여요.');
  if (tags.some(t => /ㅏ\/ㅑ/.test(t))) msgs.push('Tip: ㅑ는 ㅏ 앞에 y-슬라이드(“ya”) 느낌.');
  if (tags.some(t => /ㅗ\/ㅓ/.test(t))) msgs.push('Tip: ㅗ는 입술이 둥글게 앞으로, ㅓ는 편안하고 넓게.');
  if (tags.some(t => /ㅔ\/ㅐ/.test(t))) msgs.push('Tip: ㅐ가 약간 더 벌어집니다(“애”).');

  return msgs;
}
