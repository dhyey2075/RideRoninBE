import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { requireAuthOrAdmin } from '../middleware/auth.js';
import { loadProfile } from '../middleware/profile.js';
import { requireAdmin } from '../middleware/admin.js';
import { supabaseAdmin } from '../supabase.js';

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || process.env.ADMIN_PASSWORD || 'admin-secret-change-me';
const ADMIN_JWT_EXPIRES = process.env.ADMIN_JWT_EXPIRES || '24h';

export const adminRouter = Router();

adminRouter.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'Admin login not configured', message: 'Set ADMIN_USERNAME and ADMIN_PASSWORD in .env' });
  }
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const token = jwt.sign(
    { admin: true },
    ADMIN_JWT_SECRET,
    { expiresIn: ADMIN_JWT_EXPIRES }
  );
  res.json({ token });
});

const slotTemplatesRouter = Router({ mergeParams: true });
slotTemplatesRouter.use(requireAuthOrAdmin, loadProfile, requireAdmin);

slotTemplatesRouter.get('/', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('slot_templates')
    .select('id, time, display_time, capacity, sort_order')
    .order('sort_order', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json((data ?? []).map((r) => ({
    id: r.id,
    time: r.time,
    displayTime: r.display_time,
    capacity: r.capacity,
    sortOrder: r.sort_order,
  })));
});

slotTemplatesRouter.post('/', async (req, res) => {
  const { time, displayTime, capacity = 2, sortOrder } = req.body;
  if (!time || typeof time !== 'string' || !displayTime || typeof displayTime !== 'string') {
    return res.status(400).json({ error: 'time and displayTime required' });
  }
  const timeNorm = time.trim();
  const displayTimeNorm = displayTime.trim();
  if (!timeNorm || !displayTimeNorm) {
    return res.status(400).json({ error: 'time and displayTime required' });
  }
  const cap = typeof capacity === 'number' ? capacity : parseInt(capacity, 10);
  if (Number.isNaN(cap) || cap < 0) {
    return res.status(400).json({ error: 'capacity must be a non-negative number' });
  }
  let order = typeof sortOrder === 'number' ? sortOrder : parseInt(sortOrder, 10);
  if (Number.isNaN(order)) {
    const { data: maxRow } = await supabaseAdmin
      .from('slot_templates')
      .select('sort_order')
      .order('sort_order', { ascending: false })
      .limit(1)
      .single();
    order = (maxRow?.sort_order ?? -1) + 1;
  }
  const { data: inserted, error } = await supabaseAdmin
    .from('slot_templates')
    .insert({
      time: timeNorm,
      display_time: displayTimeNorm,
      capacity: cap,
      sort_order: order,
    })
    .select('id, time, display_time, capacity, sort_order')
    .single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Slot time already exists' });
    return res.status(400).json({ error: error.message });
  }
  res.status(201).json({
    id: inserted.id,
    time: inserted.time,
    displayTime: inserted.display_time,
    capacity: inserted.capacity,
    sortOrder: inserted.sort_order,
  });
});

slotTemplatesRouter.delete('/:time', async (req, res) => {
  const time = decodeURIComponent(req.params.time);
  if (!time) return res.status(400).json({ error: 'time required' });
  await supabaseAdmin.from('date_slot_overrides').delete().eq('time', time);
  const { error } = await supabaseAdmin.from('slot_templates').delete().eq('time', time);
  if (error) return res.status(400).json({ error: error.message });
  res.status(204).send();
});

adminRouter.use('/slot-templates', slotTemplatesRouter);
