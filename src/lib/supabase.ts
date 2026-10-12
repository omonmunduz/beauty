import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);

// Owner sessions are stored under a dedicated key and wiped on logout (see auth.ts).
export const OWNER_AUTH_KEY = 'beauty-owner-auth';

export const supabase = createClient(url ?? 'http://localhost:55321', anonKey ?? 'missing-anon-key', {
  auth: {
    storageKey: OWNER_AUTH_KEY,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

export const functionsUrl = `${url ?? ''}/functions/v1`;
