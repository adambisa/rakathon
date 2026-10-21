import { z } from "zod";

import { EmailAddressSchema } from "#auth/email";

export const SignInSchema = z.strictObject({
  email: EmailAddressSchema,
  password: z.string().min(1),
});

export const SignUpSchema = SignInSchema.extend({
  name: z.string().trim().min(1),
  password: z.string().min(8).max(128),
});

export type Credentials = z.output<typeof SignInSchema>;
export type Registration = z.output<typeof SignUpSchema>;
