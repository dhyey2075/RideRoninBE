import jwt from 'jsonwebtoken';
import { supabaseAuth } from '../supabase.js';

export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Missing or invalid token' });
  }
  const { data: { user }, error } = await supabaseAuth.auth.getUser(token);
  if (error || !user) {
    return res.status(401).json({ error: 'Unauthorized', message: error?.message || 'Invalid token' });
  }
  req.user = user;
  req.userId = user.id;
  req.userEmail = user.email;
  next();
}

const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || process.env.ADMIN_PASSWORD || 'admin-secret-change-me';

export async function requireAuthOrAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Missing or invalid token' });
  }
  const { data: { user }, error } = await supabaseAuth.auth.getUser(token);
  if (!error && user) {
    req.user = user;
    req.userId = user.id;
    req.userEmail = user.email;
    return next();
  }
  try {
    const payload = jwt.verify(token, ADMIN_JWT_SECRET);
    if (payload?.admin) {
      req.profile = { isAdmin: true };
      req.userId = null;
      req.user = null;
      req.userEmail = null;
      return next();
    }
  } catch {
    /* not a valid admin JWT */
  }
  return res.status(401).json({ error: 'Unauthorized', message: 'Invalid token' });
}

export async function requireAdmin(req, res, next) {
  if (!req.profile?.isAdmin) {
    return res.status(403).json({ error: 'Forbidden', message: 'Admin required' });
  }
  next();
}
