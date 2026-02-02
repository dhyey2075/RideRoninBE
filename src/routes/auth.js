import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { loadProfile } from '../middleware/profile.js';
import { supabaseAdmin } from '../supabase.js';

export const authRouter = Router();

function profileFromAuthUser(req) {
  return {
    id: req.userId,
    name: req.user?.user_metadata?.name ?? req.user?.email?.split('@')[0] ?? 'User',
    email: req.userEmail ?? '',
    phone: req.user?.user_metadata?.phone ?? '',
    isAdmin: false,
  };
}

authRouter.get('/me', requireAuth, loadProfile, async (req, res) => {
  if (!req.profile) {
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', req.userId)
      .single();
    if (!fetchError && existing) {
      req.profile = {
        id: existing.id,
        name: existing.name,
        email: existing.email ?? req.userEmail ?? '',
        phone: existing.phone ?? '',
        isAdmin: existing.is_admin,
      };
    } else {
      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('profiles')
        .insert({
          id: req.userId,
          name: req.user?.user_metadata?.name ?? req.user?.email?.split('@')[0] ?? 'User',
          email: req.userEmail ?? '',
          phone: req.user?.user_metadata?.phone ?? null,
          is_admin: false,
        })
        .select()
        .single();
      if (!insertError && inserted) {
        req.profile = {
          id: inserted.id,
          name: inserted.name,
          email: inserted.email ?? req.userEmail ?? '',
          phone: inserted.phone ?? '',
          isAdmin: inserted.is_admin,
        };
      }
    }
  }
  if (!req.profile) {
    req.profile = profileFromAuthUser(req);
  }
  res.json(req.profile);
});

authRouter.patch('/me', requireAuth, loadProfile, async (req, res) => {
  const { name, phone } = req.body;
  const updates = {};
  if (typeof name === 'string') updates.name = name;
  if (typeof phone === 'string') updates.phone = phone;
  if (Object.keys(updates).length === 0) {
    return res.json(req.profile);
  }
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update(updates)
    .eq('id', req.userId)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({
    id: data.id,
    name: data.name,
    email: data.email ?? req.userEmail ?? '',
    phone: data.phone ?? '',
    isAdmin: data.is_admin,
  });
});
