import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;

if (!url || !serviceRoleKey) {
  console.warn('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

export const supabaseAdmin = createClient(url || '', serviceRoleKey || '', { auth: { persistSession: false } });
export const supabaseAuth = createClient(url || '', anonKey || '', { auth: { persistSession: false } });
