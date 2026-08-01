import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import type { Express } from "express";
import session from "express-session";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { eq } from "drizzle-orm";
import { storage } from "./storage";
import type { Request, Response, NextFunction } from "express";
import {
  applyStateChangingCsrfProtection,
  clearLoginRateLimit,
  detectSuspiciousActivity,
  issueCsrfToken,
  loginRateLimiter,
  registerRateLimiter,
  emailVerificationRateLimiter,
  passwordResetRateLimiter,
} from "./services/security-service";
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  send2FASetupEmail,
  sendSuspiciousActivityEmail,
} from "./services/email-service";
import {
  verifyToken,
  generateSetupResponse
} from "./services/two-factor-service";
import { sendError, sendOk } from "./api-response";
import { organizationContextMiddleware } from "./middleware/organization-context";
import { getOptionalTenantContext } from "./organization-context";
import { db } from "./db";
import { appEnv } from "./config/env";
import { logger } from "./lib/logger";

import {
  organizationMembers,
  organizations,
  organizationSettings,
  userRegistrationSchema,
  type User as SchemaUser,
} from "@shared/schema";
import { getCountryPack } from "./modules/master-data/country-pack-registry";
declare global {
  namespace Express {
    interface User extends Omit<SchemaUser, 'password'> {}
  }
}

// Create promisified version of scrypt
const scryptAsync = promisify(scrypt);

// Hash a password with a salt
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buffer = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buffer.toString("hex")}.${salt}`;
}

// Compare a supplied password to a stored hashed password
async function comparePasswords(supplied: string, stored: string): Promise<boolean> {
  const [hashed, salt] = stored.split(".");
  const hashedBuffer = Buffer.from(hashed, "hex");
  const suppliedBuffer = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuffer, suppliedBuffer);
}

function validatePasswordPolicy(password: string): string | null {
  if (typeof password !== "string" || password.length < 10) {
    return "Password must be at least 10 characters long";
  }
  if (!/[A-Z]/.test(password)) {
    return "Password must include at least one uppercase letter";
  }
  if (!/[a-z]/.test(password)) {
    return "Password must include at least one lowercase letter";
  }
  if (!/[0-9]/.test(password)) {
    return "Password must include at least one number";
  }
  if (!/[!@#$%^&*()[\]{}\-_=+\\|;:'\",.<>/?`~]/.test(password)) {
    return "Password must include at least one special character";
  }
  return null;
}

// Middleware to check if the user is authenticated
function ensureAuthenticated(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) {
    return next();
  }
  return sendError(res, 401, "UNAUTHORIZED", "Unauthorized", {
    hint: "Log in again to continue.",
    details: { functionName: "ensureAuthenticated" },
  });
}

// Middleware to check if the user has admin role
function ensureAdmin(req: Request, res: Response, next: NextFunction) {
  const activeRole = getOptionalTenantContext()?.userRole ?? req.user?.role;
  if (req.isAuthenticated() && req.user && activeRole === "admin") {
    return next();
  }
  return sendError(res, 403, "FORBIDDEN_ADMIN_REQUIRED", "Forbidden: Admin access required", {
    details: { functionName: "ensureAdmin" },
  });
}

// Middleware to check if user has a specific role
function ensureRole(role: string | string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated() || !req.user) {
      return sendError(res, 401, "UNAUTHORIZED", "Unauthorized", {
        details: { functionName: "ensureRole" },
      });
    }

    const roles = Array.isArray(role) ? role : [role];
    const activeRole = getOptionalTenantContext()?.userRole ?? req.user.role;
    
    if (typeof activeRole === "string" && roles.includes(activeRole)) {
      return next();
    }
    
    return sendError(
      res,
      403,
      "FORBIDDEN_ROLE_REQUIRED",
      `Forbidden: Required role not found. Need one of: ${roles.join(", ")}`,
      {
        hint: "Ask an organization administrator to assign an authorized role for this action.",
        details: { requiredRoles: roles, currentRole: req.user.role, functionName: "ensureRole" },
      },
    );
  };
}

