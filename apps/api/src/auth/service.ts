import { type TRPC_ERROR_CODE_KEY, TRPCError } from "@trpc/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { isAPIError } from "better-auth/api";
import { createAccessControl } from "better-auth/plugins/access";
import { admin } from "better-auth/plugins/admin";
import { adminAc, defaultStatements, userAc } from "better-auth/plugins/admin/access";
import { anonymous } from "better-auth/plugins/anonymous";
import { RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible";
import { z } from "zod";

import * as authSchema from "@prostapaper/db/auth-schema";
import { type Role, role as roleEnum } from "@prostapaper/db/auth-schema";

import { EmailAddressSchema } from "#auth/email";
import type { Credentials, Registration } from "#auth/validation";
import type { DatabaseService } from "#database/service";
import type { Env } from "#env";

const SessionSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.email(),
    displayEmail: z.email(),
    role: z.enum(roleEnum.enumValues),
    isAnonymous: z.boolean(),
  }),
});
export type Session = z.infer<typeof SessionSchema>;

export interface NewUser {
  email: string;
  name: string;
  role?: Role | undefined;
  password: string;
}

const SESSION_COOKIE = "prostapaper.session_token";

const access = createAccessControl(defaultStatements);

function createAuth(config: Env, database: DatabaseService) {
  return betterAuth({
    appName: "ProstaPaper",
    secret: config.BETTER_AUTH_SECRET,
    baseURL: config.BETTER_AUTH_URL,
    basePath: "/api/auth",
    database: drizzleAdapter(database.db, { provider: "pg", schema: authSchema }),
    emailAndPassword: { enabled: true, autoSignIn: true, minPasswordLength: 8, maxPasswordLength: 128 },
    user: {
      additionalFields: { displayEmail: { type: "string", required: true } },
    },
    plugins: [
      admin({
        ac: access,
        roles: {
          reviewer: access.newRole(userAc.statements),
          admin: access.newRole(adminAc.statements),
        },
        defaultRole: "reviewer",
        adminRoles: ["admin"],
      }),
      anonymous({ generateName: () => "Host" }),
    ],
    advanced: {
      cookiePrefix: "prostapaper",
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },
  });
}

export class AuthService {
  private readonly auth: ReturnType<typeof createAuth>;
  private readonly origin: string;
  private readonly limits = new Map([
    ["auth.signUp", new RateLimiterMemory({ points: 5, duration: 60 })],
    ["auth.signIn", new RateLimiterMemory({ points: 30, duration: 60 })],
    ["auth.signInAsGuest", new RateLimiterMemory({ points: 5, duration: 60 })],
  ]);

  constructor(
    config: Env,
    private readonly database: DatabaseService,
  ) {
    this.auth = createAuth(config, database);
    this.origin = new URL(config.BETTER_AUTH_URL).origin;
  }

  async authorizeRequest(path: string, headers: Headers): Promise<void> {
    if (headers.get("origin") !== this.origin) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Invalid origin" });
    }

    const limiter = this.limits.get(path);
    if (limiter === undefined) {
      return;
    }

    const ip = headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ?? "unknown";
    try {
      await limiter.consume(ip);
    } catch (error) {
      if (error instanceof RateLimiterRes) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "TOO_MANY_REQUESTS" });
      }
      throw error;
    }
  }

  private async respond<T>(
    operation: Promise<{ headers: Headers; response: T }>,
    responseHeaders: Headers,
  ): Promise<T> {
    try {
      const result = await operation;
      for (const cookie of result.headers.getSetCookie()) {
        responseHeaders.append("set-cookie", cookie);
      }

      return result.response;
    } catch (error) {
      if (isAPIError(error)) {
        const codes = new Map<number, TRPC_ERROR_CODE_KEY>([
          [400, "BAD_REQUEST"],
          [401, "UNAUTHORIZED"],
          [403, "FORBIDDEN"],
          [422, "CONFLICT"],
          [429, "TOO_MANY_REQUESTS"],
        ]);
        throw new TRPCError({
          code: codes.get(error.statusCode) ?? "INTERNAL_SERVER_ERROR",
          message: error.body?.code ?? error.message,
          cause: error,
        });
      }
      throw error;
    }
  }

  async signUp(input: Registration, headers: Headers, responseHeaders: Headers): Promise<Session> {
    const result = await this.respond(
      this.auth.api.signUpEmail({
        body: {
          email: input.email.canonical,
          displayEmail: input.email.display,
          name: input.name,
          password: input.password,
        },
        headers,
        returnHeaders: true,
      }),
      responseHeaders,
    );

    return SessionSchema.parse(result);
  }

  async signIn(input: Credentials, headers: Headers, responseHeaders: Headers): Promise<Session> {
    const result = await this.respond(
      this.auth.api.signInEmail({
        body: { email: input.email.canonical, password: input.password },
        headers,
        returnHeaders: true,
      }),
      responseHeaders,
    );

    return SessionSchema.parse(result);
  }

  async signInAsGuest(headers: Headers, responseHeaders: Headers): Promise<Session> {
    const result = await this.respond(
      this.auth.api.signInAnonymous({ headers, returnHeaders: true }),
      responseHeaders,
    );

    return SessionSchema.parse(result);
  }

  async signOut(headers: Headers, responseHeaders: Headers): Promise<void> {
    await this.respond(this.auth.api.signOut({ headers, returnHeaders: true }), responseHeaders);
  }

  async resolveSession(headers: Headers, responseHeaders: Headers): Promise<Session | null> {
    const { response: resolved, headers: sessionHeaders } = await this.auth.api.getSession({
      headers,
      returnHeaders: true,
    });
    for (const cookie of sessionHeaders.getSetCookie()) {
      responseHeaders.append("set-cookie", cookie);
    }
    if (resolved === null) {
      if (headers.get("cookie")?.includes(SESSION_COOKIE) === true) {
        await this.database.check();
      }

      return null;
    }

    return SessionSchema.parse(resolved);
  }

  async createUser({ email, name, password, role }: NewUser): Promise<void> {
    const address = await EmailAddressSchema.parseAsync(email);
    await this.auth.api.createUser({
      body: { email: address.canonical, name, password, role, data: { displayEmail: address.display } },
    });
  }
}
