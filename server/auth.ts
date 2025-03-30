import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import session from "express-session";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { User } from "@shared/schema";
import type { Request, Response, NextFunction } from "express";

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

  // Configure local strategy
  passport.use(new LocalStrategy(async (username, password, done) => {
    try {
      // Find the user
      const user = await storage.getUserByUsername(username);
      
      // If user doesn't exist or password doesn't match
      if (!user || !(await comparePasswords(password, user.password))) {
        return done(null, false, { message: "Invalid username or password" });
      }

      // Update last login time
      await storage.updateUser(user.id, { 
        lastLogin: new Date() 
      });

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
    res.json(req.user);
  });

  // Route to register new user
  app.post("/api/register", async (req, res) => {
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
        lastPasswordChange: new Date()
      };
      delete userData.confirmPassword; // Remove confirmPassword field

      const newUser = await storage.createUser(userData);

      // Log in the new user
      req.login(newUser, (err: Error | null) => {
        if (err) {
          return res.status(500).json({ message: "Error during login after registration" });
        }
        return res.status(201).json(newUser);
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ message: "Error creating user account" });
    }
  });

  // Route to authenticate user
  app.post("/api/login", (req, res, next) => {
    passport.authenticate("local", (err: Error | null, user: Express.User | false, info: { message: string } | undefined) => {
      if (err) {
        return next(err);
      }
      if (!user) {
        return res.status(401).json({ message: info?.message || "Invalid username or password" });
      }

      req.login(user, (err: Error | null) => {
        if (err) {
          return next(err);
        }
        return res.json(user);
      });
    })(req, res, next);
  });

  // Route to request password reset
  app.post("/api/password-reset-request", async (req, res) => {
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
      expires.setHours(expires.getHours() + 1); // token expires in 1 hour
      
      // Update user with reset token
      await storage.updateUser(user.id, {
        passwordResetToken: token,
        passwordResetExpires: expires
      });
      
      // In a real application, send an email with reset link
      // For this demo, just return success message
      res.status(200).json({ message: "If your email is registered, you will receive a password reset link" });
    } catch (error) {
      console.error("Password reset request error:", error);
      res.status(500).json({ message: "Error processing password reset request" });
    }
  });

  // Route to reset password with token
  app.post("/api/password-reset", async (req, res) => {
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
        lastPasswordChange: new Date()
      });
      
      res.status(200).json({ message: "Password has been reset successfully" });
    } catch (error) {
      console.error("Password reset error:", error);
      res.status(500).json({ message: "Error resetting password" });
    }
  });

  // Export middleware for route protection
  return {
    ensureAuthenticated,
    ensureAdmin,
    ensureRole,
    ensurePermission
  };
}