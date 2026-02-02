import { Router } from 'express';
import { supabaseAdmin } from '../supabase.js';

const DEFAULT_SLOTS = [
  { time: '09:00', display_time: '9:00 AM', capacity: 2, sort_order: 1 },
  { time: '10:00', display_time: '10:00 AM', capacity: 2, sort_order: 2 },
  { time: '11:00', display_time: '11:00 AM', capacity: 2, sort_order: 3 },
  { time: '12:00', display_time: '12:00 PM', capacity: 2, sort_order: 4 },
  { time: '13:00', display_time: '1:00 PM', capacity: 2, sort_order: 5 },
  { time: '14:00', display_time: '2:00 PM', capacity: 2, sort_order: 6 },
  { time: '15:00', display_time: '3:00 PM', capacity: 2, sort_order: 7 },
  { time: '16:00', display_time: '4:00 PM', capacity: 2, sort_order: 8 },
  { time: '17:00', display_time: '5:00 PM', capacity: 2, sort_order: 9 },
  { time: '18:00', display_time: '6:00 PM', capacity: 2, sort_order: 10 },
];

export const initRouter = Router();

initRouter.post('/init', async (_, res) => {
  const { data: templates } = await supabaseAdmin.from('slot_templates').select('id').limit(1);
  if (!templates?.length) {
    await supabaseAdmin.from('slot_templates').insert(DEFAULT_SLOTS);
  }
  const { data: admin } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('email', 'admin@bikeslots.com')
    .maybeSingle();
  if (!admin) {
    const { data: authUser } = await supabaseAdmin.auth.admin.listUsers();
    const adminAuth = authUser?.users?.find((u) => u.email === 'admin@bikeslots.com');
    if (adminAuth) {
      await supabaseAdmin.from('profiles').upsert({
        id: adminAuth.id,
        name: 'Admin',
        email: 'admin@bikeslots.com',
        phone: '9999999999',
        is_admin: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
    }
  }
  res.json({ ok: true });
});
