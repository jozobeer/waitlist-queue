// 公開後も一生守る不変条件のチェック。保守エージェントは変更後に npm run verify を通すこと。
// public/ はビルド出力（正本は index.html と src/）。verify の前に npm run build が必要
import { readFileSync, readdirSync, statSync } from "node:fs";

const HUB_LINK_RE = /<a[^>]+href=["']https:\/\/apps\.jozo\.beer\/?["']/i;

const errors = [];

function requireFile(path, message) {
  try {
    statSync(path);
  } catch {
    errors.push(message);
  }
}

try {
  const html = readFileSync("public/index.html", "utf-8");
  if (!/<link[^>]+rel=["']?[^"'>]*icon/i.test(html)) {
    errors.push("faviconがありません（index.html の <head> に data URI で入れて npm run build）");
  }
  if (!HUB_LINK_RE.test(html)) {
    errors.push('apps.jozo.beer へのフッターリンクがありません（index.html に <a href="https://apps.jozo.beer">）');
  }
} catch {
  errors.push("public/index.html がありません（npm run build を実行すること）");
}

try {
  const external = readdirSync("public", { recursive: true })
    .map(String)
    .filter((f) => /\.(js|css)$/i.test(f));
  if (external.length > 0) {
    errors.push(
      `単一ファイル構成に違反しています（public/ に ${external.join(", ")}。vite-plugin-singlefile を外さないこと）`,
    );
  }
} catch {
  // public 自体の欠落は index.html チェックで報告済み
}

requireFile("src/worker/index.ts", "src/worker/index.ts がありません（/api/* の正本）");
requireFile("README.md", "README.md がありません（削除しないこと）");
requireFile("wrangler.jsonc", "wrangler.jsonc がありません");

if (errors.length > 0) {
  console.error("verify失敗:\n" + errors.map((e) => `- ${e}`).join("\n"));
  process.exit(1);
}
console.log("verify OK");
