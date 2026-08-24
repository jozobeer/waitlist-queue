import { expect, test, type Browser, type Page } from "@playwright/test";
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

function collectWebApplications(data: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    const type = rec["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (types.includes("WebApplication")) out.push(rec);
    if (rec["@graph"]) visit(rec["@graph"]);
  };
  visit(data);
  return out;
}

function totalLabel(n: number): string {
  return `現在 ${n} 人が参加中`;
}

async function createRoom(page: Page, name: string) {
  await page.goto("/");
  await page.getByTestId("room-name-input").fill(name);
  await page.getByTestId("create").click();
  await expect(page).toHaveURL(/#\/r\/[0-9a-f]{8}$/);
}

async function openSession(browser: Browser, ip: string, url?: string) {
  const context = await browser.newContext({
    extraHTTPHeaders: { "CF-Connecting-IP": ip },
  });
  const page = await context.newPage();
  if (url) {
    await page.goto(url);
    await expect(page.getByTestId("room-name")).toBeVisible();
  } else {
    await page.goto("/");
  }
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

test("AC1: ルートには受付名フォームだけがあり参加ボタンと一覧は無い", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("room-name-input")).toBeVisible();
  await expect(page.getByTestId("create")).toBeVisible();
  await expect(page.getByTestId("join-button")).toHaveCount(0);
  await expect(page.getByTestId("entry-row")).toHaveCount(0);
  await expect(page.getByTestId("total")).toHaveCount(0);
});

test("AC2: 受付を作ると共有URLに遷移し、コピーするとクリップボードがそのURLと一致する", async ({
  browser,
}) => {
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  await createRoom(page, "窓口A");
  const id = page.url().match(/#\/r\/([0-9a-f]{8})$/)![1];
  await expect(page.getByTestId("room-name")).toHaveText("窓口A");
  const origin = new URL(page.url()).origin;
  const shareUrl = `${origin}/#/r/${id}`;
  await expect(page.getByTestId("share-url")).toHaveText(shareUrl);
  await page.getByTestId("copy").click();
  await expect(page.getByTestId("copied")).toHaveText("コピーしました");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shareUrl);
  await context.close();
});

test("AC3: 共有URLを別セッションで開くと同じ受付名と同じ順位一覧が見える", async ({ browser }) => {
  const a = await openSession(browser, clientIp("ac3a"));
  await createRoom(a.page, "本窓口");
  await join(a.page, "共有太郎");
  await expect(a.page.getByTestId("entry-row")).toHaveCount(1);
  const rowsA = await a.page.getByTestId("entry-row").allTextContents();
  const totalA = await a.page.getByTestId("total").innerText();
  const nameA = await a.page.getByTestId("room-name").innerText();
  const urlA = a.page.url();

  const b = await openSession(browser, clientIp("ac3b"), urlA);
  await expect(b.page.getByTestId("room-name")).toHaveText(nameA);
  await expect(b.page.getByTestId("total")).toHaveText(totalA);
  const rowsB = await b.page.getByTestId("entry-row").allTextContents();
  expect(rowsB).toEqual(rowsA);

  await a.context.close();
  await b.context.close();
});

test("AC4: ひとつの受付に3人が同時参加すると番号が重複なく 1・2・3 になる", async ({ browser }) => {
  test.setTimeout(90_000);
  const decoy = await openSession(browser, clientIp("ac4decoy"));
  await createRoom(decoy.page, "別受付");
  await join(decoy.page, "先行");
  await expect(decoy.page.getByTestId("my-position")).toHaveText("あなたの整理券番号は 1 番です");

  const host = await openSession(browser, clientIp("ac4host"));
  await createRoom(host.page, "対象受付");
  const roomUrl = host.page.url();
  await expect(host.page.getByTestId("total")).toHaveText(totalLabel(0));

  const parallel = await Promise.all(
    [0, 1, 2].map((i) => openSession(browser, clientIp(`ac4p${i}`), roomUrl)),
  );

  try {
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
    expect(numbers).toEqual([1, 2, 3]);

    await host.page.reload();
    await expect(host.page.getByTestId("entry-row")).toHaveCount(3);
    const rows = await host.page.getByTestId("entry-row").allTextContents();
    expect(rows.map((row) => row.replace(/ 番.*/, " 番"))).toEqual(["1 番", "2 番", "3 番"]);
    expect(rows.map((row) => row.replace(/^\d+ 番 /, "")).sort()).toEqual(["同時0", "同時1", "同時2"]);
  } finally {
    await Promise.all([
      decoy.context.close(),
      host.context.close(),
      ...parallel.map((s) => s.context.close()),
    ]);
  }
});

test("AC5: 別々に作った2つの受付は互いに影響しない", async ({ browser }) => {
  const x = await openSession(browser, clientIp("ac5x"));
  await createRoom(x.page, "受付X");
  await join(x.page, "エックス");
  await expect(x.page.getByTestId("total")).toHaveText(totalLabel(1));
  const rowsX = await x.page.getByTestId("entry-row").allTextContents();

  const y = await openSession(browser, clientIp("ac5y"));
  await createRoom(y.page, "受付Y");
  await expect(y.page.getByTestId("total")).toHaveText(totalLabel(0));
  await join(y.page, "ワイ");
  await expect(y.page.getByTestId("total")).toHaveText(totalLabel(1));

  await x.page.reload();
  await expect(x.page.getByTestId("total")).toHaveText(totalLabel(1));
  expect(await x.page.getByTestId("entry-row").allTextContents()).toEqual(rowsX);

  await x.context.close();
  await y.context.close();
});

