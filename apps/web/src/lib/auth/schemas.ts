import { z } from 'zod';

/**
 * Validation schemas, built from translated messages.
 *
 * They are factories rather than module constants because the error text has to
 * come from the active locale. Defining them once at import time would hardcode
 * whichever language loaded first.
 */
export interface AuthValidationMessages {
  fullNameMin: string;
  emailInvalid: string;
  passwordMin: string;
  passwordWeak: string;
  passwordMismatch: string;
}

export function loginSchema(m: AuthValidationMessages) {
  return z.object({
    email: z.string().min(1, m.emailInvalid).email(m.emailInvalid),
    // No strength rules on login: the password either matches what is stored or
    // it does not, and lecturing someone about complexity while they sign in
    // just leaks that their existing password would fail today's policy.
    password: z.string().min(1, m.passwordMin),
  });
}

export function signupSchema(m: AuthValidationMessages) {
  return z
    .object({
      fullName: z.string().trim().min(2, m.fullNameMin).max(200),
      email: z.string().min(1, m.emailInvalid).email(m.emailInvalid),
      password: z
        .string()
        .min(8, m.passwordMin)
        // One letter and one digit. Deliberately mild: length dominates entropy,
        // and aggressive symbol rules push people toward predictable patterns.
        .regex(/[A-Za-z]/, m.passwordWeak)
        .regex(/[0-9]/, m.passwordWeak),
      confirmPassword: z.string(),
    })
    .refine((v) => v.password === v.confirmPassword, {
      message: m.passwordMismatch,
      path: ['confirmPassword'],
    });
}

export type LoginValues = z.infer<ReturnType<typeof loginSchema>>;
export type SignupValues = z.infer<ReturnType<typeof signupSchema>>;
