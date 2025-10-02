const { test, expect } = require('@playwright/test');

// The test expects a running preview server. Provide PREVIEW_URL env var when running.
const PREVIEW_URL = process.env.PREVIEW_URL || 'http://localhost:8080';

test.describe('LiveSTT simulator tests', () => {
  test('cards 5,8,9 should merge chunks without running words together', async ({ page }) => {
    // Inject a small SENTENCES array before page scripts run so cards are created
    await page.addInitScript(() => {
      window.SENTENCES = [
        { ko: '오늘 아침', voice: 'shimmer', speed: 1.0 },
        { ko: '내가 오늘', voice: 'shimmer', speed: 1.0 },
        { ko: '아침에 산책', voice: 'shimmer', speed: 1.0 },
      ];
    });

    await page.goto(PREVIEW_URL + '/assignments/pronun-mini-test.html');

    // Wait for LiveSTT to be available on the page
    await page.waitForFunction(() => !!window.LiveSTT || !!window.LIVESTT_DEBUG, null, { timeout: 5000 });

    // Helper to run simulate in page and return the rendered texts
    async function simulateAndRead(cardSelector, chunks) {
      const simResult = await page.evaluate(({ cardSelector, chunks }) => {
        const el = document.querySelector(cardSelector);
        if (!el) throw new Error('card-not-found:' + cardSelector);
        if (!window.LiveSTT || !window.LiveSTT.simulate) throw new Error('LiveSTT.simulate missing');
        return window.LiveSTT.simulate(el, chunks);
      }, { cardSelector, chunks });

      // give the page a short moment to render updates
      await page.waitForTimeout(150);

      return page.evaluate((cardSelector) => {
        const el = document.querySelector(cardSelector);
        // LiveSTT.render uses .pronun-live; legacy code used [data-live]
        const liveEl = el && (el.querySelector('.pronun-live') || el.querySelector('[data-live]'));
        const ref = el && el.querySelector('[data-ref-display]');
        const hyp = el && el.querySelector('[data-hyp-display]');
        return {
          live: liveEl ? liveEl.textContent : null,
          ref: ref ? ref.textContent : null,
          hyp: hyp ? hyp.textContent : null,
        };
      }, cardSelector);
    }

    // scenarios: each is an array of chunks with isFinal flag
    const scenarios = [
      // first card: final "오늘" then final "아침" without leading space
      { selector: '.card[data-index="0"]', chunks: [
        { text: '오늘', isFinal: true },
        { text: '아침', isFinal: true }
      ]},
      // second card: zero-width/nbsp inside
      { selector: '.card[data-index="1"]', chunks: [
        { text: '내\u200B가', isFinal: true },
        { text: '\u00A0오늘', isFinal: true }
      ]},
      // third card: interim then final both odd
      { selector: '.card[data-index="2"]', chunks: [
        { text: '오늘', isFinal: false },
        { text: '아침에', isFinal: true }
      ]},
    ];

    for (const s of scenarios) {
      const result = await simulateAndRead(s.selector, s.chunks);
      // assert that live text doesn't contain invisible/nbsp characters
      if (result.live) {
        expect(result.live.replace(/\s+/g, ' ')).not.toMatch(/[\u00A0\u200B]/);
        // also ensure there is at least one space between Korean words (crude check)
        expect(result.live).toMatch(/\S\s+\S/);
      }
    }
  });
});