test("AC6: 存在しないIDは見つからない旨を出し参加ボタンを出さない", async ({ page }) => {
  await page.goto("/#/r/00000000");
  await expect(page.getByTestId("not-found")).toBeVisible();
  await expect(page.getByTestId("join-button")).toHaveCount(0);
  await expect(page.getByTestId("entry-row")).toHaveCount(0);
});

test("名前だけで参加でき、空と 25 文字は拒否され 24 文字は通る", async ({ browser }) => {
  const { context, page } = await openSession(browser, clientIp("name"));
  await createRoom(page, "検証窓口");
  await expect(page.getByTestId("total")).toHaveText(totalLabel(0));

  await expect(page.locator("form input")).toHaveCount(1);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.locator('input[type="email"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: /ログイン|signin|sign in|log in/i })).toHaveCount(0);
  expect(await page.evaluate(() => document.cookie)).toBe("");

  await join(page, "");
  await expect(page.getByTestId("form-error")).toHaveText("名前を入力してください");
  await expect(page.getByTestId("total")).toHaveText(totalLabel(0));

  await join(page, "あ".repeat(25));
  await expect(page.getByTestId("form-error")).toHaveText("名前は 24 文字までです");
  await expect(page.getByTestId("total")).toHaveText(totalLabel(0));

  const name24 = "あ".repeat(24);
  await join(page, name24);
  await expect(page.getByTestId("my-position")).toBeVisible();
  await expect(page.getByTestId("total")).toHaveText(totalLabel(1));
  await expect(page.getByTestId("entry-row").last()).toHaveText(new RegExp(`番 ${name24}$`));
  expect(await page.evaluate(() => document.cookie)).toBe("");

  await context.close();
});

test("10 秒に 3 件まで許可し 4 件目を拒否、10 秒経過後に再開", async ({ browser }) => {
  test.setTimeout(60_000);
  const { context, page } = await openSession(browser, clientIp("rlseq"));
  await createRoom(page, "レート窓口");
  await expect(page.getByTestId("total")).toHaveText(totalLabel(0));

  for (let i = 1; i <= 3; i++) {
    await join(page, `逐次${i}`);
    await expect(page.getByTestId("my-position")).toBeVisible();
    await expect(page.getByTestId("total")).toHaveText(totalLabel(i));
  }
  const thirdTicket = await page.getByTestId("my-position").innerText();

  await join(page, "逐次4");
  await expect(page.getByTestId("form-error")).toHaveText(
    "参加が集中しています。10 秒ほど待って再度お試しください",
  );
  await expect(page.getByTestId("total")).toHaveText(totalLabel(3));
  await expect(page.getByTestId("my-position")).toHaveText(thirdTicket);

  await page.waitForTimeout(10_500);
  await join(page, "逐次5");
  await expect(page.getByTestId("total")).toHaveText(totalLabel(4));
  await expect(page.getByTestId("my-position")).not.toHaveText(thirdTicket);

  await context.close();
});

test("同一クライアントキーの 6 セッションが同時参加しても成功はちょうど 3 件", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const host = await openSession(browser, clientIp("rlhost"));
  await createRoom(host.page, "並行窓口");
  const roomUrl = host.page.url();
  await expect(host.page.getByTestId("total")).toHaveText(totalLabel(0));

  const sharedIp = clientIp("rlpar");
  const sessions = await Promise.all(
    [1, 2, 3, 4, 5, 6].map((n) => openSession(browser, sharedIp, roomUrl)),
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

    await host.page.reload();
    await expect(host.page.getByTestId("total")).toHaveText(totalLabel(3));
    await expect(host.page.getByTestId("entry-row")).toHaveCount(3);
    const rows = await host.page.getByTestId("entry-row").allTextContents();
    for (const success of successes) {
      expect(rows).toContain(`${success.position} 番 ${success.name}`);
    }
  } finally {
    await Promise.all([host.context.close(), ...sessions.map((s) => s.context.close())]);
  }
});

test.describe("SEO基礎", () => {
  test("meta description があり content が空でない", async ({ page }) => {
    await page.goto("/");
    const meta = page.locator('meta[name="description"]');
    await expect(meta).toHaveCount(1);
    await expect(meta).toHaveAttribute("content", /\S/);
  });

  test("JSON-LD の WebApplication に必須フィールドがある", async ({ page }) => {
    await page.goto("/");
    const texts = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(texts.length).toBeGreaterThan(0);
    const apps = texts.flatMap((text) => collectWebApplications(JSON.parse(text)));
    expect(apps.length).toBeGreaterThan(0);
    const app = apps[0]!;
    expect(typeof app.name).toBe("string");
    expect(String(app.name).trim()).not.toBe("");
    expect(typeof app.description).toBe("string");
    expect(String(app.description).trim()).not.toBe("");
    expect(typeof app.url).toBe("string");
    expect(String(app.url).trim()).not.toBe("");
    expect(typeof app.applicationCategory).toBe("string");
    expect(String(app.applicationCategory).trim()).not.toBe("");
    const offers = app.offers as { price?: unknown } | undefined;
    expect(String(offers?.price)).toBe("0");
  });

  test("使い方と FAQ の見出しが初期表示にある", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "使い方" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "FAQ" })).toBeVisible();
  });
});

test("file:// でもタイトルとフッターが描画される", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const fileUrl = pathToFileURL(path.resolve("public/index.html")).href;
  await page.goto(fileUrl);
  await expect(page.locator("h1")).toHaveText("先着順ウェイトリスト");
  const footer = page.locator('a[href="https://apps.jozo.beer"]');
  await expect(footer).toHaveText("apps.jozo.beer");
  await expect(footer).toBeVisible();
  expect(errors).toEqual([]);
});
