export const SUPABASE_URL = 'https://oxrxctztriezuonduteg.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_NEs5ai5ICc4Xkp3XtlLE3g_UNOl5HIr';

// Self-service signup is invite-only for now. This flag gates BOTH the
// #/signup route and the login screen's button. It is only a client-side
// convenience — the real enforcement is disabling email signups in the
// Supabase dashboard (Authentication → Providers → Email → "Enable signup").
export const SIGNUP_ENABLED = false;

