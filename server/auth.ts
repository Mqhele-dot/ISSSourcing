import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import session from "express-session";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { User } from "@shared/schema";

declare global {
  namespace Express {
    interface User extends User {}
  }
}

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function comparePasswords(supplied: string, stored: string) {
  const [hashed, salt] = stored.split(".");
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

export function setupAuth(app: Express) {
  const sessionSettings: session.SessionOptions = {
    secret: process.env.SESSION_SECRET || "inventory-management-secret",
    resave: false,
    saveUninitialized: false,
    store: storage.sessionStore,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    }
  };

  app.set("trust proxy", 1);
  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const user = await storage.getUserByUsername(username);
        if (!user || !(await comparePasswords(password, user.password))) {
          return done(null, false, { message: "Invalid username or password" });
        }
        
        // Update last login time
        await storage.updateUser(user.id, { lastLogin: new Date() });
        
        return done(null, user);
      } catch (error) {
        return done(error);
      }
    }),
  );

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });
  
  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUser(id);
      done(null, user);
    } catch (error) {
      done(error);
    }
  });

  app.post("/api/register", async (req, res, next) => {
    try {
      const existingUser = await storage.getUserByUsername(req.body.username);
      if (existingUser) {
        return res.status(400).json({ message: "Username already exists" });
      }

      const existingEmail = await storage.getUserByEmail(req.body.email);
      if (existingEmail) {
        return res.status(400).json({ message: "Email already exists" });
      }

      const user = await storage.createUser({
        ...req.body,
        password: await hashPassword(req.body.password),
      });

      req.login(user, (err) => {
        if (err) return next(err);
        // Remove sensitive information
        const { password, ...safeUser } = user;
        res.status(201).json(safeUser);
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/login", (req, res, next) => {
    passport.authenticate("local", (err, user, info) => {
      if (err) return next(err);
      if (!user) {
        return res.status(401).json({ message: info?.message || "Authentication failed" });
      }
      req.login(user, (loginErr) => {
        if (loginErr) return next(loginErr);
        // Remove sensitive information
        const { password, ...safeUser } = user;
        return res.status(200).json(safeUser);
      });
    })(req, res, next);
  });

  app.post("/api/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.sendStatus(200);
    });
  });

  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    // Remove sensitive information
    const { password, ...safeUser } = req.user as User;
    res.json(safeUser);
  });

  // Change password endpoint
  app.post("/api/change-password", async (req, res, next) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const user = await storage.getUser((req.user as User).id);
      const { currentPassword, newPassword } = req.body;

      if (!(await comparePasswords(currentPassword, user.password))) {
        return res.status(400).json({ message: "Current password is incorrect" });
      }

      await storage.updateUser(user.id, {
        password: await hashPassword(newPassword),
        lastPasswordChange: new Date(),
      });

      res.status(200).json({ message: "Password updated successfully" });
    } catch (error) {
      next(error);
    }
  });

  // Request password reset
  app.post("/api/reset-password-request", async (req, res, next) => {
    try {
      const { email } = req.body;
      const user = await storage.getUserByEmail(email);

      if (user) {
        const token = randomBytes(20).toString("hex");
        const expires = new Date();
        expires.setHours(expires.getHours() + 1); // 1 hour expiration

        await storage.updateUser(user.id, {
          passwordResetToken: token,
          passwordResetExpires: expires,
        });

        // In a real application, send an email with the reset link
        // For now, just return success
        res.status(200).json({
          message: "Password reset link has been sent to your email",
        });
      } else {
        // Don't reveal that the user doesn't exist for security reasons
        res.status(200).json({
          message: "If an account with that email exists, a password reset link has been sent",
        });
      }
    } catch (error) {
      next(error);
    }
  });

  // Reset password with token
  app.post("/api/reset-password", async (req, res, next) => {
    try {
      const { token, newPassword } = req.body;
      const user = await storage.getUserByResetToken(token);

      if (!user || !user.passwordResetExpires || new Date() > user.passwordResetExpires) {
        return res.status(400).json({ message: "Invalid or expired token" });
      }

      await storage.updateUser(user.id, {
        password: await hashPassword(newPassword),
        passwordResetToken: null,
        passwordResetExpires: null,
        lastPasswordChange: new Date(),
      });

      res.status(200).json({ message: "Password has been reset successfully" });
    } catch (error) {
      next(error);
    }
  });
}