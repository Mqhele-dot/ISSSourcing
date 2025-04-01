import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import session from "express-session";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { User } from "@shared/schema";
import type { Request, Response, NextFunction } from "express";
import {
  loginRateLimiter,
  registerRateLimiter,
  emailVerificationRateLimiter,
  passwordResetRateLimiter,
  csrfProtection,
  handleCSRFError,
  detectSuspiciousActivity
} from "./services/security-service";
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  send2FASetupEmail,
  sendSuspiciousActivityEmail
} from "./services/email-service";
import {
  verifyToken,
  generateSetupResponse
} from "./services/two-factor-service";

declare global {
  namespace Express {
    // Use the User type from schema
    interface User extends Omit<import('@shared/schema').User, 'password'> {}
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

// Middleware to check if the user is authenticated
function ensureAuthenticated(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: "Unauthorized" });
}

// Middleware to check if the user has admin role
function ensureAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated() && req.user && req.user.role === "admin") {
    return next();
  }
  res.status(403).json({ message: "Forbidden: Admin access required" });
}

// Middleware to check if user has a specific role
function ensureRole(role: string | string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const roles = Array.isArray(role) ? role : [role];
    
    if (roles.includes(req.user.role)) {
      return next();
    }
    
    res.status(403).json({ 
      message: `Forbidden: Required role not found. Need one of: ${roles.join(', ')}` 
    });
  };
}

// Middleware to check if user has specific permission on a resource
function ensurePermission(resource: string, permissionType: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userRole = req.user.role;
    
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
      
      res.status(403).json({ 
        message: `Forbidden: You don't have ${permissionType} permission for ${resource}` 
      });
    } catch (error) {
      console.error("Permission check error:", error);
      res.status(500).json({ message: "Error checking permissions" });
    }
  };
}

// Middleware to check if 2FA is required
function ensureTwoFactorAuthenticated(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ message: "Unauthorized" });
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
  res.status(403).json({ 
    message: "Two-factor authentication required",
    requiresTwoFactor: true
  });
}

// Set up authentication
export function setupAuth(app: Express) {
  // Configure session
  const sessionSettings: session.SessionOptions = {
    secret: process.env.SESSION_SECRET || "inventory-management-system-secret-key",
    resave: false,
    saveUninitialized: false,
    store: storage.sessionStore,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax"
    }
  };

  // Trust first proxy if in production
  if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
  }

  // Set up session middleware
  app.use(session(sessionSettings));
  
  // Initialize Passport and restore authentication state from session
  app.use(passport.initialize());
  app.use(passport.session());

  // CSRF protection for all state-changing routes
  // Temporarily disable CSRF protection for these routes
  // app.use('/api/login', csrfProtection);
  // app.use('/api/register', csrfProtection);
  // app.use('/api/password-reset*', csrfProtection);
  // app.use('/api/verify-email', csrfProtection);
  // app.use('/api/2fa*', csrfProtection);
  // app.use(handleCSRFError);

  // Configure local strategy
  passport.use(new LocalStrategy(async (username, password, done) => {
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
      
      // Temporarily bypass email verification for development 
      // In production, uncomment this check
      // if (!user.emailVerified) {
      //   return done(null, false, { 
      //     message: "Please verify your email address before logging in",
      //     requiresEmailVerification: true 
      //   });
      // }

      // Record successful login attempt
      await storage.recordLoginAttempt(username, true);
      
      // Reset failed login attempts
      await storage.resetFailedLoginAttempts(user.id);
      
      // Update last login time
      await storage.updateUser(user.id, { 
        lastLogin: new Date() 
      });

      // Check for suspicious activity
      const isSuspicious = await detectSuspiciousActivity(
        user.id,
        (typeof req.ip === 'string' ? req.ip : 'unknown'),
        req.headers['user-agent'] || 'unknown'
      );
      
      if (isSuspicious) {
        // Send suspicious activity email
        sendSuspiciousActivityEmail(
          user.email,
          user.username,
          (typeof req.ip === 'string' ? req.ip : 'unknown'),
          new Date(),
          req.headers['user-agent'] || 'unknown'
        ).catch(err => {
          console.error('Error sending suspicious activity email:', err);
        });
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
      return res.status(401).json({ message: "Not authenticated" });
    }
    
    // Check if 2FA is enabled but not completed for this session
    const requiresTwoFactor = req.user.twoFactorEnabled && !req.session.twoFactorAuthenticated;
    
    // Don't send sensitive data to client
    const safeUser = { ...req.user };
    delete safeUser.password;
    delete safeUser.twoFactorSecret;
    delete safeUser.passwordResetToken;
    delete safeUser.passwordResetExpires;
    
    res.json({
      ...safeUser,
      requiresTwoFactor
    });
  });

  // Get CSRF token (disabled for now)
  // app.get('/api/csrf-token', csrfProtection, (req, res) => {
  //   res.json({ csrfToken: req.csrfToken() });
  // });

  // Route to register new user with rate limiting
  app.post("/api/register", registerRateLimiter, async (req, res) => {
    try {
      // Check if username already exists
      const existingUser = await storage.getUserByUsername(req.body.username);
      if (existingUser) {
        return res.status(400).json({ message: "Username already exists" });
      }

      // Check if email already exists
      if (req.body.email) {
        const existingEmail = await storage.getUserByEmail(req.body.email);
        if (existingEmail) {
          return res.status(400).json({ message: "Email already exists" });
        }
      }

      // Create new user with hashed password
      const hashedPassword = await hashPassword(req.body.password);
      const userData = {
        ...req.body,
        password: hashedPassword,
        lastPasswordChange: new Date(),
        emailVerified: true, // Temporarily set to true for development to bypass email verification
        twoFactorEnabled: false,
        failedLoginAttempts: 0,
        accountLocked: false
      };
      delete userData.confirmPassword; // Remove confirmPassword field

      const newUser = await storage.createUser(userData);
      
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
      res.status(201).json({ 
        message: "Registration successful! You can now log in with your credentials.",
        requiresEmailVerification: false
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ message: "Error creating user account" });
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

  // Route to authenticate user with rate limiting
  app.post("/api/login", loginRateLimiter, (req, res, next) => {
    // Remember me flag
    const rememberMe = req.body.rememberMe === true;
    
    passport.authenticate("local", (err: Error | null, user: Express.User | false, info: { message: string, requiresEmailVerification?: boolean } | undefined) => {
      if (err) {
        return next(err);
      }
      
      if (!user) {
        return res.status(401).json({ 
          message: info?.message || "Invalid username or password",
          requiresEmailVerification: info?.requiresEmailVerification || false
        });
      }

      req.login(user, (err: Error | null) => {
        if (err) {
          return next(err);
        }
        
        // Set session expiration based on remember me flag
        if (rememberMe && req.session) {
          req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
        }
        
        // If user has 2FA enabled, don't set twoFactorAuthenticated flag yet
        if (user.twoFactorEnabled) {
          return res.status(200).json({
            ...user,
            requiresTwoFactor: true
          });
        }
        
        return res.status(200).json(user);
      });
    })(req, res, next);
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
      delete safeUser.password;
      delete safeUser.twoFactorSecret;
      delete safeUser.passwordResetToken;
      delete safeUser.passwordResetExpires;
      
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
          changes: req.body
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