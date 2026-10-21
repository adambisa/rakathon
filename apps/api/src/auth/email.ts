import normalizeEmail from "validator/lib/normalizeEmail.js";
import { z } from "zod";

export const EmailAddressSchema = z
  .email()
  .transform((display, ctx) => {
    const canonical = normalizeEmail(display);
    if (canonical === false) {
      ctx.addIssue({ code: "custom", message: "Invalid email" });

      return z.NEVER;
    }

    return { canonical, display };
  })
  .pipe(z.object({ canonical: z.email(), display: z.email() }));
