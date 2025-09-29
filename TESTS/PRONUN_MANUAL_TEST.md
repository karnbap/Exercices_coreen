Pronunciation mini-test — Manual verification checklist

A. 목적
- 실시간(STT) 표시와 녹음 후 결과(하이라이트)에 사용된 텍스트가 일치하는지 확인합니다.
- 서버의 원시/정규화된 transcript를 캡처해 불일치 원인을 분석합니다.

B. 로컬 브라우저 테스트 시나리오 (단계별)
1. 브라우저: Chrome (권장), Edge 또는 Firefox
2. 페이지 열기: 해당 연습 페이지(예: pronun-mini-test.html 또는 프로젝트의 해당 경로)
3. 마이크 권한 허용
4. Etape 1 카드 확인
   - 카드가 로드될 때 문장이 숨겨져 있고 "잘 듣고 따라하세요 / Écoutez et répétez" 가 보이는지 확인
   - ▶ 듣기 버튼을 눌러 TTS가 재생되는지 확인
   - '도움받기1' / '도움받기2' 버튼을 눌러 힌트가 토글되는지 확인
5. 녹음 테스트(한 카드)
   - 녹음 시작 버튼을 누르고 한 문장을 말한 뒤 정지
   - 실시간(live) 상자에 표시된 텍스트를 기록
   - 평가(Évaluer)가 끝난 뒤 결과의 "내 발음" 텍스트와 하이라이트가 실시간에 표시된 텍스트와 일치하는지 확인
   - 실시간 텍스트와 결과 텍스트가 다르면 다음 서버 캡처를 활성화

C. 서버 transcript 캡처 활성화 (개발 서버에서만 실행)
- 목적: 서버에서 Whisper가 반환한 `transcriptRaw`와 내부 정규화된 `transcript`를 캡처해 불일치 원인(정규화/숫자 변환 등)을 확인
- 방법: 실행 환경에 환경변수 `CAPTURE_TRANSCRIPTS=1`을 설정하고 Netlify 함수(로컬) 또는 배포된 환경에서 함수 로그를 확인

예: 로컬에서 netlify dev 사용 시

```bash
CAPTURE_TRANSCRIPTS=1 netlify dev
```

로그 위치
- 함수 로그: 터미널에서 Netlify Dev가 출력하는 로그
- 추가 캡처 파일(서버 내): /tmp/pronun_transcript_capture.log (Netlify 로컬에서만 접근 가능)

D. 캡처 확인 절차
1. 캡처 활성화 후 동일 문장을 녹음하여 불일치 재현
2. 함수 로그에 아래 항목이 출력되는지 확인
   - requestId / timestamp
   - referenceText
   - transcriptRaw (Whisper 원문)
   - transcript (서버 정규화 후)
3. 캡처 파일을 열어 여러 사례를 비교하고, 어떤 정규화 규칙이 차이를 일으키는지 분석

E. 기록 예시 (로그)
{
  requestId: 'abc123',
  time: '2025-09-29T12:34:56Z',
  reference: '십유로짜리 초콜릿 세 개만 주세요.',
  transcriptRaw: '10유로짜리 초콜릿 세 개만 주세요',
  transcript: '십유로짜리 초콜릿 세개만 주세요'
}

F. 다음 단계
- 캡처 결과로 정규화 로직(refAwareNormalize/digitsToSinoInText/applyCounterVariants)에서 불필요한 자동 치환을 조정합니다.
- 필요 시 서버 로그를 익명화해 개발자에게 제공하면 원인 분석을 도와드리겠습니다.


