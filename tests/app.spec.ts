import { expect, test, type Browser, type APIRequestContext, type Page } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RUN = Date.now().toString(36);

// 雛形スモーク。builder は受け入れ条件ごとの機能テストをこのファイルに追記する（雛形は削除しない）
test("ページがロードできてページエラーがない", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();
  expect(errors).toEqual([]);
});

test("GET /api/health が 200 で ok:true を返す", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

function clientIp(id: string): string {
  return `2001:db8:${RUN}::${id}`;
}

function parseTicket(text: string): number {
  const m = text.match(/あなたの整理券番号は (\d+) 番です/);
  if (!m) throw new Error(`unexpected ticket text: ${text}`);
  return Number(m[1]);
}

function parseTotal(text: string): number {
  const m = text.match(/現在 (\d+) 人が参加中/);
  if (!m) throw new Error(`unexpected total text: ${text}`);
  return Number(m[1]);
}

async function queueSnapshot(request: APIRequestContext) {
  const res = await request.get("/api/entries");
  const body = (await res.json()) as {
    total: number;
    entries: { position: number; name: string }[];
  };
  const max = body.entries.reduce((acc, row) => Math.max(acc, row.position), 0);
  return { total: body.total, max };
}

function totalLabel(n: number): string {
  return `現在 ${n} 人が参加中`;
}

async function openSession(browser: Browser, ip: string) {
  const context = await browser.newContext({
    extraHTTPHeaders: { "CF-Connecting-IP": ip },
  });
  const page = await context.newPage();
  const listLoaded = page.waitForResponse((res) => {
    const url = new URL(res.url());
    return url.pathname === "/api/entries" && res.request().method() === "GET" && res.ok();
  });
  await page.goto("/");
  const res = await listLoaded;
  const body = (await res.json()) as { total: number };
  // 初期描画は useState(0) なので、可視待ちだけだと GET 完了前の 0 を確定値にしてしまう
  await expect(page.getByTestId("total")).toHaveText(totalLabel(body.total));
  return { context, page };
}

async function join(page: Page, name: string) {
  await page.getByTestId("name-input").fill(name);
  await page.getByTestId("join-button").click();
}

async function waitJoinOutcome(page: Page) {
  await expect(page.getByTestId("my-position").or(page.getByTestId("form-error"))).toBeVisible({
    timeout: 20_000,
  });
}

test.describe.serial("AC1: 参加すると連番の整理券番号が表示され、同時参加でも重複しない", () => {
  test("直列3人と並行5人の番号が max+1 から過不足なく割り当てられる", async ({ browser, request }) => {
    test.setTimeout(90_000);
    const { max, total: startTotal } = await queueSnapshot(request);
    const opened: { context: Awaited<ReturnType<Browser["newContext"]>> }[] = [];

    try {
      const serialNames = ["たろう", "はなこ", "じろう"] as const;
      const serialPages: Page[] = [];
      for (let i = 0; i < serialNames.length; i++) {
        const session = await openSession(browser, clientIp(`ac1s${i}`));
        opened.push(session);
        serialPages.push(session.page);
        await join(session.page, serialNames[i]);
        const expected = max + i + 1;
        await expect(session.page.getByTestId("my-position")).toHaveText(
          `あなたの整理券番号は ${expected} 番です`,
        );
      }

      const lastSerial = serialPages[2]!;
      await expect(lastSerial.getByTestId("entry-row").last()).toHaveText(`${max + 3} 番 じろう`);
      const serialRows = await lastSerial.getByTestId("entry-row").allTextContents();
      expect(serialRows.slice(-3)).toEqual([
        `${max + 1} 番 たろう`,
        `${max + 2} 番 はなこ`,
        `${max + 3} 番 じろう`,
      ]);

      const parallel = await Promise.all(
        [0, 1, 2, 3, 4].map((i) => openSession(browser, clientIp(`ac1p${i}`))),
      );
      opened.push(...parallel);
      await Promise.all(parallel.map((s, i) => s.page.getByTestId("name-input").fill(`同時${i}`)));
      await Promise.all(parallel.map((s) => s.page.getByTestId("join-button").click()));
      await Promise.all(
        parallel.map((s) => expect(s.page.getByTestId("my-position")).toBeVisible({ timeout: 20_000 })),
      );

      const numbers = (
        await Promise.all(
          parallel.map(async (s) => parseTicket(await s.page.getByTestId("my-position").innerText())),
        )
      ).sort((a, b) => a - b);
      expect(numbers).toEqual([max + 4, max + 5, max + 6, max + 7, max + 8]);

      await parallel[0]!.page.reload();
      await expect(parallel[0]!.page.getByTestId("total")).toHaveText(totalLabel(startTotal + 8));
      await expect(parallel[0]!.page.getByTestId("entry-row")).toHaveCount(startTotal + 8);
    } finally {
      await Promise.all(opened.map((s) => s.context.close()));
    }
  });
});

test("AC2: 別セッションでも同じ順位一覧が見える", async ({ browser }) => {
  const a = await openSession(browser, clientIp("ac2a"));
  const before = await a.page.getByTestId("entry-row").count();
  await join(a.page, "共有太郎");
  await expect(a.page.getByTestId("entry-row")).toHaveCount(before + 1);
  await join(a.page, "共有花子");
  await expect(a.page.getByTestId("entry-row")).toHaveCount(before + 2);

  const rowsA = await a.page.getByTestId("entry-row").allTextContents();
  const totalA = await a.page.getByTestId("total").innerText();

  const b = await openSession(browser, clientIp("ac2b"));
  await expect(b.page.getByTestId("total")).toHaveText(totalA);
  const rowsB = await b.page.getByTestId("entry-row").allTextContents();
  const totalB = await b.page.getByTestId("total").innerText();

  expect(rowsB).toEqual(rowsA);
  expect(rowsA).toHaveLength(parseTotal(totalA));
  expect(rowsB).toHaveLength(parseTotal(totalB));
  await expect(b.page.getByTestId("my-position")).toHaveCount(0);

  await a.context.close();
  await b.context.close();
});

test("AC3: 名前だけで参加でき、空と 25 文字は拒否され 24 文字は通る", async ({ browser, request }) => {
  const { total: beforeTotal } = await queueSnapshot(request);
  const { context, page } = await openSession(browser, clientIp("ac3"));
  await expect(page.getByTestId("total")).toHaveText(totalLabel(beforeTotal));

  await expect(page.locator("form input")).toHaveCount(1);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.locator('input[type="email"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: /ログイン|signin|sign in|log in/i })).toHaveCount(0);
  expect(await page.evaluate(() => document.cookie)).toBe("");

  await join(page, "");
  await expect(page.getByTestId("form-error")).toHaveText("名前を入力してください");
  await expect(page.getByTestId("total")).toHaveText(totalLabel(beforeTotal));

  await join(page, "あ".repeat(25));
  await expect(page.getByTestId("form-error")).toHaveText("名前は 24 文字までです");
  await expect(page.getByTestId("total")).toHaveText(totalLabel(beforeTotal));

  const name24 = "あ".repeat(24);
  await join(page, name24);
  await expect(page.getByTestId("my-position")).toBeVisible();
  await expect(page.getByTestId("total")).toHaveText(totalLabel(beforeTotal + 1));
  await expect(page.getByTestId("entry-row").last()).toHaveText(new RegExp(`番 ${name24}$`));
  expect(await page.evaluate(() => document.cookie)).toBe("");

  await context.close();
});

test("AC4: 10 秒に 3 件まで許可し 4 件目を拒否、10 秒経過後に再開", async ({ browser, request }) => {
  test.setTimeout(60_000);
  const { total: beforeTotal } = await queueSnapshot(request);
  const { context, page } = await openSession(browser, clientIp("ac4seq"));
  await expect(page.getByTestId("total")).toHaveText(totalLabel(beforeTotal));

  for (let i = 1; i <= 3; i++) {
    await join(page, `逐次${i}`);
    await expect(page.getByTestId("my-position")).toBeVisible();
    await expect(page.getByTestId("total")).toHaveText(totalLabel(beforeTotal + i));
  }
  const thirdTicket = await page.getByTestId("my-position").innerText();

  await join(page, "逐次4");
  await expect(page.getByTestId("form-error")).toHaveText(
    "参加が集中しています。10 秒ほど待って再度お試しください",
  );
  await expect(page.getByTestId("total")).toHaveText(totalLabel(beforeTotal + 3));
  await expect(page.getByTestId("my-position")).toHaveText(thirdTicket);

  await page.waitForTimeout(10_500);
  await join(page, "逐次5");
  await expect(page.getByTestId("total")).toHaveText(totalLabel(beforeTotal + 4));
  await expect(page.getByTestId("my-position")).not.toHaveText(thirdTicket);

  await context.close();
});

test("AC4: 同一クライアントキーの 6 セッションが同時参加しても成功はちょうど 3 件", async ({
  browser,
  request,
}) => {
  test.setTimeout(90_000);
  const { total: beforeTotal } = await queueSnapshot(request);
  const observer = await openSession(browser, clientIp("ac4obs"));
  await expect(observer.page.getByTestId("total")).toHaveText(totalLabel(beforeTotal));
  await expect(observer.page.getByTestId("entry-row")).toHaveCount(beforeTotal);
  const sharedIp = clientIp("ac4par");
  const sessions = await Promise.all(
    [1, 2, 3, 4, 5, 6].map((n) => openSession(browser, sharedIp)),
  );

  try {
    await Promise.all(
      sessions.map((s, i) => s.page.getByTestId("name-input").fill(`並行${i + 1}`)),
    );
    await Promise.all(sessions.map((s) => s.page.getByTestId("join-button").click()));
    await Promise.all(sessions.map((s) => waitJoinOutcome(s.page)));

    const successes: { position: number; name: string }[] = [];
    let errorCount = 0;
    for (let i = 0; i < sessions.length; i++) {
      const page = sessions[i]!.page;
      const hasTicket = await page.getByTestId("my-position").isVisible();
      const hasError = await page.getByTestId("form-error").isVisible();
      if (hasTicket) {
        successes.push({
          position: parseTicket(await page.getByTestId("my-position").innerText()),
          name: `並行${i + 1}`,
        });
      }
      if (hasError) {
        await expect(page.getByTestId("form-error")).toHaveText(
          "参加が集中しています。10 秒ほど待って再度お試しください",
        );
        errorCount += 1;
      }
    }

    expect(successes).toHaveLength(3);
    expect(errorCount).toBe(3);
    expect(new Set(successes.map((s) => s.position)).size).toBe(3);

    await observer.page.reload();
    await expect(observer.page.getByTestId("total")).toHaveText(totalLabel(beforeTotal + 3));
    await expect(observer.page.getByTestId("entry-row")).toHaveCount(beforeTotal + 3);
    const rows = await observer.page.getByTestId("entry-row").allTextContents();
    for (const success of successes) {
      expect(rows).toContain(`${success.position} 番 ${success.name}`);
    }
  } finally {
    await Promise.all([observer.context.close(), ...sessions.map((s) => s.context.close())]);
  }
});

test("AC5: file:// でもタイトルとフッターが描画される", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const fileUrl = pathToFileURL(path.resolve("public/index.html")).href;
  await page.goto(fileUrl);
  await expect(page.locator("h1")).toHaveText("先着順ウェイトリスト");
  const footer = page.locator('a[href="https://apps.jozo.beer"]');
  await expect(footer).toHaveText("apps.jozo.beer");
  await expect(footer).toBeVisible();
  expect(errors).toEqual([]);
  await expect(page.getByTestId("list-error")).toHaveText("一覧を取得できませんでした");
});
