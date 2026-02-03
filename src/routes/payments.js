import crypto from 'crypto';
import { Router } from 'express';
import Razorpay from 'razorpay';
import { requireAuth } from '../middleware/auth.js';
import { loadProfile } from '../middleware/profile.js';
import { supabaseAdmin } from '../supabase.js';
import { sendBookingConfirmationEmail } from '../lib/email.js';

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';

function getRazorpay() {
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) return null;
  return new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET });
}

function mapBooking(row) {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    userPhone: row.user_phone ?? '',
    date: row.date,
    slotId: `${row.date}-${row.slot_time}`,
    slotTime: row.slot_time,
    createdAt: row.created_at,
    status: row.status,
    paymentId: row.payment_id ?? undefined,
    amount: row.amount,
  };
}

function verifyPaymentSignature(orderId, paymentId, signature) {
  const body = orderId + '|' + paymentId;
  const expected = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET).update(body).digest('hex');
  return expected === signature;
}

/**
 * Call Razorpay refund API. Amount in paise (omit for full refund).
 * Returns true if refund was initiated.
 */
async function refundPayment(razorpay, paymentId, amountPaise, options = {}) {
  if (!razorpay || !paymentId) return false;
  try {
    const body = {
      speed: 'normal',
      notes: {
        reason: options.reason || 'booking_failed',
        ...(options.notes || {}),
      },
      receipt: options.receipt || `refund_${Date.now()}`,
    };
    if (amountPaise != null && amountPaise > 0) {
      body.amount = amountPaise;
    }
    await razorpay.payments.refund(paymentId, body);
    return true;
  } catch (err) {
    console.error('Razorpay refund failed:', err.message || err);
    return false;
  }
}

/** Insert a refund_pending booking so POST /refund can find it by payment_id + user_id. */
async function insertRefundPendingBooking({
  userId,
  paymentId,
  amountRupees,
  date,
  slotTime,
  slotDisplayTime,
  userName,
  userEmail,
  userPhone,
}) {
  const { error } = await supabaseAdmin.from('bookings').insert({
    user_id: userId,
    date,
    slot_time: slotTime,
    slot_display_time: slotDisplayTime ?? null,
    status: 'refund_pending',
    payment_id: paymentId,
    amount: amountRupees,
    user_name: userName,
    user_email: userEmail,
    user_phone: userPhone || null,
  });
  if (error) console.error('Insert refund_pending booking failed:', error.message);
}

export const paymentsRouter = Router();

paymentsRouter.post('/create-order', requireAuth, loadProfile, async (req, res) => {
  const razorpay = getRazorpay();
  if (!razorpay) {
    return res.status(503).json({ error: 'Payments not configured', message: 'Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env' });
  }
  const { amount, currency = 'INR', receipt, notes } = req.body;
  const amountNum = typeof amount === 'number' ? amount : parseInt(amount, 10);
  if (Number.isNaN(amountNum) || amountNum <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }
  const amountPaise = Math.round(amountNum * 100);
  if (amountPaise < 100) {
    return res.status(400).json({ error: 'Amount must be at least ₹1' });
  }
  const orderOptions = {
    amount: amountPaise,
    currency,
    receipt: receipt || `rcpt_${Date.now()}_${req.userId?.slice(0, 8)}`,
    notes: notes && typeof notes === 'object' ? notes : undefined,
  };
  try {
    const order = await razorpay.orders.create(orderOptions);
    res.json({
      orderId: order.id,
      keyId: RAZORPAY_KEY_ID,
      amount: order.amount,
      currency: order.currency,
    });
  } catch (err) {
    console.error('Razorpay order create failed:', err);
    res.status(500).json({ error: err.error?.description || 'Failed to create order' });
  }
});

