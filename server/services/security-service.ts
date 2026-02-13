import { Request, Response, NextFunction } from 'express';
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import csrf from 'csurf';
import { storage } from '../storage';

// Create various rate limiters for different purposes
const loginLimiter = new RateLimiterMemory({
  points: 5, // 5 attempts
  duration: 60 * 15, // per 15 minutes
  blockDuration: 60 * 30, // Block for 30 minutes if exceeded
});

const registerLimiter = new RateLimiterMemory({
  points: 3, // 3 attempts
  duration: 60 * 60, // per hour
  blockDuration: 60 * 60, // Block for 1 hour if exceeded
});

const emailVerificationLimiter = new RateLimiterMemory({
  points: 5, // 5 attempts
  duration: 60 * 60, // per hour
  blockDuration: 60 * 60, // Block for 1 hour if exceeded
});

const passwordResetLimiter = new RateLimiterMemory({
  points: 3, // 3 attempts
  duration: 60 * 60, // per hour
  blockDuration: 60 * 60, // Block for 1 hour if exceeded
});

const apiLimiter = new RateLimiterMemory({
  points: 100, // 100 requests
  duration: 60, // per minute
});

// Helper function to get a unique key for rate limiting based on IP and optional username
function getRateLimiterKey(req: Request, includeUsername: boolean = false): string {
  const ip = req.ip || req.connection.remoteAddress || '';
  if (includeUsername && req.body && req.body.username) {
    return `${ip}_${req.body.username}`;
  }
  return ip;
}

// Get CSRF protection middleware
export const csrfProtection = csrf({ cookie: true });

// Middleware to handle CSRF errors
export function handleCSRFError(err: any, req: Request, res: Response, next: NextFunction) {
  if (err.code !== 'EBADCSRFTOKEN') return next(err);
  
  // CSRF token validation failed
  return res.status(403).json({
    message: 'Invalid or expired form submission. Please refresh and try again.'
  });
}

// Middleware for rate limiting login attempts
export async function loginRateLimiter(req: Request, res: Response, next: NextFunction) {
  try {
    const key = getRateLimiterKey(req, true);
    await loginLimiter.consume(key);
    next();
  } catch (error) {
    if (error instanceof RateLimiterRes) {
      return res.status(429).json({
        message: 'Too many login attempts. Please try again later.'
      });
    }
    next(error);
  }
}

// Middleware for rate limiting registration attempts
export async function registerRateLimiter(req: Request, res: Response, next: NextFunction) {
  try {
    const key = getRateLimiterKey(req);
    await registerLimiter.consume(key);
    next();
  } catch (error) {
    if (error instanceof RateLimiterRes) {
      return res.status(429).json({
        message: 'Too many registration attempts. Please try again later.'
      });
    }
    next(error);
  }
}

// Middleware for rate limiting email verification attempts
export async function emailVerificationRateLimiter(req: Request, res: Response, next: NextFunction) {
  try {
    const key = getRateLimiterKey(req);
    await emailVerificationLimiter.consume(key);
    next();
  } catch (error) {
    if (error instanceof RateLimiterRes) {
      return res.status(429).json({
        message: 'Too many verification attempts. Please try again later.'
      });
    }
    next(error);
  }
}

// Middleware for rate limiting password reset attempts
export async function passwordResetRateLimiter(req: Request, res: Response, next: NextFunction) {
  try {
    const key = getRateLimiterKey(req);
    await passwordResetLimiter.consume(key);
    next();
  } catch (error) {
    if (error instanceof RateLimiterRes) {
      return res.status(429).json({
        message: 'Too many password reset attempts. Please try again later.'
      });
    }
    next(error);
  }
}

// Middleware for general API rate limiting
export async function apiRateLimiter(req: Request, res: Response, next: NextFunction) {
  try {
    const key = getRateLimiterKey(req);
    await apiLimiter.consume(key);
    next();
  } catch (error) {
    if (error instanceof RateLimiterRes) {
      return res.status(429).json({
        message: 'Too many requests. Please try again later.'
      });
    }
    next(error);
  }
}

// Detect suspicious login activity based on IP, device, or other factors
export async function detectSuspiciousActivity(
  userId: number,
  ipAddress: string,
  userAgent: string
): Promise<boolean> {
  try {
    // 1. Check if this IP has been used by this user before
    const hasUsedIpBefore = await storage.hasUserUsedIpBefore(userId, ipAddress);
    
    // 2. Check if this is a new device/browser for this user
    const hasUsedUserAgentBefore = await storage.hasUserUsedUserAgentBefore(userId, userAgent);
    
    // 3. Check for multiple failed attempts prior to this successful login
    const recentFailedAttempts = await storage.getRecentFailedLoginAttempts(userId, 24); // last 24 hours
    const hasMultipleFailedAttempts = recentFailedAttempts.length >= 3;
    
    // 4. Check for logins from different geographic locations in a short time
    // This would typically involve an IP geolocation service
    
    // Log this access for future checks
    await storage.logUserAccess({
      userId,
      ipAddress,
      userAgent,
      action: 'login',
      isSuccessful: true,
      timestamp: new Date(),
      additionalInfo: JSON.stringify({ 
        isSuspicious: !hasUsedIpBefore || !hasUsedUserAgentBefore || hasMultipleFailedAttempts
      })
    });
    
    // Return true if activity seems suspicious
    return !hasUsedIpBefore || !hasUsedUserAgentBefore || hasMultipleFailedAttempts;
  } catch (error) {
    console.error('Error detecting suspicious activity:', error);
    return false; // Default to not suspicious if there's an error
  }
}