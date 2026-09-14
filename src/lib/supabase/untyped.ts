/**
 * supabase-js 2.108 types untyped tables as `never`. This is a query-builder
 * stand-in, not a generated Database schema: mutations accept objects, and
 * rows are indexable so `.map` / `.find` callbacks are not implicit `any`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- this module is the untyped query-builder stand-in */
type LooseRow = { [key: string]: any };
type LooseResult<T> = { data: T; error: any; count?: number | null };

export type LooseQuery = PromiseLike<LooseResult<LooseRow[]>> & {
  select: (...args: any[]) => LooseQuery;
  insert: (values?: any, options?: any) => LooseQuery;
  update: (values?: any, options?: any) => LooseQuery;
  upsert: (values?: any, options?: any) => LooseQuery;
  delete: (...args: any[]) => LooseQuery;
  eq: (...args: any[]) => LooseQuery;
  neq: (...args: any[]) => LooseQuery;
  gt: (...args: any[]) => LooseQuery;
  gte: (...args: any[]) => LooseQuery;
  lt: (...args: any[]) => LooseQuery;
  lte: (...args: any[]) => LooseQuery;
  like: (...args: any[]) => LooseQuery;
  ilike: (...args: any[]) => LooseQuery;
  is: (...args: any[]) => LooseQuery;
  in: (...args: any[]) => LooseQuery;
  contains: (...args: any[]) => LooseQuery;
  containedBy: (...args: any[]) => LooseQuery;
  overlaps: (...args: any[]) => LooseQuery;
  match: (...args: any[]) => LooseQuery;
  not: (...args: any[]) => LooseQuery;
  or: (...args: any[]) => LooseQuery;
  filter: (...args: any[]) => LooseQuery;
  order: (...args: any[]) => LooseQuery;
  limit: (...args: any[]) => LooseQuery;
  range: (...args: any[]) => LooseQuery;
  abortSignal: (...args: any[]) => LooseQuery;
  single: () => PromiseLike<LooseResult<LooseRow>>;
  maybeSingle: () => PromiseLike<LooseResult<LooseRow | null>>;
};

export type UntypedQueryClient<T> = Omit<T, "from" | "rpc" | "schema"> & {
  from: (relation: string) => LooseQuery;
  rpc: (...args: any[]) => PromiseLike<LooseResult<any>>;
  schema: (schema: string) => any;
};

export function asUntypedClient<T extends object>(client: T): UntypedQueryClient<T> {
  return client as UntypedQueryClient<T>;
}
