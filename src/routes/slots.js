import { Router } from 'express';
import { requireAuthOrAdmin } from '../middleware/auth.js';
import { loadProfile } from '../middleware/profile.js';
import { requireAdmin } from '../middleware/admin.js';
import { supabaseAdmin } from '../supabase.js';

const DEFAULT_SLOTS = [
  { time: '09:00', displayTime: '9:00 AM', capacity: 2 },
  { time: '10:00', displayTime: '10:00 AM', capacity: 2 },
  { time: '11:00', displayTime: '11:00 AM', capacity: 2 },
  { time: '12:00', displayTime: '12:00 PM', capacity: 2 },
  { time: '13:00', displayTime: '1:00 PM', capacity: 2 },
  { time: '14:00', displayTime: '2:00 PM', capacity: 2 },
  { time: '15:00', displayTime: '3:00 PM', capacity: 2 },
  { time: '16:00', displayTime: '4:00 PM', capacity: 2 },
  { time: '17:00', displayTime: '5:00 PM', capacity: 2 },
  { time: '18:00', displayTime: '6:00 PM', capacity: 2 },
];

export const slotsRouter = Router();

slotsRouter.get('/:date', async (req, res) => {
  const { date } = req.params;
  const [templatesRes, overridesRes, bookingsRes] = await Promise.all([
    supabaseAdmin.from('slot_templates').select('*').order('sort_order', { ascending: true }),
    supabaseAdmin.from('date_slot_overrides').select('time, capacity').eq('date', date),
    supabaseAdmin.from('bookings').select('slot_time').eq('date', date).eq('status', 'confirmed'),
  ]);

  const templates = templatesRes.data?.length
    ? templatesRes.data
    : DEFAULT_SLOTS.map((s, i) => ({ ...s, display_time: s.displayTime, sort_order: i }));

  const templateByTime = new Map(templates.map((t) => [t.time, t]));
  const overrides = overridesRes.data ?? [];
  const bookedBySlot = new Map();
  (bookingsRes.data ?? []).forEach((r) => bookedBySlot.set(r.slot_time, (bookedBySlot.get(r.slot_time) ?? 0) + 1));

  const slots = overrides.map((r) => {
    const t = templateByTime.get(r.time);
    return {
      id: `${date}-${r.time}`,
      time: r.time,
      displayTime: t?.display_time ?? t?.displayTime ?? r.time,
      capacity: r.capacity ?? 2,
      booked: bookedBySlot.get(r.time) ?? 0,
      sortOrder: t?.sort_order ?? 999,
    };
  });
  slots.sort((a, b) => a.sortOrder - b.sortOrder);
  const result = slots.map(({ sortOrder: _, ...s }) => s);
  res.json(result);
});

slotsRouter.put('/:date/:time', requireAuthOrAdmin, loadProfile, requireAdmin, async (req, res) => {
  const { date, time } = req.params;
  const { capacity } = req.body;
  if (typeof capacity !== 'number' || capacity < 0) {
    return res.status(400).json({ error: 'Invalid capacity' });
  }
  const { error } = await supabaseAdmin.from('date_slot_overrides').upsert(
    { date, time, capacity, updated_at: new Date().toISOString() },
    { onConflict: 'date,time' }
  );
  if (error) return res.status(400).json({ error: error.message });
  res.json({ date, time, capacity });
});

slotsRouter.delete('/:date/:time', requireAuthOrAdmin, loadProfile, requireAdmin, async (req, res) => {
  const date = req.params.date;
  const time = decodeURIComponent(req.params.time);
  const { error } = await supabaseAdmin.from('date_slot_overrides').delete().eq('date', date).eq('time', time);
  if (error) return res.status(400).json({ error: error.message });
  res.status(204).send();
});
