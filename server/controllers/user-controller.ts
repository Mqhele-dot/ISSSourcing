import { Request, Response } from "express";
import { z } from "zod";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "../storage";

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

// Profile update schema
const profileUpdateSchema = z.object({
  fullName: z.string().min(2, "Full name must be at least 2 characters").max(100, "Full name cannot exceed 100 characters"),
  email: z.string().email("Please enter a valid email address"),
  warehouseId: z.number().nullable().optional(),
  profilePicture: z.string().nullable().optional(),
});

// Security preferences schema
const securityPreferencesSchema = z.object({
  twoFactorEnabled: z.boolean().default(false),
  emailNotifications: z.boolean().default(true),
  sessionTimeout: z.number().min(15).max(1440).default(60),
});

// Password change schema
const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character"),
  confirmNewPassword: z.string(),
}).refine((data) => data.newPassword === data.confirmNewPassword, {
  message: "New passwords do not match",
  path: ["confirmNewPassword"]
});

export async function updateProfile(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userId = req.user.id;
    
    // Validate the request body
    const validationResult = profileUpdateSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        message: "Invalid data", 
        errors: validationResult.error.format() 
      });
    }
    
    const data = validationResult.data;
    
    // Check if email already exists (if user is changing their email)
    if (data.email !== req.user.email) {
      const existingUser = await storage.getUserByEmail(data.email);
      if (existingUser && existingUser.id !== userId) {
        return res.status(400).json({ message: "Email is already in use" });
      }
    }
    
    // Update the user profile
    const updatedUser = await storage.updateUser(userId, data);
    
    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }
    
    // Return the updated user (without password)
    const { password, ...userWithoutPassword } = updatedUser;
    
    return res.status(200).json(userWithoutPassword);
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).json({ message: "Error updating profile" });
  }
}

export async function getSecurityPreferences(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userId = req.user.id;
    
    // Get user security settings
    const securitySettings = await storage.getUserSecuritySettings(userId);
    
    if (!securitySettings) {
      // Return default security settings if none exists
      return res.status(200).json({
        twoFactorEnabled: req.user.twoFactorEnabled || false,
        emailNotifications: true,
        sessionTimeout: 60
      });
    }
    
    return res.status(200).json({
      twoFactorEnabled: req.user.twoFactorEnabled || false,
      emailNotifications: securitySettings.emailNotifications || true,
      sessionTimeout: securitySettings.sessionTimeout || 60
    });
  } catch (error) {
    console.error("Error getting security preferences:", error);
    res.status(500).json({ message: "Error getting security preferences" });
  }
}

export async function updateSecurityPreferences(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userId = req.user.id;
    
    // Validate the request body
    const validationResult = securityPreferencesSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        message: "Invalid data", 
        errors: validationResult.error.format() 
      });
    }
    
    const data = validationResult.data;
    
    // Update the user security settings
    const { twoFactorEnabled, ...otherSettings } = data;
    
    // Handle twoFactor flag separately since it's in the user table
    if (req.user.twoFactorEnabled !== twoFactorEnabled) {
      await storage.updateUser(userId, { twoFactorEnabled });
    }
    
    // Update or create security settings
    const updatedSettings = await storage.updateUserSecuritySettings(userId, {
      emailNotifications: otherSettings.emailNotifications,
      sessionTimeout: otherSettings.sessionTimeout
    });
    
    return res.status(200).json({
      twoFactorEnabled,
      ...otherSettings
    });
  } catch (error) {
    console.error("Error updating security preferences:", error);
    res.status(500).json({ message: "Error updating security preferences" });
  }
}

export async function changePassword(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userId = req.user.id;
    
    // Validate the request body
    const validationResult = passwordChangeSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ 
        message: "Invalid data", 
        errors: validationResult.error.format() 
      });
    }
    
    const { currentPassword, newPassword } = validationResult.data;
    
    // Get the current user with password
    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    
    // Verify the current password
    const isPasswordValid = await comparePasswords(currentPassword, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }
    
    // Hash the new password
    const hashedPassword = await hashPassword(newPassword);
    
    // Update the user's password
    await storage.updateUser(userId, { 
      password: hashedPassword,
      lastPasswordChange: new Date()
    });
    
    return res.status(200).json({ message: "Password changed successfully" });
  } catch (error) {
    console.error("Error changing password:", error);
    res.status(500).json({ message: "Error changing password" });
  }
}

export async function getUserAccessLogs(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userId = req.user.id;
    const limit = parseInt(req.query.limit as string) || 10;
    
    // Get user access logs
    const logs = await storage.getUserAccessLogs(userId, limit);
    
    return res.status(200).json(logs);
  } catch (error) {
    console.error("Error getting access logs:", error);
    res.status(500).json({ message: "Error getting access logs" });
  }
}

export async function revokeAllSessions(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userId = req.user.id;
    const currentSessionId = req.sessionID;
    
    // Invalidate all user sessions except the current one
    await storage.invalidateAllUserSessions(userId, currentSessionId);
    
    return res.status(200).json({ message: "All other sessions revoked successfully" });
  } catch (error) {
    console.error("Error revoking sessions:", error);
    res.status(500).json({ message: "Error revoking sessions" });
  }
}