paymentsRouter.post('/verify', requireAuth, loadProfile, async (req, res) => {
  if (!RAZORPAY_KEY_SECRET) {
    return res.status(503).json({ error: 'Payments not configured' });
  }
  const {
    razorpay_payment_id,
    razorpay_order_id,
    razorpay_signature,
    date,
    slotTime,
    slotId,
    slotDisplayTime,
  } = req.body;

  if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature || !date || !slotTime) {
    return res.status(400).json({ error: 'Missing payment or booking details' });
  }

  if (!verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
    return res.status(400).json({ error: 'Invalid payment signature' });
  }

  const razorpay = getRazorpay();
  if (!razorpay) {
    return res.status(503).json({ error: 'Payments not configured' });
  }

  let orderAmountPaise;
  try {
    const order = await razorpay.orders.fetch(razorpay_order_id);
    orderAmountPaise = order.amount;
    if (order.status !== 'paid') {
      return res.status(400).json({ error: 'Order not paid' });
    }
  } catch (err) {
    console.error('Razorpay order fetch failed:', err);
    return res.status(400).json({ error: 'Invalid order' });
  }

  const profile = req.profile;
  if (!profile) return res.status(403).json({ error: 'Profile required' });

  const [slotsRes, existingRes] = await Promise.all([
    supabaseAdmin.from('slot_templates').select('time, capacity').order('sort_order', { ascending: true }),
    supabaseAdmin.from('date_slot_overrides').select('time, capacity').eq('date', date).eq('time', slotTime).maybeSingle(),
  ]);
  const override = existingRes.data;
  const templates = slotsRes.data ?? [];
  const template = templates.find((t) => t.time === slotTime);
  const capacity = override?.capacity ?? template?.capacity ?? 2;

  const amountRupees = Math.round(orderAmountPaise / 100);
  const refundPendingPayload = {
    userId: req.userId,
    paymentId: razorpay_payment_id,
    amountRupees,
    date,
    slotTime,
    slotDisplayTime,
    userName: profile.name,
    userEmail: profile.email,
    userPhone: profile.phone || null,
  };

  const { count } = await supabaseAdmin
    .from('bookings')
    .select('*', { count: 'exact', head: true })
    .eq('date', date)
    .eq('slot_time', slotTime)
    .eq('status', 'confirmed');
  if (count >= capacity) {
    await insertRefundPendingBooking(refundPendingPayload);
    await refundPayment(razorpay, razorpay_payment_id, orderAmountPaise, {
      reason: 'slot_full',
      receipt: `refund_slot_full_${date}_${slotTime}`,
    });
    return res.status(400).json({
      error: 'Slot is fully booked. Your payment has been refunded.',
      code: 'BOOKING_FAILED_REFUND_PENDING',
      refundInitiated: true,
    });
  }

  const { data: dup } = await supabaseAdmin
    .from('bookings')
    .select('id')
    .eq('date', date)
    .eq('slot_time', slotTime)
    .eq('user_id', req.userId)
    .eq('status', 'confirmed')
    .maybeSingle();
  if (dup) {
    await insertRefundPendingBooking(refundPendingPayload);
    await refundPayment(razorpay, razorpay_payment_id, orderAmountPaise, {
      reason: 'duplicate_booking',
      receipt: `refund_dup_${date}_${slotTime}`,
    });
    return res.status(400).json({
      error: 'You have already booked this slot. Your payment has been refunded.',
      code: 'BOOKING_FAILED_REFUND_PENDING',
      refundInitiated: true,
    });
  }

  const { data: inserted, error } = await supabaseAdmin
    .from('bookings')
    .insert({
      user_id: req.userId,
      date,
      slot_time: slotTime,
      slot_display_time: slotDisplayTime ?? null,
      status: 'confirmed',
      payment_id: razorpay_payment_id,
      amount: amountRupees,
      user_name: profile.name,
      user_email: profile.email,
      user_phone: profile.phone || null,
    })
    .select()
    .single();

  if (error) {
    await insertRefundPendingBooking(refundPendingPayload);
    await refundPayment(razorpay, razorpay_payment_id, orderAmountPaise, {
      reason: 'booking_insert_failed',
      notes: { db_error: error.message?.slice(0, 100) },
      receipt: `refund_err_${Date.now()}`,
    });
    return res.status(400).json({
      error: 'Booking could not be completed. Your payment has been refunded.',
      code: 'BOOKING_FAILED_REFUND_PENDING',
      refundInitiated: true,
    });
  }

  sendBookingConfirmationEmail(inserted, profile.email).catch((err) =>
    console.error('Booking email failed:', err.message)
  );

  res.json(mapBooking(inserted));
});

paymentsRouter.post('/refund', requireAuth, async (req, res) => {
  const razorpay = getRazorpay();
  if (!razorpay) {
    return res.status(503).json({ error: 'Payments not configured' });
  }
  const { payment_id, amount } = req.body;
  if (!payment_id || typeof payment_id !== 'string') {
    return res.status(400).json({ error: 'payment_id is required' });
  }

  const { data: booking } = await supabaseAdmin
    .from('bookings')
    .select('id, payment_id, amount, status')
    .eq('payment_id', payment_id)
    .eq('user_id', req.userId)
    .maybeSingle();
  if (!booking) {
    return res.status(404).json({ error: 'Booking not found or you cannot refund this payment' });
  }
  if (booking.status !== 'refund_pending' && booking.status !== 'confirmed') {
    return res.status(400).json({ error: 'This booking cannot be refunded' });
  }

  const amountPaise = amount != null
    ? Math.round((typeof amount === 'number' ? amount : Number(amount)) * 100)
    : null;
  if (amountPaise != null && (Number.isNaN(amountPaise) || amountPaise <= 0)) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  try {
    const refund = await razorpay.payments.refund(
      payment_id,
      amountPaise != null ? { amount: amountPaise } : {}
    );
    console.log('Razorpay refund:', refund);
    await supabaseAdmin
      .from('bookings')
      .update({
        status: 'refund_pending',
        payment_id: refund.payment_id,
      })
      .eq('id', booking.id);
    return res.json({ ok: true, refundId: refund.id, amount: refund.amount });
  } catch (err) {
    const msg = (err.error?.description || err.message || '').toLowerCase();
    const alreadyRefunded =
      msg.includes('fully refunded') || msg.includes('already refunded') || msg.includes('refunded already');
    if (alreadyRefunded) {
      await supabaseAdmin
        .from('bookings')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', booking.id);
      return res.json({ ok: true, alreadyRefunded: true });
    }
    console.error('Razorpay refund failed:', err);
    return res.status(400).json({ error: err.error?.description || err.message || 'Refund failed' });
  }
});
