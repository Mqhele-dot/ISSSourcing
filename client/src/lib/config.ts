/**
 * Application Configuration
 * 
 * This file provides configuration settings for the application.
 * Environment-specific settings can be overridden in .env files.
 */

import { isElectronEnvironment } from './electron-bridge';

// Feature flags
interface FeatureFlags {
  enableWebSockets: boolean;
  enableRealTimeSync: boolean;
  enableOfflineMode: boolean;
}

// Check if we're in development or production
const isDevelopment = 
  process.env.NODE_ENV === 'development' || 
  window.location.hostname === 'localhost' ||
  window.location.hostname.includes('replit.dev');

/**
 * Default feature flags
 * 
 * WebSockets are:
 * - Always enabled in Electron (desktop app)
 * - Disabled by default in development web environment (like Replit)
 * - Enabled by default in production web environment
 */
const defaultFeatureFlags: FeatureFlags = {
  // Enable WebSockets in Electron or production, disable in development (like Replit)
  enableWebSockets: isElectronEnvironment() || !isDevelopment,
  
  // Enable real-time sync in Electron or production, disable in development
  enableRealTimeSync: isElectronEnvironment() || !isDevelopment,
  
  // Enable offline mode in Electron only by default
  enableOfflineMode: isElectronEnvironment(),
};

// Allow overriding via localStorage during development
let featureFlags = { ...defaultFeatureFlags };

if (isDevelopment && typeof window !== 'undefined' && window.localStorage) {
  try {
    const storedFlags = localStorage.getItem('featureFlags');
    if (storedFlags) {
      featureFlags = { ...featureFlags, ...JSON.parse(storedFlags) };
    }
  } catch (error) {
    console.error('Error loading feature flags from localStorage:', error);
  }
}

/**
 * Get a feature flag value
 * @param flagName Name of the feature flag
 * @returns Boolean value indicating if the feature is enabled
 */
export function isFeatureEnabled(flagName: keyof FeatureFlags): boolean {
  return featureFlags[flagName];
}

/**
 * Set a feature flag (development only)
 * @param flagName Name of the feature flag
 * @param value New value for the flag
 */
export function setFeatureFlag(flagName: keyof FeatureFlags, value: boolean): void {
  if (isDevelopment) {
    featureFlags[flagName] = value;
    
    try {
      localStorage.setItem('featureFlags', JSON.stringify(featureFlags));
    } catch (error) {
      console.error('Error saving feature flags to localStorage:', error);
    }
  } else {
    console.warn('Feature flags can only be changed in development mode');
  }
}

/**
 * Reset all feature flags to defaults
 */
export function resetFeatureFlags(): void {
  featureFlags = { ...defaultFeatureFlags };
  
  if (isDevelopment) {
    try {
      localStorage.removeItem('featureFlags');
    } catch (error) {
      console.error('Error removing feature flags from localStorage:', error);
    }
  }
}

export { featureFlags };