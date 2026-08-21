import { test, expect } from "@playwright/test";

// The /test gallery on a phone.
//
// WHAT THIS GUARDS: the cards used to OVERLAP on any narrow screen. `.card` sizes
// itself from `aspect-ratio` and every one of its children is absolutely
// positioned, so it contributes no content height — an `auto` grid row could not
// see the ratio, and once the rows stopped fitting the scrolling grid Chrome
// collapsed every track to a slice of the leftover space (measured: 45px tracks
// under 214px cards). Each card then sat on top of the next one's title and
// description, so the gallery was an unreadable stack of stripes. A desktop
// window never showed it — four columns fit their three rows and never reach the
// squeeze — which is exactly why this test pins a PHONE viewport.
//
// Geometry, not pixels: no screenshot diffing, so it cannot go flaky on fonts.

const PHONE = { width: 375, height: 812 };
const LANDSCAPE = { width: 812, height: 375 };

// Every card's box, in document space, top-to-bottom.
async function cardBoxes(page: import("@playwright/test").Page) {
  return page.$$eval(".card", els =>
    els
      .map(el => {
        const r = el.getBoundingClientRect();
        const title = el.querySelector(".card-title");
        return {
          top: r.top + window.scrollY,
          bottom: r.bottom + window.scrollY,
          left: r.left,
          right: r.right,
          height: r.height,
          title: title?.textContent?.trim() ?? "",
        };
      })
      .sort((a, b) => a.top - b.top || a.left - b.left),
  );
}

test.describe("the /test gallery on a phone", () => {
  // Level 2 has twelve categories — far more than fit one phone screen, which is
  // the condition that triggered the collapse. Level 3 adds the descriptions.
  for (const route of ["/#/test", "/#/test/streets", "/#/test/streets/lanes"]) {
    test(`cards stack without overlapping: ${route}`, async ({ page }) => {
      await page.setViewportSize(PHONE);
      await page.goto(route);
      await page.waitForSelector(".card");

      const boxes = await cardBoxes(page);
      expect(boxes.length).toBeGreaterThan(2);

      for (const b of boxes) {
        // A collapsed row squashed the tracks, never the cards themselves — the
        // card kept its ratio height and spilled over its neighbours. So assert
        // the SPACING, and assert the card is a real, readable box too.
        expect(b.height, `card "${b.title}" has no height`).toBeGreaterThan(60);
      }
      for (let i = 1; i < boxes.length; i++) {
        const prev = boxes[i - 1];
        const cur = boxes[i];
        // One column on a phone, so every card starts strictly below the last.
        expect(
          cur.top,
          `card "${cur.title}" overlaps "${prev.title}" (top ${cur.top} < bottom ${prev.bottom})`,
        ).toBeGreaterThanOrEqual(prev.bottom - 0.5);
      }
    });
  }

  test("titles and descriptions are visible and inside their card", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/#/test/streets/lanes");
    await page.waitForSelector(".card");

    const overflow = await page.$$eval(".card", els =>
      els
        .map(el => {
          const card = el.getBoundingClientRect();
          const label = el.querySelector(".card-title") as HTMLElement | null;
          const desc = el.querySelector(".card-desc") as HTMLElement | null;
          const name = label?.textContent?.trim() ?? "?";
          if (!label) return `${name}: no title`;
          const t = label.getBoundingClientRect();
          if (t.height < 8) return `${name}: title collapsed`;
          // The text has to sit inside the tile it belongs to, or the gradient
          // that makes it readable is not behind it.
          if (t.bottom > card.bottom + 0.5 || t.top < card.top - 0.5) {
            return `${name}: title outside its card`;
          }
          if (desc) {
            const d = desc.getBoundingClientRect();
            if (d.bottom > card.bottom + 0.5) return `${name}: description clipped off the card`;
          }
          return null;
        })
        .filter(Boolean),
    );
    expect(overflow, overflow.join("\n")).toEqual([]);
  });

  test("the page itself never scrolls sideways", async ({ page }) => {
    for (const size of [PHONE, LANDSCAPE]) {
      await page.setViewportSize(size);
      for (const route of ["/#/test", "/#/test/streets/lanes", "/#/test/streets/lanes/roadoneway"]) {
        await page.goto(route);
        await page.waitForSelector(".card, .test-stage");
        const w = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        }));
        expect(w.scroll, `${route} at ${size.width}x${size.height} scrolls sideways`).toBeLessThanOrEqual(
          w.client,
        );
      }
    }
  });

  test("a scenario stage keeps every control on screen", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/#/test/streets/lanes/roadoneway");
    await page.waitForSelector(".stage-controls");

    // The control bar is ~700px of chips: unwrapped it ran straight off a 375px
    // screen and the Cars slider and the delivery readout were unreachable.
    const clipped = await page.$$eval(".stage-controls > *", els =>
      els
        .map(el => {
          const r = el.getBoundingClientRect();
          return r.right > window.innerWidth + 0.5 || r.left < -0.5
            ? `${(el.textContent ?? "").trim().slice(0, 24)} @ ${Math.round(r.left)}..${Math.round(r.right)}`
            : null;
        })
        .filter(Boolean),
    );
    expect(clipped, `controls off-screen: ${clipped.join(", ")}`).toEqual([]);

    // ...and the board still gets room to exist under them.
    const vp = await page.locator(".stage-viewport").boundingBox();
    expect(vp?.height ?? 0).toBeGreaterThan(200);
  });
});
