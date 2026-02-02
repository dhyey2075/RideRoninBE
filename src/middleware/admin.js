export async function requireAdmin(req, res, next) {
  if (!req.profile?.isAdmin) {
    return res.status(403).json({ error: 'Forbidden', message: 'Admin required' });
  }
  next();
}