// Middleware to check if user has specific permission on a resource
function ensurePermission(resource: string, permissionType: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated() || !req.user) {
      return sendError(res, 401, "UNAUTHORIZED", "Unauthorized", {
        details: { functionName: "ensurePermission" },
      });
    }

    const userRole = getOptionalTenantContext()?.userRole ?? req.user.role;
    
    // Admin always has all permissions
    if (userRole === "admin") {
      return next();
    }
    
    try {
      // Check if user has the required permission
      const hasPermission = await storage.checkPermission(
        userRole as any, 
        resource as any, 
        permissionType as any
      );
      
      if (hasPermission) {
        return next();
      }
      
      // If user has a custom role, check that too
      if (userRole === "custom" && req.user.id) {
        // Look up the custom role permissions
        const customRoleId = await storage.getUserCustomRoleId(req.user.id);
        
        if (customRoleId) {
          const hasCustomPermission = await storage.checkCustomRolePermission(
            customRoleId,
            resource as any,
            permissionType as any
          );
          
          if (hasCustomPermission) {
            return next();
          }
        }
      }
      
      return sendError(
        res,
        403,
        "FORBIDDEN_PERMISSION_REQUIRED",
        `Forbidden: You don't have ${permissionType} permission for ${resource}`,
        {
          hint: `Ask an organization administrator for ${resource}:${permissionType} access if this action is part of your role.`,
          details: { resource, permissionType, functionName: "ensurePermission" },
        },
      );
    } catch (error) {
      console.error("Permission check error:", error);
      return sendError(res, 500, "PERMISSION_CHECK_ERROR", "Error checking permissions", {
        details: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

// Middleware to check if 2FA is required
function ensureTwoFactorAuthenticated(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated() || !req.user) {
    return sendError(res, 401, "UNAUTHORIZED", "Unauthorized", {
      details: { functionName: "ensureTwoFactorAuthenticated" },
    });
  }
  
  // Skip 2FA check if not enabled for this user
  if (!req.user.twoFactorEnabled) {
    return next();
  }
  
  // Check if the 2FA session flag is set
  if (req.session.twoFactorAuthenticated) {
    return next();
  }
  
  // 2FA is required
  return res.status(403).json({
    ok: false,
    error: {
      code: "TWO_FACTOR_REQUIRED",
      message: "Two-factor authentication required",
      details: { requiresTwoFactor: true, functionName: "ensureTwoFactorAuthenticated" },
      requestId:
        (res.locals?.requestId as string | undefined) ??
        (res.getHeader("X-Request-Id") as string | undefined) ??
        "unknown-request-id",
    },
  });
}

const SENSITIVE_ADMIN_UPDATE_KEYS = new Set([
  "password",
  "twoFactorSecret",
  "passwordResetToken",
  "passwordResetExpires",
  "session",
  "token",
  "apiKey",
  "secret",
]);

function redactAuditDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAuditDetails);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_ADMIN_UPDATE_KEYS.has(key) || /password|secret|token|api[-_]?key|session/i.test(key)
      ? "[REDACTED]"
      : redactAuditDetails(entry);
  }
  return out;
}

async function getEffectivePermissions(user: Express.User): Promise<Array<{ resource: string; permissionType: string }>> {
  const activeRole = getOptionalTenantContext()?.userRole ?? user.role;
  if (activeRole === "admin") {
    const all = await storage.getAllPermissions();
    return all.map(({ resource, permissionType }) => ({ resource, permissionType }));
  }

  const rolePermissions = await storage.getRolePermissions(activeRole as any);
  const effective = rolePermissions.map(({ resource, permissionType }) => ({ resource, permissionType }));
  if (activeRole === "custom") {
    const customRoleId = await storage.getUserCustomRoleId(user.id);
    if (customRoleId) {
      const custom = await storage.getCustomRolePermissions(customRoleId);
      effective.push(...custom.map(({ resource, permissionType }) => ({ resource, permissionType })));
    }
  }
  const unique = new Map(effective.map((permission) => [`${permission.resource}:${permission.permissionType}`, permission]));
  return [...unique.values()];
}

/**
 * GitHub Codespaces (and similar) terminate TLS at the edge; Node sees HTTP unless we trust
 * X-Forwarded-Proto. Set both `app.set("trust proxy")` and express-session's `proxy` option so
 * `secure: "auto"` and Set-Cookie logic agree with the browser URL (session + CSRF share the session).
 */
function shouldTrustProxy(): boolean {
  return appEnv.trustProxy;
}

