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
