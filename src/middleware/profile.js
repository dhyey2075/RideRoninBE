import { supabaseAdmin } from '../supabase.js';

function profileFromAuthUser(req) {
  return {
    id: req.userId,
    name: req.user?.user_metadata?.name ?? req.user?.email?.split('@')[0] ?? 'User',
    email: req.userEmail ?? '',
    phone: req.user?.user_metadata?.phone ?? '',
    isAdmin: false,
  };
}

export async function loadProfile(req, res, next) {
  if (!req.userId) return next();
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, name, email, phone, is_admin')
    .eq('id', req.userId)
    .single();
  if (!error && data) {
    req.profile = {
      id: data.id,
      name: data.name,
      email: data.email ?? req.userEmail ?? '',
      phone: data.phone ?? '',
      isAdmin: data.is_admin,
    };
  } else if (req.user) {
    req.profile = profileFromAuthUser(req);
  }
  next();
}
