import nodemailer from 'nodemailer';

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  const options = {
    host,
    port: port ? parseInt(port, 10) : 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass },
  };
  if (process.env.SMTP_INSECURE === 'true') {
    options.tls = { rejectUnauthorized: false };
  }
  return nodemailer.createTransport(options);
}

export async function sendBookingConfirmationEmail(booking, toEmail) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn('Booking confirmation email skipped: SMTP not configured (SMTP_HOST, SMTP_USER, SMTP_PASS in .env)');
    return;
  }
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
  const date = booking.date;
  const time = booking.slot_display_time || booking.slot_time || '';
  const subject = `Booking confirmed – RideRonin ${date} ${time}`;
  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 480px;">
      <h2 style="color: #0f172a;">Booking confirmed</h2>
      <p>Your slot has been confirmed.</p>
      <p><strong>Date:</strong> ${date}</p>
      <p><strong>Time:</strong> ${time}</p>
      <p><strong>Amount:</strong> ₹${booking.amount ?? 0}</p>
      <p style="margin-top: 24px; color: #64748b; font-size: 14px;">RideRonin</p>
    </div>
  `;
  try {
    await transporter.sendMail({
      from: from || 'noreply@rideronin.com',
      to: toEmail,
      subject,
      html,
    });
  } catch (err) {
    console.error('Failed to send booking confirmation email:', err.message);
  }
}

function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Convert plain text to safe HTML (escape + newlines to <br>). */
export function plainTextToHtml(text) {
  const escaped = escapeHtml(text);
  const withBreaks = escaped.replace(/\n/g, '<br>');
  return `<div style="font-family: system-ui, sans-serif; max-width: 560px; line-height: 1.5;">${withBreaks}</div>`;
}

/**
 * Send the same email (subject + html body) to multiple recipients.
 * @param {string[]} toEmails - List of email addresses
 * @param {string} subject - Email subject
 * @param {string} htmlBody - HTML body (already safe)
 * @returns {{ sent: number, failed: number }}
 */
export async function sendBulkEmail(toEmails, subject, htmlBody) {
  const transporter = getTransporter();
  if (!transporter) {
    throw new Error('SMTP not configured (SMTP_HOST, SMTP_USER, SMTP_PASS in .env)');
  }
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
  const uniqueEmails = [...new Set(toEmails)].filter((e) => e && typeof e === 'string' && e.includes('@'));
  let sent = 0;
  let failed = 0;
  for (const to of uniqueEmails) {
    try {
      await transporter.sendMail({
        from: from || 'noreply@rideronin.com',
        to,
        subject,
        html: htmlBody,
      });
      sent++;
    } catch (err) {
      console.error(`Bulk email failed for ${to}:`, err.message);
      failed++;
    }
  }
  return { sent, failed };
}
