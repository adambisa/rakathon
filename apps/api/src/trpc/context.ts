import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { Context as HonoContext } from "hono";
import type { RequestIdVariables } from "hono/request-id";

import type { AuthService, Session } from "#auth/service";
import type { CaseService } from "#cases/service";
import type { DatabaseService } from "#database/service";
import type { DocumentService } from "#documents/service";
import type { ReviewService } from "#review/service";

export interface AppEnv {
  Variables: RequestIdVariables;
}

export interface AppServices {
  database: DatabaseService;
  auth: AuthService;
  cases: CaseService;
  documents: DocumentService;
  reviews: ReviewService;
}

export interface TrpcContext extends Record<string, unknown> {
  auth: AuthService;
  cases: CaseService;
  documents: DocumentService;
  reviews: ReviewService;
  session: Session | null;
  request: Request;
  responseHeaders: Headers;
}

export function createContextFactory({
  auth,
  cases,
  documents,
  reviews,
}: AppServices): (opts: FetchCreateContextFnOptions, c: HonoContext<AppEnv>) => Promise<TrpcContext> {
  return async (opts, c) => ({
    auth,
    request: opts.req,
    responseHeaders: opts.resHeaders,
    cases,
    documents,
    reviews,
    session: await auth.resolveSession(c.req.raw.headers, opts.resHeaders),
  });
}
