/**
 * MemoryCare Hybrid Sync Engine v1.0
 * ─────────────────────────────────────────────────────────────────
 * Strategy:
 *   WRITE → localStorage ก่อนเสมอ (instant) → sync Supabase ใน background
 *   READ  → localStorage ก่อน → ถ้าว่างเปล่า ดึงจาก Supabase
 *   OFFLINE → เก็บ pending queue ไว้ → sync อัตโนมัติเมื่อ online กลับมา
 * ─────────────────────────────────────────────────────────────────
 *
 * วิธีใช้งาน:
 *   1. ใส่ไฟล์นี้ใน project และ <script src="hybrid-sync.js"></script>
 *      ต้องอยู่หลัง config.js และก่อน script หลักของแอป
 *
 *   2. อัปเดต config.js:
 *      DATABASE_MODE: "HYBRID"
 *      API_BASE_URL:  "https://xxxx.supabase.co"   ← จาก Supabase project
 *      API_KEY:       "eyJh..."                    ← anon/public key เท่านั้น
 *
 *   3. แทนที่ saveState() และ loadSavedState() ในไฟล์ HTML หลัก
 *      ด้วย HybridSync.save(appState) และ HybridSync.load()
 */

const HybridSync = (() => {

  // ── Keys ──────────────────────────────────────────────────────
  const LOCAL_KEY    = 'MemoryCare_AppState';
  const QUEUE_KEY    = 'MemoryCare_SyncQueue';
  const DEVICE_KEY   = 'MemoryCare_DeviceId';

  // ── Device ID (ระบุตัวตนของแต่ละ tablet) ─────────────────────
  function getDeviceId() {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      // Fallback for insecure contexts (like http IP test environments) where crypto.randomUUID is disabled
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        id = 'device_' + crypto.randomUUID();
      } else {
        id = 'device_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      }
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  }

  // ── Supabase REST helpers ─────────────────────────────────────
  function supabaseHeaders() {
    return {
      'Content-Type': 'application/json',
      'apikey': CONFIG.API_KEY,
      'Authorization': `Bearer ${CONFIG.API_KEY}`,
      'Prefer': 'resolution=merge-duplicates'   // upsert behavior
    };
  }

  function supabaseUrl(path) {
    return `${CONFIG.API_BASE_URL}/rest/v1${path}`;
  }

  // ── Pending Queue (สำหรับ offline writes) ────────────────────
  function getQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; }
    catch { return []; }
  }

  function addToQueue(payload) {
    const queue = getQueue();
    // เก็บแค่ snapshot ล่าสุด (ไม่จำเป็นต้องส่งทุก write)
    const existing = queue.findIndex(q => q.device_id === payload.device_id);
    if (existing >= 0) queue[existing] = payload;
    else queue.push(payload);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  }

  function clearQueue() {
    localStorage.removeItem(QUEUE_KEY);
  }

  // ── Push state ไป Supabase ───────────────────────────────────
  async function pushToSupabase(state) {
    if (typeof CONFIG === 'undefined' || CONFIG.DATABASE_MODE !== 'HYBRID') return;

    const payload = {
      device_id:   getDeviceId(),
      patient_id:  state.activePatientId || 'p_1',
      state_json:  JSON.stringify(state),
      synced_at:   new Date().toISOString()
    };

    try {
      const res = await fetch(supabaseUrl('/app_states'), {
        method: 'POST',
        headers: supabaseHeaders(),
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error(`Supabase ${res.status}`);

      clearQueue();                          // sync สำเร็จ → เคลียร์ queue
      updateDatabaseStatusUI('online');
      console.log('[HybridSync] ✅ Synced to Supabase');

    } catch (err) {
      addToQueue(payload);                   // offline → เก็บ queue ไว้
      updateDatabaseStatusUI('error');
      console.warn('[HybridSync] ⚠️ Offline — queued for later:', err.message);
    }
  }

  // ── Flush queue เมื่อ online กลับมา ─────────────────────────
  async function flushQueue() {
    const queue = getQueue();
    if (queue.length === 0) return;

    console.log(`[HybridSync] 🔄 Flushing ${queue.length} queued item(s)...`);

    for (const payload of queue) {
      try {
        const res = await fetch(supabaseUrl('/app_states'), {
          method: 'POST',
          headers: supabaseHeaders(),
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(`Status ${res.status}`);
      } catch {
        console.warn('[HybridSync] Queue flush failed — will retry later');
        return; // ยังออฟไลน์อยู่ หยุดก่อน
      }
    }

    clearQueue();
    updateDatabaseStatusUI('online');
    console.log('[HybridSync] ✅ Queue flushed successfully');
  }

  // ── โหลดข้อมูลจาก Supabase (ใช้ตอน local ว่างเปล่า) ────────
  async function pullFromSupabase() {
    if (typeof CONFIG === 'undefined' || CONFIG.DATABASE_MODE !== 'HYBRID') return null;

    try {
      const deviceId = encodeURIComponent(getDeviceId());
      const res = await fetch(
        supabaseUrl(`/app_states?device_id=eq.${deviceId}&order=synced_at.desc&limit=1`),
        { headers: supabaseHeaders() }
      );

      if (!res.ok) throw new Error(`Supabase ${res.status}`);

      const rows = await res.json();
      if (!rows || rows.length === 0) return null;

      const state = JSON.parse(rows[0].state_json);
      console.log('[HybridSync] ✅ Restored from Supabase backup');
      updateDatabaseStatusUI('online');
      return state;

    } catch (err) {
      console.warn('[HybridSync] ⚠️ Could not pull from Supabase:', err.message);
      updateDatabaseStatusUI('error');
      return null;
    }
  }

  // ── PUBLIC: save() ── แทนที่ saveState() เดิม ───────────────
  async function save(appState) {
    // 1. เขียน localStorage ก่อนเสมอ (ไม่มีวันล้มเหลว)
    const stateToSave = JSON.parse(JSON.stringify(appState));
    delete stateToSave.caregiverAuthenticated;
    localStorage.setItem(LOCAL_KEY, JSON.stringify(stateToSave));

    // 2. Sync ไป Supabase ใน background (non-blocking)
    pushToSupabase(stateToSave);
  }

  // ── PUBLIC: load() ── แทนที่ loadSavedState() เดิม ─────────
  async function load() {
    // 1. โหลด localStorage ก่อนเสมอ (เร็ว ไม่ต้องรอ network)
    const saved = localStorage.getItem(LOCAL_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        console.log('[HybridSync] 📦 Loaded from localStorage');
        updateDatabaseStatusUI('offline');

        // 2. Sync ไป Supabase ใน background (เผื่อ local ล้าหลัง)
        pushToSupabase(parsed);
        return parsed;
      } catch (e) {
        console.error('[HybridSync] Local parse error:', e);
      }
    }

    // 3. localStorage ว่างเปล่า → ดึงจาก Supabase (เช่น เปลี่ยนเครื่องใหม่)
    console.log('[HybridSync] 📡 No local data — pulling from Supabase...');
    updateDatabaseStatusUI('error');
    const remote = await pullFromSupabase();
    if (remote) {
      // เก็บลง localStorage ด้วยเลยสำหรับครั้งต่อไป
      const stateToCache = JSON.parse(JSON.stringify(remote));
      delete stateToCache.caregiverAuthenticated;
      localStorage.setItem(LOCAL_KEY, JSON.stringify(stateToCache));
    }
    return remote; // null ถ้าดึงไม่ได้เลย → แอปใช้ default state
  }

  // ── ฟัง online event → flush queue อัตโนมัติ ────────────────
  window.addEventListener('online', () => {
    console.log('[HybridSync] 🌐 Back online — attempting queue flush...');
    flushQueue();
  });

  // ── ส่งออก public API ────────────────────────────────────────
  return { save, load, getDeviceId, flushQueue };

})();
