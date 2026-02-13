import nodemailer from 'nodemailer';

// Create a test account if no email credentials are provided
let transporter: nodemailer.Transporter;

async function initializeTransporter() {
  // If there are no email settings in the environment, create a test account
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log('No email credentials found, creating a test account with Ethereal');
    
    const testAccount = await nodemailer.createTestAccount();
    
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass
      }
    });
    
    console.log('Test email account created:', {
      user: testAccount.user,
      pass: testAccount.pass,
      previewUrl: 'https://ethereal.email'
    });
  } else {
    // Use the credentials from environment variables
    transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT || '587'),
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
  }
}

// Initialize the email transporter
initializeTransporter();

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

/**
 * Send an email using the configured transporter
 */
export async function sendEmail(options: EmailOptions): Promise<{ success: boolean; info?: any; error?: Error }> {
  try {
    if (!transporter) {
      await initializeTransporter();
    }
    
    const mailOptions = {
      from: options.from || process.env.EMAIL_FROM || 'noreply@inventorymanager.com',
      to: options.to,
      subject: options.subject,
      text: options.text || '',
      html: options.html
    };
    
    const info = await transporter.sendMail(mailOptions);
    
    // If using Ethereal, log the preview URL
    if (info.messageId && info.previewUrl) {
      console.log('Email sent. Preview URL:', info.previewUrl);
    }
    
    return { success: true, info };
  } catch (error) {
    console.error('Error sending email:', error);
    return { success: false, error: error as Error };
  }
}

/**
 * Send a verification email to a user
 */
export async function sendVerificationEmail(
  email: string,
  token: string,
  username: string
): Promise<{ success: boolean; info?: any; error?: Error }> {
  const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
  const verificationUrl = `${baseUrl}/api/verify-email?token=${token}`;
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">Verify Your Email Address</h2>
      <p>Hello ${username},</p>
      <p>Thank you for registering an account with Inventory Manager. Please verify your email address by clicking the button below:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${verificationUrl}" style="background-color: #4CAF50; color: white; padding: 15px 25px; text-decoration: none; border-radius: 4px; font-weight: bold;">Verify Email</a>
      </div>
      <p>Or copy and paste the following link in your browser:</p>
      <p><a href="${verificationUrl}">${verificationUrl}</a></p>
      <p>This verification link will expire in 24 hours.</p>
      <p>If you did not create an account, please ignore this email.</p>
      <p>Best regards,<br>The Inventory Manager Team</p>
    </div>
  `;
  
  const text = `
    Verify Your Email Address
    
    Hello ${username},
    
    Thank you for registering an account with Inventory Manager. Please verify your email address by clicking the link below:
    
    ${verificationUrl}
    
    This verification link will expire in 24 hours.
    
    If you did not create an account, please ignore this email.
    
    Best regards,
    The Inventory Manager Team
  `;
  
  return sendEmail({
    to: email,
    subject: 'Verify Your Email Address',
    html,
    text
  });
}

/**
 * Send a password reset email to a user
 */
export async function sendPasswordResetEmail(
  email: string,
  token: string,
  username: string
): Promise<{ success: boolean; info?: any; error?: Error }> {
  const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
  const resetUrl = `${baseUrl}/reset-password?token=${token}`;
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">Reset Your Password</h2>
      <p>Hello ${username},</p>
      <p>We received a request to reset the password for your account. Click the button below to reset your password:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${resetUrl}" style="background-color: #4CAF50; color: white; padding: 15px 25px; text-decoration: none; border-radius: 4px; font-weight: bold;">Reset Password</a>
      </div>
      <p>Or copy and paste the following link in your browser:</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>This password reset link will expire in 15 minutes.</p>
      <p>If you did not request a password reset, please ignore this email and your password will remain unchanged.</p>
      <p>Best regards,<br>The Inventory Manager Team</p>
    </div>
  `;
  
  const text = `
    Reset Your Password
    
    Hello ${username},
    
    We received a request to reset the password for your account. Please click the link below to reset your password:
    
    ${resetUrl}
    
    This password reset link will expire in 15 minutes.
    
    If you did not request a password reset, please ignore this email and your password will remain unchanged.
    
    Best regards,
    The Inventory Manager Team
  `;
  
  return sendEmail({
    to: email,
    subject: 'Password Reset Request',
    html,
    text
  });
}

/**
 * Send a welcome email to a new user
 */
