import speakeasy from 'speakeasy';
import QRCode from 'qrcode';

/**
 * Generate a new secret key for two-factor authentication
 */
export function generateSecret(issuer: string, username: string): speakeasy.GeneratedSecret {
  return speakeasy.generateSecret({
    length: 20,
    name: `${issuer}:${username}`,
    issuer: issuer || 'Inventory Manager'
  });
}

/**
 * Generate a QR code image as a data URL for two-factor authentication setup
 */
export async function generateQRCode(secret: string): Promise<string> {
  return await QRCode.toDataURL(secret);
}

/**
 * Verify a token against a secret
 */
export function verifyToken(secret: string, token: string): boolean {
  try {
    return speakeasy.totp.verify({
      secret: secret,
      encoding: 'base32',
      token: token,
      window: 1 // Allow for 1 step of time drift (±30 seconds)
    });
  } catch (error) {
    console.error('Error verifying 2FA token:', error);
    return false;
  }
}

/**
 * Generate a response object with secret and QR code for setting up 2FA
 */
export async function generateSetupResponse(username: string): Promise<{
  secret: string;
  qrCodeUrl: string;
  otpauthUrl: string;
}> {
  const issuer = process.env.APP_NAME || 'Inventory Manager';
  const secret = generateSecret(issuer, username);
  
  const qrCodeUrl = await generateQRCode(secret.otpauth_url);
  
  return {
    secret: secret.base32,
    qrCodeUrl,
    otpauthUrl: secret.otpauth_url
  };
}