import { Router } from 'express';
import { requireAuth, requireAuthOrAdmin } from '../middleware/auth.js';
import { loadProfile } from '../middleware/profile.js';
import { supabaseAdmin } from '../supabase.js';
import { sendBookingConfirmationEmail } from '../lib/email.js';

const CANCELLATION_WINDOW_MINUTES = 30;

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

export const bookingsRouter = Router();

bookingsRouter.get('/', requireAuthOrAdmin, loadProfile, async (req, res) => {
  const mine = req.query.mine === 'true' || req.query.mine === '';
  if (mine || !req.profile?.isAdmin) {
    const { data, error } = await supabaseAdmin
      .from('bookings')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json((data ?? []).map(mapBooking));
  }
  const { data, error } = await supabaseAdmin.from('bookings').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json((data ?? []).map(mapBooking));
});

bookingsRouter.post('/', requireAuth, loadProfile, async (req, res) => {
  const { date, slotTime, slotId, slotDisplayTime, paymentId, amount } = req.body;
  if (!date || !slotTime) {
    return res.status(400).json({ error: 'date and slotTime required' });
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

  const { count } = await supabaseAdmin
    .from('bookings')
    .select('*', { count: 'exact', head: true })
    .eq('date', date)
    .eq('slot_time', slotTime)
    .eq('status', 'confirmed');
  if (count >= capacity) {
    return res.status(400).json({ error: 'Slot is fully booked' });
  }

  const { data: dup } = await supabaseAdmin
    .from('bookings')
    .select('id')
    .eq('date', date)
    .eq('slot_time', slotTime)
    .eq('user_id', req.userId)
    .eq('status', 'confirmed')
    .maybeSingle();
  if (dup) return res.status(400).json({ error: 'You have already booked this slot' });

  const { data: inserted, error } = await supabaseAdmin
    .from('bookings')
    .insert({
      user_id: req.userId,
      date,
      slot_time: slotTime,
      slot_display_time: slotDisplayTime ?? null,
      status: 'confirmed',
      payment_id: paymentId ?? null,
      amount: amount ?? 100,
      user_name: profile.name,
      user_email: profile.email,
      user_phone: profile.phone || null,
    })
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  sendBookingConfirmationEmail(inserted, profile.email).catch((err) =>
    console.error('Booking email failed:', err.message)
  );
  res.status(201).json(mapBooking(inserted));
});

bookingsRouter.patch('/:id/cancel', requireAuthOrAdmin, loadProfile, async (req, res) => {
  const { id } = req.params;
  const { data: booking, error: fetchError } = await supabaseAdmin.from('bookings').select('*').eq('id', id).single();
  if (fetchError || !booking) {
    return res.status(404).json({ error: 'Booking not found' });
  }
  if (booking.user_id !== req.userId && !req.profile?.isAdmin) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const slotDateTime = new Date(`${booking.date}T${booking.slot_time}`);
  const diffMinutes = (slotDateTime - Date.now()) / (1000 * 60);
  if (diffMinutes < CANCELLATION_WINDOW_MINUTES && !req.profile?.isAdmin) {
    return res.status(400).json({
      error: `Cannot cancel less than ${CANCELLATION_WINDOW_MINUTES} minutes before the slot`,
    });
  }
  const { error } = await supabaseAdmin
    .from('bookings')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});
