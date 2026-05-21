/*
 * Email delivery for Drop.
 *
 * Drop historically had no outbound email — invitations just surface a URL in
 * the admin UI for the operator to share manually. The password-reset flow
 * genuinely needs to email a link to a user who, by definition, can't sign in,
 * so this module adds a small SMTP sender.
 *
 * Configuration is via environment variables (all optional):
 *   SMTP_HOST      - SMTP server hostname. If unset, email is "logged" only.
 *   SMTP_PORT      - SMTP port (default 587).
 *   SMTP_SECURE    - "true" to use implicit TLS (default: true when port 465).
 *   SMTP_USER      - SMTP auth username (optional).
 *   SMTP_PASSWORD  - SMTP auth password (optional).
 *   SMTP_FROM      - From address (default: no-reply@<host-of-EXTERNAL_URL>).
 *
 * When SMTP_HOST is not configured the transport falls back to logging the
 * message (subject + reset link) at warn level. This mirrors the existing
 * invitation behaviour: in a dev / unconfigured deployment the operator can
 * still complete the flow by reading the link out of the server log, and the
 * password-reset endpoint stays a 200 either way (no email-existence leak).
 */

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { logger } from "~/server/internal/logging";
import { systemConfig } from "~/server/internal/config/sys-conf";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

class EmailManager {
  private transporter: Transporter | undefined;
  private from: string;
  private configured: boolean;

  constructor() {
    const host = process.env.SMTP_HOST;
    this.configured = !!host;

    // Derive a sensible default From address from the public URL host.
    let defaultFrom = "no-reply@drop.local";
    try {
      const url = new URL(systemConfig.getExternalUrl());
      defaultFrom = `no-reply@${url.hostname}`;
    } catch {
      // keep fallback
    }
    this.from = process.env.SMTP_FROM ?? defaultFrom;

    if (!host) {
      logger.warn(
        "[EMAIL] SMTP_HOST not set — emails (e.g. password resets) will be logged, not sent.",
      );
      return;
    }

    const port = parseInt(process.env.SMTP_PORT ?? "587", 10);
    const secureEnv = process.env.SMTP_SECURE;
    const secure =
      secureEnv !== undefined
        ? secureEnv.toLowerCase() === "true"
        : port === 465;

    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASSWORD;

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined,
    });

    logger.info(`[EMAIL] SMTP transport configured (${host}:${port})`);
  }

  /** Whether a real SMTP transport is configured. */
  isConfigured() {
    return this.configured;
  }

  /**
   * Send an email. Never throws — delivery failures are logged so callers
   * (e.g. the forgot-password endpoint) can keep their response constant and
   * not leak whether an address exists.
   */
  async send(message: EmailMessage): Promise<boolean> {
    if (!this.transporter) {
      // Unconfigured: log the contents so a dev deployment can still follow
      // links manually.
      logger.warn(
        `[EMAIL] (not sent — no SMTP) to=${message.to} subject="${message.subject}"\n${message.text}`,
      );
      return false;
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      logger.info(`[EMAIL] sent to=${message.to} subject="${message.subject}"`);
      return true;
    } catch (e) {
      logger.error(
        `[EMAIL] failed to send to=${message.to}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return false;
    }
  }
}

export const emailManager = new EmailManager();
export default emailManager;

/**
 * Render the password-reset email. Kept here so the visual style lives next to
 * the transport; mirrors the plain, link-forward style of Drop's invitation
 * URLs.
 */
export function buildPasswordResetEmail(resetUrl: string): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = "Reset your Drop password";
  const text = [
    "Someone (hopefully you) requested a password reset for your Drop account.",
    "",
    "Use the link below to choose a new password. It expires in 1 hour and can only be used once:",
    "",
    resetUrl,
    "",
    "If you didn't request this, you can safely ignore this email — your password will not change.",
  ].join("\n");

  const html = `
  <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background:#18181b; color:#e4e4e7; padding:32px;">
    <div style="max-width:480px; margin:0 auto;">
      <h1 style="font-size:20px; color:#fafafa; margin:0 0 16px;">Reset your Drop password</h1>
      <p style="font-size:14px; line-height:1.6; color:#a1a1aa;">
        Someone (hopefully you) requested a password reset for your Drop account.
        Click the button below to choose a new password. This link
        <strong style="color:#e4e4e7;">expires in 1 hour</strong> and can only be used once.
      </p>
      <p style="margin:24px 0;">
        <a href="${resetUrl}" style="display:inline-block; background:#2563eb; color:#ffffff; text-decoration:none; font-weight:600; font-size:14px; padding:10px 20px; border-radius:6px;">
          Reset password
        </a>
      </p>
      <p style="font-size:12px; line-height:1.6; color:#71717a;">
        If the button doesn't work, copy and paste this URL into your browser:<br />
        <span style="color:#a1a1aa; word-break:break-all;">${resetUrl}</span>
      </p>
      <p style="font-size:12px; line-height:1.6; color:#71717a; margin-top:24px;">
        If you didn't request this, you can safely ignore this email — your password will not change.
      </p>
    </div>
  </div>`;

  return { subject, text, html };
}
