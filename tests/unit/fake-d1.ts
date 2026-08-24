type SqlFirst = (sql: string, bound: unknown[]) => unknown | null;
type SqlAll = (sql: string, bound: unknown[]) => unknown[];

export type FakeOptions = {
  first?: SqlFirst | object | null;
  all?: SqlAll | unknown[];
};

export function fakeDb(options: FakeOptions = {}) {
  const prepared: { sql: string; bound: unknown[] }[] = [];
  return {
    prepared,
    prepare(sql: string) {
      const rec = { sql, bound: [] as unknown[] };
      prepared.push(rec);
      const stmt = {
        bind(...values: unknown[]) {
          rec.bound = values;
          return stmt;
        },
        async first() {
          const handler = options.first;
          if (typeof handler === "function") return handler(sql, rec.bound);
          return "first" in options ? handler : null;
        },
        async all() {
          const handler = options.all;
          if (typeof handler === "function") return { results: handler(sql, rec.bound) };
          return { results: options.all ?? [] };
        },
        async run() {
          return {};
        },
      };
      return stmt;
    },
  };
}

export function throwsOnPrepare() {
  return {
    prepared: [] as { sql: string; bound: unknown[] }[],
    prepare(): never {
      throw new Error("prepare should not be called");
    },
  };
}
