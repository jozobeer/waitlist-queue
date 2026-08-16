import { useEffect, useState } from "react";

export function App() {
  const [health, setHealth] = useState<"ok" | "ng" | "checking">("checking");
  useEffect(() => {
    fetch("/api/health")
      .then((r) => setHealth(r.ok ? "ok" : "ng"))
      .catch(() => setHealth("ng")); // file:// や API 停止でも UI 骨格は描画し続ける
  }, []);
  return (
    <main style={{ fontFamily: "sans-serif", margin: "2rem" }}>
      <h1>{"先着順ウェイトリスト"}</h1>
      <p>{"builder がこのファイルを実装で置き換えます"}</p>
      <p>API: {health}</p>
    </main>
  );
}
