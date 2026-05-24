// MemoryCare Global Configuration Object
// ─────────────────────────────────────────────────────────────────
// DATABASE_MODE:
//   "OFFLINE" → localStorage เท่านั้น ไม่มี network
//   "HYBRID"  → localStorage + Supabase backup (แนะนำ)
//   "ONLINE"  → Supabase เป็นหลัก (ต้องออนไลน์เสมอ)

window.CONFIG = {
  DATABASE_MODE: "HYBRID",

  // Supabase Project URL — ดูได้จาก Project Settings → API
  API_BASE_URL: "https://gsvgcrvtnukmpkvaffne.supabase.co",

  // Supabase anon/public key — ใช้ตัวนี้เท่านั้น (ไม่ใช่ service_role!)
  API_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdzdmdjcnZ0bnVrbXBrdmFmZm5lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2MTExODksImV4cCI6MjA5NTE4NzE4OX0.cyyWD5B2Bfft4IhISF6jenAvUeySfQjps9xKeiMes6s",

  // รอบ sync อัตโนมัติ (ms) — 0 = ปิด ใช้เฉพาะ event-driven
  SYNC_INTERVAL_MS: 0
};
