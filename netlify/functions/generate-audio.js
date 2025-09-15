// netlify/functions/generate-audio.js
// TTS: OpenAI 우선 → 실패 시 Google 폴백 (SSML 지원/전처리)
// 요청: { text?:string, ssml?:string, voice?:string, speed?:number, provider?:'openai'|'google' }
// 응답: { audioData:string, audioBase64:string, mimeType:string }  ← 두 키 모두(클라 호환)

const fetch = global.fetch || require('node-fetch');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const GOOGLE_TTS_KEY = process.env.GOOGLE_TTS_KEY || '';

const OPENAI_MODEL = 'gpt-4o-mini-tts';
const DEFAULT_VOICE = 'shimmer'; // 안정적 기본값
const SAFE_VOICES = new Set(['alloy','shimmer','verse','nova','fable','echo']);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,Accept',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8'
};

exports.handler = async (event) => {
  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { message: 'Method Not Allowed' });
  }

  try {
    // ---- 입력 파싱 ----
    const body = JSON.parse(event.body || '{}');
    const providerReq = String(body.provider || '').toLowerCase();
    const provider = providerReq === 'google' ? 'google' : 'openai'; // 명시하면 존중
    const voiceReq = String(body.voice || DEFAULT_VOICE);
    const voice = SAFE_VOICES.has(voiceReq) ? voiceReq : DEFAULT_VOICE;
    const speed = clamp(Number(body.speed ?? 1.0), 0.5, 2.0);

    // text/ssml 중 하나는 필수
    const textIn = typeof body.text === 'string' ? body.text : '';
    const ssmlIn = typeof body.ssml === 'string' ? body.ssml : '';
    if (!textIn && !ssmlIn) return json(400, { message: 'text or ssml required' });

    // 전처리(발음 안정화): ssml이 있으면 태그 제거 후 전처리 → 다시 SSML로 감쌀 때 사용
    const rawForNormalize = ssmlIn ? stripXml(ssmlIn) : textIn;
    const normalizedText = koPronunNormalize(safeText(rawForNormalize));

    // ---- 1) OpenAI 시도 (SSML 미지원 → 태그 제거 텍스트 사용) ----
    if ((provider === 'openai' || !GOOGLE_TTS_KEY) && OPENAI_API_KEY) {
      try {
        const r = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: OPENAI_MODEL,
            input: normalizedText,  // SSML 제거본
            voice,
            speed,
            format: 'wav' // 초두 클리핑 방지/브라우저 호환
          })
        });

        if (r.ok) {
          const buf = Buffer.from(await r.arrayBuffer());
          const b64 = buf.toString('base64');
          return json(200, { audioData: b64, audioBase64: b64, mimeType: 'audio/wav' });
        } else {
          // 실패 상세 로그(서버 콘솔)
          const detail = await r.text().catch(()=> '');
          console.error('OpenAI TTS failed:', r.status, detail);
        }
      } catch (e) {
        console.error('OpenAI TTS error:', e);
        // 폴백 진행
      }
    }

    // ---- 2) Google TTS 폴백 (SSML 지원) ----
    if (!GOOGLE_TTS_KEY) {
      // 더 이상 시도 불가
      return json(500, { message: 'No TTS provider available' });
    }

    // 클라가 준 SSML이 있으면 우선 사용, 없으면 전처리된 텍스트를 SSML로 래핑
    // 초두 150ms 무음으로 TTS 버퍼링 완화
    const ssml = ssmlIn && ssmlIn.trim()
      ? ensureLeadBreak(ssmlIn)
      : `<speak><break time="150ms"/>${escapeXml(normalizedText)}</speak>`;

    const gr = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { ssml },
        voice: { languageCode: 'ko-KR' }, // 필요시 name 추가 가능
        audioConfig: { audioEncoding: 'OGG_OPUS', speakingRate: speed }
      })
    });

    if (!gr.ok) {
      const d = await gr.text().catch(()=> '');
      console.error('Google TTS failed:', gr.status, d);
      return json(502, { message: 'Google TTS failed', detail: d });
    }

    const gj = await gr.json();
    return json(200, { audioData: gj.audioContent, audioBase64: gj.audioContent, mimeType: 'audio/ogg' });

  } catch (err) {
    console.error(err);
    return json(500, { message: 'generate-audio failed', error: String(err) });
  }
};

// ----------------------- 유틸 -----------------------
function json(statusCode, obj) { return { statusCode, headers: CORS, body: JSON.stringify(obj) }; }
function clamp(n, lo, hi){ return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : 1)); }
function safeText(s=''){ return String(s).slice(0, 2000); } // 안전 길이 제한
function escapeXml(s=''){ return String(s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;' }[c])); }
function stripXml(s=''){ return String(s).replace(/<[^>]*>/g,''); }
function ensureLeadBreak(ssml=''){
  const body = String(ssml).trim();
  // <speak> 바로 뒤에 break 없으면 삽입
  if (!/^<speak[\s>]/i.test(body)) return `<speak><break time="150ms"/>${escapeXml(stripXml(body))}</speak>`;
  if (!/<break[^>]*time=/i.test(body)) return body.replace(/^<speak(\s*[^>]*)>/i, '<speak$1><break time="150ms"/>');
  return body;
}

// 한국어 발음 안정화: '몇 시/몇 초'의 과도한 /ʃ/ /t/화 방지 + 숫자 단위 사이 띄어쓰기 제거
function koPronunNormalize(s) {
  if (!s) return s;
  return String(s)
    .replace(/몇\s+시/g, '몇시')
    .replace(/몇\s+초/g, '몇초')
    .replace(/(\d)\s*시/g, '$1시')
    .replace(/(\d)\s*분/g, '$1분')
    .replace(/(\d)\s*초/g, '$1초')
    // 추가: '몇 분'은 유지(혼동 방지)
    ;
}
