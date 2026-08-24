import { useEffect, useState } from "react";
import { Home } from "./Home";
import { Room } from "./Room";

type Route = { kind: "home" } | { kind: "room"; id: string };

function parseRoute(hash: string): Route {
  const match = hash.match(/^#\/r\/([^/?#]+)$/);
  return match ? { kind: "room", id: match[1] } : { kind: "home" };
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute(location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return (
    <main className="app">
      <h1>先着順ウェイトリスト</h1>
      {route.kind === "home" ? <Home /> : <Room key={route.id} roomId={route.id} />}
    </main>
  );
}
