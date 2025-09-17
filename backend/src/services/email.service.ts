import nodemailer from 'nodemailer';
import { logger } from '../utils/logger';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

class EmailService {
  private transporter: nodemailer.Transporter;
  private readonly emailFrom: string;

  constructor() {
    this.emailFrom = process.env.EMAIL_FROM || 'noreply@chatbot-platform.com';

    // Create transporter
    if (process.env.NODE_ENV === 'production') {
      // Production SMTP configuration
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
    } else {
      // Development configuration (MailHog)
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'localhost',
        port: parseInt(process.env.SMTP_PORT || '1025', 10),
        secure: false,
        ignoreTLS: true,
      });
    }
  }

  /**
   * Send email
   */
  private async sendEmail(options: EmailOptions): Promise<void> {
    try {
      const info = await this.transporter.sendMail({
        from: this.emailFrom,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text || options.html.replace(/<[^>]*>?/gm, ''),
      });

      logger.info(`Email sent: ${info.messageId}`, {
        to: options.to,
        subject: options.subject,
      });
    } catch (error) {
      logger.error('Failed to send email', {
        error,
        to: options.to,
        subject: options.subject,
      });
      throw error;
    }
  }

  /**
   * Send verification email
   */
  async sendVerificationEmail(email: string, token: string): Promise<void> {
    const verificationUrl = `${process.env.FRONTEND_URL}/auth/verify-email?token=${token}`;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #3b82f6; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9fafb; }
          .button { 
            display: inline-block; 
            padding: 12px 24px; 
            background-color: #3b82f6; 
            color: white; 
            text-decoration: none; 
            border-radius: 5px; 
            margin-top: 20px; 
          }
          .footer { margin-top: 20px; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Welcome to Chatbot Platform!</h1>
          </div>
          <div class="content">
            <h2>Verify Your Email Address</h2>
            <p>Thank you for registering with Chatbot Platform. Please click the button below to verify your email address and complete your registration.</p>
            <a href="${verificationUrl}" class="button">Verify Email</a>
            <p style="margin-top: 20px;">Or copy and paste this link in your browser:</p>
            <p style="word-break: break-all;">${verificationUrl}</p>
            <div class="footer">
              <p>This link will expire in 24 hours. If you didn't create an account, you can safely ignore this email.</p>
              <p>&copy; ${new Date().getFullYear()} Chatbot Platform. All rights reserved.</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    await this.sendEmail({
      to: email,
      subject: 'Verify your email address - Chatbot Platform',
      html,
    });
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    const resetUrl = `${process.env.FRONTEND_URL}/auth/reset-password?token=${token}`;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #3b82f6; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9fafb; }
          .button { 
            display: inline-block; 
            padding: 12px 24px; 
            background-color: #3b82f6; 
            color: white; 
            text-decoration: none; 
            border-radius: 5px; 
            margin-top: 20px; 
          }
          .warning { 
            background-color: #fef3c7; 
            border: 1px solid #f59e0b; 
            padding: 10px; 
            margin-top: 20px; 
            border-radius: 5px; 
          }
          .footer { margin-top: 20px; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Password Reset Request</h1>
          </div>
          <div class="content">
            <h2>Reset Your Password</h2>
            <p>We received a request to reset your password. Click the button below to create a new password.</p>
            <a href="${resetUrl}" class="button">Reset Password</a>
            <p style="margin-top: 20px;">Or copy and paste this link in your browser:</p>
            <p style="word-break: break-all;">${resetUrl}</p>
            <div class="warning">
              <strong>Security Notice:</strong> This link will expire in 1 hour for security reasons.
            </div>
            <div class="footer">
              <p>If you didn't request a password reset, please ignore this email. Your password will remain unchanged.</p>
              <p>&copy; ${new Date().getFullYear()} Chatbot Platform. All rights reserved.</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    await this.sendEmail({
      to: email,
      subject: 'Password Reset Request - Chatbot Platform',
      html,
    });
  }

  /**
   * Send login alert email
   */
  async sendLoginAlertEmail(
    email: string,
    details: { ipAddress?: string; userAgent?: string; timestamp: Date }
  ): Promise<void> {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #ef4444; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9fafb; }
          .details { 
            background-color: white; 
            border: 1px solid #e5e7eb; 
            padding: 15px; 
            margin-top: 20px; 
            border-radius: 5px; 
          }
          .footer { margin-top: 20px; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Security Alert</h1>
          </div>
          <div class="content">
            <h2>New Login to Your Account</h2>
            <p>We detected a new login to your Chatbot Platform account.</p>
            <div class="details">
              <p><strong>Time:</strong> ${details.timestamp.toLocaleString()}</p>
              ${details.ipAddress ? `<p><strong>IP Address:</strong> ${details.ipAddress}</p>` : ''}
              ${details.userAgent ? `<p><strong>Device:</strong> ${details.userAgent}</p>` : ''}
            </div>
            <p style="margin-top: 20px;">If this was you, you can ignore this email. If you didn't log in, please reset your password immediately.</p>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} Chatbot Platform. All rights reserved.</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    await this.sendEmail({
      to: email,
      subject: 'Security Alert - New Login Detected',
      html,
    });
  }
}

export const emailService = new EmailService();