// Set up authentication
export function setupAuth(app: Express) {
  if (shouldTrustProxy()) {
    app.set("trust proxy", 1);
  }

  // Configure session
  const sessionSettings: session.SessionOptions = {
    secret: appEnv.sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: storage.sessionStore,
    // Read X-Forwarded-Proto directly (not only req.secure) so HTTPS Codespaces URLs match cookie Secure flags.
    proxy: shouldTrustProxy(),
    cookie: {
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      // Match connection security; requires trust proxy when behind HTTPS reverse proxy (Codespaces).
      secure: "auto",
      httpOnly: true,
      sameSite: "lax",
    },
  };

  // Set up session middleware
  app.use(session(sessionSettings));
  
  // Initialize Passport and restore authentication state from session
  app.use(passport.initialize());
  app.use(passport.session());
  app.use(organizationContextMiddleware);
  app.get("/api/csrf-token", issueCsrfToken);
  app.use(applyStateChangingCsrfProtection);

  // Configure local strategy with options to pass request object
  passport.use(new LocalStrategy({
    passReqToCallback: true // This passes the request object to the callback
  }, async (req, username, password, done) => {
    try {
      // Find the user
      const user = await storage.getUserByUsername(username);
      
      // If user doesn't exist or password doesn't match
      if (!user || !(await comparePasswords(password, user.password))) {
        // Record failed login attempt
        if (user) {
          await storage.recordLoginAttempt(username, false);
          
          // Check if account should be locked
          const failedAttempts = await storage.getFailedLoginAttempts(user.id, 24);
          if (failedAttempts.length >= 5) {
            // Lock the account by setting lockoutUntil to 30 minutes in the future
            const lockoutUntil = new Date();
            lockoutUntil.setMinutes(lockoutUntil.getMinutes() + 30);
            
            await storage.updateUser(user.id, { 
              accountLocked: true,
              lockoutUntil
            });
          }
        }
        
        return done(null, false, { message: "Invalid username or password" });
      }
      
      // Check if account is locked
      if (user.accountLocked) {
        if (user.lockoutUntil && new Date() < new Date(user.lockoutUntil)) {
          return done(null, false, { message: "Account is locked. Please try again later or reset your password." });
        } else {
          // Unlock the account if the lockout period has expired
          await storage.updateUser(user.id, { 
            accountLocked: false,
            lockoutUntil: null,
            failedLoginAttempts: 0
          });
        }
      }

      // Optional password max age (set PASSWORD_MAX_AGE_DAYS in production)
      const maxAgeDays = Number(process.env.PASSWORD_MAX_AGE_DAYS || 0);
      if (maxAgeDays > 0 && user.lastPasswordChange) {
        const changed = new Date(user.lastPasswordChange).getTime();
        const maxMs = maxAgeDays * 86400000;
        if (Number.isFinite(changed) && Date.now() - changed > maxMs) {
          return done(null, false, {
            message:
              "[PASSWORD_EXPIRED] Your password has expired. Use “Forgot password” to set a new one, or ask an administrator to reset your account.",
          });
        }
      }
      
      if (!appEnv.allowUnverifiedEmailLogin && !user.emailVerified) {
        return done(null, false, {
          message: "Please verify your email address before logging in",
          requiresEmailVerification: true,
        } as { message: string; requiresEmailVerification: boolean });
      }

      // Record successful login attempt
      await storage.recordLoginAttempt(username, true);
      
      // Reset failed login attempts
      await storage.resetFailedLoginAttempts(user.id);
      
      // Update last login time
      await storage.updateUser(user.id, { 
        lastLogin: new Date() 
      });

      if (appEnv.suspiciousLoginAlertsEnabled) {
        const ip = typeof req.ip === "string" ? req.ip : "unknown";
        const userAgent = String(req.headers["user-agent"] || "unknown");
        const isSuspicious = await detectSuspiciousActivity(user.id, ip, userAgent);
        if (isSuspicious) {
          sendSuspiciousActivityEmail(user.email, user.username, ip, new Date(), userAgent).catch((err) => {
            console.error("Error sending suspicious activity email:", err);
          });
        }
      }

      // User found and password matches
      return done(null, user);
    } catch (error) {
      return done(error);
    }
  }));

  // Serialize user object into session
  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  // Deserialize user from session
  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUser(id);
      done(null, user);
    } catch (error) {
      done(error);
    }
  });

  // Route to handle logout
  app.post("/api/logout", (req, res, next) => {
    // Clear the 2FA session flag if it exists
    if (req.session.twoFactorAuthenticated) {
      delete req.session.twoFactorAuthenticated;
    }
    
    req.logout((err: Error | null) => {
      if (err) return next(err);
      res.sendStatus(200);
    });
  });

  // Route to get current user
  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated()) {
      return sendError(res, 401, "UNAUTHORIZED", "Not authenticated", {
        hint: "Log in again to continue.",
        details: { functionName: "getCurrentUser" },
      });
    }
    
    // Check if 2FA is enabled but not completed for this session
    const requiresTwoFactor = req.user.twoFactorEnabled && !req.session.twoFactorAuthenticated;
    
    // Don't send sensitive data to client
    const tenantContext = getOptionalTenantContext();
    const safeUser = {
      ...req.user,
      role: tenantContext?.userRole ?? req.user.role,
      activeOrganizationId: tenantContext?.organizationId ?? null,
      membershipId: tenantContext?.membershipId ?? null,
      organizationRole: tenantContext?.membershipRole ?? null,
    };
    
    return sendOk(res, {
      ...safeUser,
      requiresTwoFactor
    });
  });

  app.get("/api/user/permissions", ensureAuthenticated, async (req, res) => {
    try {
      return sendOk(res, {
        role: getOptionalTenantContext()?.userRole ?? req.user!.role,
        permissions: await getEffectivePermissions(req.user!),
      });
    } catch (error) {
      console.error("Error fetching current user permissions:", error);
      return sendError(res, 500, "USER_PERMISSIONS_FAILED", "Could not load user permissions.");
    }
  });

  // Route to register new user with rate limiting
  app.post("/api/register", registerRateLimiter, async (req, res) => {
    let createdOrganizationId: number | null = null;
    try {
      const parsedRegistration = userRegistrationSchema.safeParse(req.body);
      if (!parsedRegistration.success) {
        return sendError(res, 400, "REGISTRATION_VALIDATION_FAILED", "Registration details are invalid.", {
          details: { fieldIssues: parsedRegistration.error.flatten().fieldErrors },
        });
      }
      const registration = parsedRegistration.data;
      // Check if username already exists
      const existingUser = await storage.getUserByUsername(registration.username);
      if (existingUser) {
        return res.status(400).json({ message: "Username already exists" });
      }

      // Check if email already exists
      if (registration.email) {
        const existingEmail = await storage.getUserByEmail(registration.email);
        if (existingEmail) {
          return res.status(400).json({ message: "Email already exists" });
        }
      }

      const passwordPolicyError = validatePasswordPolicy(registration.password);
      if (passwordPolicyError) {
        return res.status(400).json({ message: passwordPolicyError });
      }

      // Create new user with hashed password
      const hashedPassword = await hashPassword(registration.password);
      const pack = getCountryPack(registration.countryCode);
      const baseSlug = registration.organizationName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 48) || `organization-${Date.now()}`;
      let slug = baseSlug;
      let createdOrganization: typeof organizations.$inferSelect | undefined;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          [createdOrganization] = await db
            .insert(organizations)
            .values({
              name: registration.organizationName,
              slug,
              countryCode: pack.code,
              defaultCurrencyCode: pack.defaultCurrencyCode,
              locale: pack.locale,
              timezone: pack.timezone,
            })
            .returning();
          break;
        } catch {
          slug = `${baseSlug}-${Date.now()}-${attempt + 1}`;
        }
      }
      if (!createdOrganization) {
        return sendError(res, 409, "ORGANIZATION_CREATE_FAILED", "The organization could not be created.", {
          hint: "Try a different organization name or contact support.",
        });
      }
      const organizationId = createdOrganization.id;
      createdOrganizationId = organizationId;
      
      const autoVerifyEmail = appEnv.allowUnverifiedEmailLogin;
      const userData = {
        username: registration.username,
        email: registration.email,
        fullName: registration.fullName,
        role: "admin" as const,
        defaultOrganizationId: organizationId,
        password: hashedPassword,
        lastPasswordChange: new Date(),
        emailVerified: autoVerifyEmail,
        twoFactorEnabled: false,
        failedLoginAttempts: 0,
        accountLocked: false
      };

      logger.info("Creating user account", {
        username: userData.username,
        email: userData.email,
        role: userData.role,
        emailVerified: userData.emailVerified,
      });
      logger.debug("Creating user with sanitized registration data", { 
        ...userData, 
        password: "[REDACTED]" 
      });

      // Create the user
      const newUser = await storage.createUser(userData);
      await db
        .insert(organizationMembers)
        .values({
          organizationId,
          userId: newUser.id,
          role: "owner",
          applicationRole: "admin",
          active: true,
          status: "active",
        })
        .onConflictDoNothing();
      await db.insert(organizationSettings).values({
        organizationId,
        displayName: registration.organizationName,
        planTier: "starter",
        subscriptionStatus: "active",
        billingProvider: "local",
      }).onConflictDoNothing();
      
      // Create verification token
      const verificationToken = await storage.createVerificationToken(newUser.id, 'email', 24 * 60); // 24 hours expiry
      
      // Send verification email
      try {
        await sendVerificationEmail(newUser.email, verificationToken.token, newUser.username);
      } catch (emailError) {
        console.error("Error sending verification email:", emailError);
        // Continue but log the error - don't let email sending failure prevent registration
      }

      // Return success - email is automatically verified in development
      return sendOk(res, {
        message: autoVerifyEmail
          ? "Registration successful! You can now log in with your credentials."
          : "Registration successful! Please verify your email before logging in.",
        requiresEmailVerification: !autoVerifyEmail,
        organization: {
          id: createdOrganization.id,
          name: createdOrganization.name,
          countryCode: createdOrganization.countryCode,
          defaultCurrencyCode: createdOrganization.defaultCurrencyCode,
        },
      }, 201);
    } catch (error) {
      console.error("Registration error:", error);
      if (createdOrganizationId) {
        await db.delete(organizations).where(eq(organizations.id, createdOrganizationId)).catch(() => undefined);
      }
      return sendError(res, 500, "REGISTRATION_FAILED", "The account could not be created.", {
        hint: "Retry the registration. If the problem continues, contact support with the request ID.",
      });
    }
  });

  // Route to verify email address (via GET - redirects to login page)
  app.get("/api/verify-email", emailVerificationRateLimiter, async (req, res) => {
    try {
      const { token } = req.query;
      
      if (!token || typeof token !== 'string') {
        return res.status(400).json({ message: "Invalid verification token" });
      }
      
      // Verify the email using the shared function
      const verification = await storage.verifyEmail(token);
      
      if (!verification) {
        return res.status(400).json({ message: "Invalid or expired verification token" });
      }
      
      // Redirect to the login page with a success message
      res.redirect('/auth?verified=true');
    } catch (error) {
      console.error("Email verification error:", error);
      res.status(500).json({ message: "Error verifying email address" });
    }
  });
  
  // Route to verify email address (via POST - returns JSON response)
  app.post("/api/verify-email", emailVerificationRateLimiter, async (req, res) => {
    try {
      const { token } = req.body;
      
      if (!token || typeof token !== 'string') {
        return res.status(400).json({ message: "Invalid verification token" });
      }
      
      // Verify the email using our storage function
      const verification = await storage.verifyEmail(token);
      
      if (!verification) {
        return res.status(400).json({ 
          success: false,
          message: "Invalid or expired verification token" 
        });
      }
      
      // Return success response
      return res.status(200).json({
        success: true,
        message: "Email successfully verified. You can now log in."
      });
    } catch (error) {
      console.error("Email verification error:", error);
      res.status(500).json({ 
        success: false,
        message: "Error verifying email address" 
      });
    }
  });
  
  // Route to resend verification email
  app.post("/api/resend-verification-email", emailVerificationRateLimiter, async (req, res) => {
    try {
      const { email } = req.body;
      
      if (!email || typeof email !== 'string') {
        return res.status(400).json({ 
          success: false, 
          message: "Email address is required" 
        });
      }
      
      // Call the storage function to resend verification email
      const result = await storage.resendVerificationEmail(email);
      
      // Return the result directly from the storage function
      return res.status(200).json(result);
    } catch (error) {
      console.error("Error resending verification email:", error);
      res.status(500).json({ 
        success: false, 
        message: "An error occurred while resending the verification email" 
      });
    }
  });

  const authenticateLogin = (
    req: Request,
    res: Response,
    next: NextFunction,
    options: { envelope: boolean },
  ) => {
    const rememberMe = req.body.rememberMe === true;

    passport.authenticate(
      "local",
      (
        err: Error | null,
        user: Express.User | false,
        info: { message: string; requiresEmailVerification?: boolean } | undefined,
      ) => {
        if (err) {
          const raw = err instanceof Error ? err.message : String(err);
          const authMessage = (() => {
            if (raw.includes("ECONNREFUSED") || (raw.includes("connect") && raw.includes("postgres"))) {
              return "Authentication service unavailable: database unreachable (e.g. PostgreSQL not running on port 5432). Start Postgres, run npm run db:push, restart the server. Windows: docs/WINDOWS-LOCAL-SETUP.md";
            }
            if (/does not exist|42703|42P01/i.test(raw)) {
              return `Database schema mismatch (${raw.slice(0, 200)}). Run: npm run db:push, then npm run db:seed, restart npm run dev.`;
            }
            if (raw && raw !== "Authentication failed") {
              return `Authentication failed: ${raw.slice(0, 300)}`;
            }
            return "Authentication failed";
          })();
          if (options.envelope) {
            return res.status(503).json({
              ok: false,
              error: {
                code: "AUTH_ERROR",
                message: authMessage,
              },
            });
          }
          return res.status(503).json({ message: authMessage });
        }

        if (!user) {
          if (options.envelope) {
            return res.status(401).json({
              ok: false,
              error: {
                code: "AUTH_INVALID",
                message: info?.message || "Invalid username or password",
                details: {
                  requiresEmailVerification: info?.requiresEmailVerification || false,
                },
              },
            });
          }
          return res.status(401).json({
            message: info?.message || "Invalid username or password",
            requiresEmailVerification: info?.requiresEmailVerification || false,
          });
        }

        req.login(user, (loginError: Error | null) => {
          if (loginError) {
            const sessionMessage =
              "Failed to create login session. Check that the database is running and reachable (session store).";
            if (options.envelope) {
              return res.status(503).json({
                ok: false,
                error: {
                  code: "LOGIN_SESSION_ERROR",
                  message: sessionMessage,
                },
              });
            }
            return res.status(503).json({
              message: sessionMessage,
            });
          }

          if (rememberMe && req.session) {
            req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
          }

          void clearLoginRateLimit(req).catch(() => undefined);

          if (user.twoFactorEnabled) {
            const twoFactorPayload = {
              ...user,
              requiresTwoFactor: true,
            };
            if (options.envelope) {
              return res.status(200).json({ ok: true, data: twoFactorPayload });
            }
            return res.status(200).json(twoFactorPayload);
          }

          if (options.envelope) {
            return res.status(200).json({ ok: true, data: user });
          }
          return res.status(200).json(user);
        });
      },
    )(req, res, next);
  };

  // Legacy login route used by the main web app.
  app.post("/api/login", loginRateLimiter, (req, res, next) => {
    authenticateLogin(req, res, next, { envelope: false });
  });

  // API-contract login route used by runtime tests and integrations.
  app.post("/api/auth/login", loginRateLimiter, (req, res, next) => {
    authenticateLogin(req, res, next, { envelope: true });
  });

  // Route to setup two-factor authentication
  app.post("/api/2fa/setup", ensureAuthenticated, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Generate 2FA secret
      const setupData = await generateSetupResponse(req.user.username);
      
      // Save the secret to the user's account (but don't enable 2FA yet - needs verification)
      await storage.updateUser(req.user.id, {
        twoFactorSecret: setupData.secret
      });
      
      // Send the setup data to the client
      res.json({
        qrCodeUrl: setupData.qrCodeUrl,
        otpauthUrl: setupData.otpauthUrl
      });
      
      // Also send setup email
      try {
        await send2FASetupEmail(req.user.email, req.user.username, setupData.qrCodeUrl);
      } catch (emailError) {
        console.error("Error sending 2FA setup email:", emailError);
        // Continue but log the error
      }
    } catch (error) {
      console.error("2FA setup error:", error);
      res.status(500).json({ message: "Error setting up two-factor authentication" });
    }
  });

  // Route to verify and enable two-factor authentication
  app.post("/api/2fa/enable", ensureAuthenticated, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const { totpCode } = req.body;
      
      if (!totpCode) {
        return res.status(400).json({ message: "Verification code is required" });
      }
      
      // Get the user's 2FA secret
      const user = await storage.getUser(req.user.id);
      
      if (!user || !user.twoFactorSecret) {
        return res.status(400).json({ message: "Two-factor authentication has not been set up" });
      }
      
      // Verify the token
      const isValid = verifyToken(user.twoFactorSecret, totpCode);
      
      if (!isValid) {
        return res.status(400).json({ message: "Invalid verification code" });
      }
      
      // Enable 2FA for the user
      await storage.enableTwoFactorAuth(user.id, true);
      
      // Set the 2FA session flag
      req.session.twoFactorAuthenticated = true;
      
      res.json({ message: "Two-factor authentication enabled successfully" });
    } catch (error) {
      console.error("2FA enable error:", error);
      res.status(500).json({ message: "Error enabling two-factor authentication" });
    }
  });

  // Route to disable two-factor authentication
  app.post("/api/2fa/disable", ensureAuthenticated, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      // Require current password for security
      const { password } = req.body;
      
      if (!password) {
        return res.status(400).json({ message: "Current password is required" });
      }
      
      // Verify the password
      const user = await storage.getUser(req.user.id);
      
      if (!user) {
        return res.status(400).json({ message: "User not found" });
      }
      
      const isValidPassword = await comparePasswords(password, user.password);
      
      if (!isValidPassword) {
        return res.status(400).json({ message: "Invalid password" });
      }
      
      // Disable 2FA for the user
      await storage.disableTwoFactorAuth(user.id);
      
      // Clear the 2FA session flag
      if (req.session.twoFactorAuthenticated) {
        delete req.session.twoFactorAuthenticated;
      }
      
      res.json({ message: "Two-factor authentication disabled successfully" });
    } catch (error) {
      console.error("2FA disable error:", error);
      res.status(500).json({ message: "Error disabling two-factor authentication" });
    }
  });

  // Route to verify 2FA during login
  app.post("/api/2fa/verify", async (req, res) => {
    try {
      if (!req.isAuthenticated() || !req.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const { totpCode } = req.body;
      
      if (!totpCode) {
        return res.status(400).json({ message: "Verification code is required" });
      }
      
      // Get the user's 2FA secret
      const user = await storage.getUser(req.user.id);
      
      if (!user || !user.twoFactorSecret || !user.twoFactorEnabled) {
        return res.status(400).json({ message: "Two-factor authentication is not enabled" });
      }
      
      // Verify the token
      const isValid = verifyToken(user.twoFactorSecret, totpCode);
      
      if (!isValid) {
        return res.status(400).json({ message: "Invalid verification code" });
      }
      
      // Set the 2FA session flag
      req.session.twoFactorAuthenticated = true;
      
      // Don't send sensitive data to client
      const safeUser = { ...req.user };
      
      res.json({ 
        message: "Two-factor authentication successful",
        user: safeUser
      });
    } catch (error) {
      console.error("2FA verification error:", error);
      res.status(500).json({ message: "Error verifying two-factor authentication" });
    }
  });

  // Route to request password reset with rate limiting
  app.post("/api/password-reset-request", passwordResetRateLimiter, async (req, res) => {
    try {
      const { email } = req.body;
      
      const user = await storage.getUserByEmail(email);
      if (!user) {
        // Don't reveal that the email doesn't exist
        return res.status(200).json({ message: "If your email is registered, you will receive a password reset link" });
      }
      
      // Generate reset token and expiry
      const token = randomBytes(32).toString("hex");
      const expires = new Date();
      expires.setMinutes(expires.getMinutes() + 15); // token expires in 15 minutes
      
      // Update user with reset token
      await storage.updateUser(user.id, {
        passwordResetToken: token,
        passwordResetExpires: expires
      });
      
      // Send password reset email
      try {
        await sendPasswordResetEmail(email, token, user.username);
      } catch (emailError) {
        console.error("Error sending password reset email:", emailError);
        // Continue but log the error
      }
      
      res.status(200).json({ message: "If your email is registered, you will receive a password reset link" });
    } catch (error) {
      console.error("Password reset request error:", error);
      res.status(500).json({ message: "Error processing password reset request" });
    }
  });

  // Route to reset password with token
  app.post("/api/password-reset", passwordResetRateLimiter, async (req, res) => {
    try {
      const { token, newPassword } = req.body;
      const passwordPolicyError = validatePasswordPolicy(newPassword);
      if (passwordPolicyError) {
        return res.status(400).json({ message: passwordPolicyError });
      }
      
      const user = await storage.getUserByResetToken(token);
      if (!user) {
        return res.status(400).json({ message: "Invalid or expired reset token" });
      }
      
      // Check if token has expired
      if (user.passwordResetExpires && new Date() > new Date(user.passwordResetExpires)) {
        return res.status(400).json({ message: "Reset token has expired" });
      }
      
      // Update user password
      const hashedPassword = await hashPassword(newPassword);
      await storage.updateUser(user.id, {
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpires: null,
        lastPasswordChange: new Date(),
        accountLocked: false, // Unlock account if it was locked
        failedLoginAttempts: 0 // Reset failed login attempts
      });
      
      // Log the password change
      await storage.logUserAccess({
        userId: user.id,
        action: 'password_reset',
        ipAddress: typeof req.ip === 'string' ? req.ip : null,
        userAgent: req.headers['user-agent'] || null
      });
      
      res.status(200).json({ message: "Password has been reset successfully" });
    } catch (error) {
      console.error("Password reset error:", error);
      res.status(500).json({ message: "Error resetting password" });
    }
  });

  // Route to change password (when user is logged in)
  app.post("/api/change-password", ensureAuthenticated, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      const { currentPassword, newPassword } = req.body;
      const passwordPolicyError = validatePasswordPolicy(newPassword);
      if (passwordPolicyError) {
        return res.status(400).json({ message: passwordPolicyError });
      }
      
      // Change the password
      const success = await storage.changePassword(req.user.id, currentPassword, newPassword);
      
      if (!success) {
        return res.status(400).json({ message: "Current password is incorrect" });
      }
      
      // Log the password change
      await storage.logUserAccess({
        userId: req.user.id,
        action: 'password_change',
        ipAddress: typeof req.ip === 'string' ? req.ip : null,
        userAgent: req.headers['user-agent'] || null
      });
      
      res.json({ message: "Password changed successfully" });
    } catch (error) {
      console.error("Password change error:", error);
      res.status(500).json({ message: "Error changing password" });
    }
  });

  // Admin routes
  
  // Get all users (for admin panel)
  app.get("/api/admin/users", ensureAdmin, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      
      // Don't send sensitive data
      const safeUsers = users.map(user => {
        const { password, twoFactorSecret, passwordResetToken, passwordResetExpires, ...safeUser } = user;
        return safeUser;
      });
      
      res.json(safeUsers);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Error fetching users" });
    }
  });
  
  // Update user (for admin panel)
  app.put("/api/admin/users/:id", ensureAdmin, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      
      if (isNaN(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }
      
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Extract updatable fields
      const { 
        username, email, fullName, role, active, 
        emailVerified, twoFactorEnabled, warehouseId 
      } = req.body;
      
      // Update the user
      const updatedUser = await storage.updateUser(userId, {
        username,
        email,
        fullName,
        role,
        active,
        emailVerified,
        twoFactorEnabled,
        warehouseId
      });
      
      if (!updatedUser) {
        return res.status(500).json({ message: "Error updating user" });
      }
      
      // Log the admin action
      await storage.logUserAccess({
        userId: req.user!.id,
        action: 'admin_update_user',
        ipAddress: typeof req.ip === 'string' ? req.ip : null,
        userAgent: req.headers['user-agent'] || null,
        details: JSON.stringify({
          targetUserId: userId,
          changes: redactAuditDetails(req.body)
        })
      });
      
      // Don't send sensitive data
      const { password, twoFactorSecret, passwordResetToken, passwordResetExpires, ...safeUser } = updatedUser;
      
      res.json(safeUser);
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ message: "Error updating user" });
    }
  });
  
  // Delete user (for admin panel)
  app.delete("/api/admin/users/:id", ensureAdmin, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      
      if (isNaN(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }
      
      // Don't allow deleting the current user
      if (userId === req.user!.id) {
        return res.status(400).json({ message: "Cannot delete your own account" });
      }
      
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Delete the user
      const success = await storage.deleteUser(userId);
      
      if (!success) {
        return res.status(500).json({ message: "Error deleting user" });
      }
      
      // Log the admin action
      await storage.logUserAccess({
        userId: req.user!.id,
        action: 'admin_delete_user',
        ipAddress: typeof req.ip === 'string' ? req.ip : null,
        userAgent: req.headers['user-agent'] || null,
        details: JSON.stringify({
          deletedUserId: userId,
          deletedUsername: user.username
        })
      });
      
      res.json({ message: "User deleted successfully" });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ message: "Error deleting user" });
    }
  });
  
  // Get user access logs (for admin panel)
  app.get("/api/admin/access-logs", ensureAdmin, async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
      const logs = await storage.getRecentUserAccessLogs(limit);
      
      res.json(logs);
    } catch (error) {
      console.error("Error fetching access logs:", error);
      res.status(500).json({ message: "Error fetching access logs" });
    }
  });

  // Export middleware for route protection
  return {
    ensureAuthenticated,
    ensureAdmin,
    ensureRole,
    ensurePermission,
    ensureTwoFactorAuthenticated
  };
}