export async function sendWelcomeEmail(
  email: string,
  username: string
): Promise<{ success: boolean; info?: any; error?: Error }> {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">Welcome to Inventory Manager!</h2>
      <p>Hello ${username},</p>
      <p>Thank you for verifying your email and joining Inventory Manager. We're excited to have you on board!</p>
      <p>With your account, you can:</p>
      <ul>
        <li>Track inventory across multiple warehouses</li>
        <li>Generate purchase orders</li>
        <li>Get real-time insights into your stock levels</li>
        <li>Manage suppliers and categories</li>
        <li>Generate detailed reports</li>
      </ul>
      <p>If you have any questions or need assistance, please don't hesitate to contact our support team.</p>
      <p>Best regards,<br>The Inventory Manager Team</p>
    </div>
  `;
  
  const text = `
    Welcome to Inventory Manager!
    
    Hello ${username},
    
    Thank you for verifying your email and joining Inventory Manager. We're excited to have you on board!
    
    With your account, you can:
    - Track inventory across multiple warehouses
    - Generate purchase orders
    - Get real-time insights into your stock levels
    - Manage suppliers and categories
    - Generate detailed reports
    
    If you have any questions or need assistance, please don't hesitate to contact our support team.
    
    Best regards,
    The Inventory Manager Team
  `;
  
  return sendEmail({
    to: email,
    subject: 'Welcome to Inventory Manager!',
    html,
    text
  });
}

/**
 * Send a 2FA setup email to a user
 */
export async function send2FASetupEmail(
  email: string,
  username: string,
  qrCodeUrl: string
): Promise<{ success: boolean; info?: any; error?: Error }> {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">Set Up Two-Factor Authentication</h2>
      <p>Hello ${username},</p>
      <p>You've enabled Two-Factor Authentication for your Inventory Manager account. Please scan the QR code below with your authenticator app (such as Google Authenticator, Authy, or Microsoft Authenticator):</p>
      <div style="text-align: center; margin: 30px 0;">
        <img src="${qrCodeUrl}" alt="QR Code for 2FA" style="max-width: 200px;">
      </div>
      <p>Once you've scanned the QR code, enter the verification code shown in your authenticator app to complete the setup.</p>
      <p>If you did not request to enable 2FA, please secure your account by changing your password immediately.</p>
      <p>Best regards,<br>The Inventory Manager Team</p>
    </div>
  `;
  
  const text = `
    Set Up Two-Factor Authentication
    
    Hello ${username},
    
    You've enabled Two-Factor Authentication for your Inventory Manager account. 
    
    Please use your authenticator app (such as Google Authenticator, Authy, or Microsoft Authenticator) to scan the QR code we've provided in the HTML version of this email.
    
    Once you've scanned the QR code, enter the verification code shown in your authenticator app to complete the setup.
    
    If you did not request to enable 2FA, please secure your account by changing your password immediately.
    
    Best regards,
    The Inventory Manager Team
  `;
  
  return sendEmail({
    to: email,
    subject: 'Set Up Two-Factor Authentication',
    html,
    text
  });
}

/**
 * Send a notification email about suspicious login activity
 */
export async function sendSuspiciousActivityEmail(
  email: string,
  username: string,
  ipAddress: string,
  timestamp: Date,
  userAgent: string
): Promise<{ success: boolean; info?: any; error?: Error }> {
  const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
  const securitySettingsUrl = `${baseUrl}/settings/security`;
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #c0392b;">Suspicious Login Detected</h2>
      <p>Hello ${username},</p>
      <p><strong>We detected a suspicious login attempt to your account.</strong></p>
      <p>Details of the login attempt:</p>
      <ul>
        <li><strong>Time:</strong> ${timestamp.toLocaleString()}</li>
        <li><strong>IP Address:</strong> ${ipAddress}</li>
        <li><strong>Device/Browser:</strong> ${userAgent}</li>
      </ul>
      <p>If this was you, you can ignore this email. If you don't recognize this login attempt, your account may be at risk.</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${securitySettingsUrl}" style="background-color: #c0392b; color: white; padding: 15px 25px; text-decoration: none; border-radius: 4px; font-weight: bold;">Review Security Settings</a>
      </div>
      <p>We recommend:</p>
      <ul>
        <li>Change your password immediately</li>
        <li>Enable two-factor authentication if you haven't already</li>
        <li>Review your account for any suspicious activity</li>
      </ul>
      <p>Best regards,<br>The Inventory Manager Security Team</p>
    </div>
  `;
  
  const text = `
    Suspicious Login Detected
    
    Hello ${username},
    
    We detected a suspicious login attempt to your account.
    
    Details of the login attempt:
    - Time: ${timestamp.toLocaleString()}
    - IP Address: ${ipAddress}
    - Device/Browser: ${userAgent}
    
    If this was you, you can ignore this email. If you don't recognize this login attempt, your account may be at risk.
    
    We recommend:
    - Change your password immediately
    - Enable two-factor authentication if you haven't already
    - Review your account for any suspicious activity
    
    You can review your security settings at: ${securitySettingsUrl}
    
    Best regards,
    The Inventory Manager Security Team
  `;
  
  return sendEmail({
    to: email,
    subject: '⚠️ Suspicious Login Detected',
    html,
    text
  });
}