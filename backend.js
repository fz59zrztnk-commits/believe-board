/* Believe Board sync layer: Supabase behind a tiny Firestore-style API the board already speaks. */
(function(){
"use strict";
const cfg = window.BB_CONFIG || {};
const configured = !!(cfg.SUPABASE_URL && /^https:\/\//.test(cfg.SUPABASE_URL) && cfg.SUPABASE_ANON_KEY && !/PASTE/.test(cfg.SUPABASE_ANON_KEY));
let resolveReady; const ready = new Promise(r => resolveReady = r);
window.BB = { ready, configured, sb:null, signOut:null };
if (!configured || !window.supabase) return;

const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
  auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:false }
});
window.BB.sb = sb;
const ref = new URL(cfg.SUPABASE_URL).hostname.split(".")[0];
const TOKEN_KEY = "sb-"+ref+"-auth-token";

function storedUid(){
  try { const t = JSON.parse(localStorage.getItem(TOKEN_KEY)||"null"); return t && t.user && t.user.id || null; } catch(e){ return null; }
}
const isRetryable = e => {
  if (!navigator.onLine) return true;
  const m = String((e && (e.message||e.error_description)) || e || "");
  const st = e && (e.status || e.statusCode);
  return /fetch|network|load failed|timeout|jwt|expired|token/i.test(m) || st===401 || st===0 || st>=500 || (e && e.code==="PGRST301");
};

function makeDb(uid){
  const QKEY = "bb-pending-ops-"+uid;
  let pending = []; try { pending = JSON.parse(localStorage.getItem(QKEY)||"[]"); } catch(e){}
  const savePending = () => { try { localStorage.setItem(QKEY, JSON.stringify(pending)); } catch(e){} };
  const listeners = new Set();
  const timers = {};
  let flushing = false;

  async function exec(op){
    if (op.t === "set"){
      const { error } = await sb.from("docs").upsert(
        { user_id:uid, collection:op.c, id:op.id, data:op.data, updated_at:new Date().toISOString() },
        { onConflict:"user_id,collection,id" });
      if (error) throw error;
    } else {
      const { error } = await sb.from("docs").delete().match({ user_id:uid, collection:op.c, id:op.id });
      if (error) throw error;
    }
  }
  async function flushPending(){
    if (flushing) return; flushing = true;
    try {
      while (pending.length){
        try { await exec(pending[0]); pending.shift(); savePending(); }
        catch(e){ if (isRetryable(e)) break; console.warn("dropped op", e); pending.shift(); savePending(); }
      }
    } finally { flushing = false; }
    setStatus();
  }
  async function write(op){
    // coalesce: newer op for same doc replaces older queued op
    pending = pending.filter(p => !(p.c===op.c && p.id===op.id));
    pending.push(op); savePending(); setStatus();
    await flushPending();
  }
  function overlay(c, rows){
    const map = new Map(rows.map(r => [r.id, r.data]));
    pending.filter(p => p.c===c).forEach(p => { if (p.t==="set") map.set(p.id, p.data); else map.delete(p.id); });
    return map;
  }
  async function refresh(c){
    clearTimeout(timers[c]);
    timers[c] = setTimeout(async () => {
      const { data, error } = await sb.from("docs").select("id,data").eq("collection", c);
      if (error) { setStatus(error); return; }
      const map = overlay(c, data||[]);
      const meta = { fromCache:false, hasPendingWrites:false };
      listeners.forEach(l => {
        if (l.c !== c) return;
        if (l.id){
          const has = map.has(l.id), body = map.get(l.id);
          l.next({ id:l.id, exists:has, data:()=>body, metadata:meta });
        } else {
          const docs = [...map.entries()].map(([id,body]) => ({ id, exists:true, data:()=>body, metadata:meta }));
          l.next({ docs, size:docs.length, empty:!docs.length, metadata:meta, docChanges:()=>[] });
        }
      });
      setStatus();
    }, 120);
  }
  const refreshAll = () => new Set([...listeners].map(l => l.c)).forEach(refresh);
  function sub(c, id, next){ const l = {c, id, next}; listeners.add(l); refresh(c); return () => listeners.delete(l); }
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2));
  function docRef(c, id){
    return { id, path:c+"/"+id,
      set: data => write({ t:"set", c, id, data:JSON.parse(JSON.stringify(data)) }),
      update: data => write({ t:"set", c, id, data:JSON.parse(JSON.stringify(data)) }),
      delete: () => write({ t:"del", c, id }),
      onSnapshot: (next) => sub(c, id, next) };
  }
  const db = {
    doc(path){ const [c,id] = path.split("/"); return docRef(c,id); },
    collection(c){ return { path:c, doc:(id)=>docRef(c, id||uuid()), onSnapshot:(next)=>sub(c,null,next) }; }
  };

  // realtime + fallbacks
  try {
    sb.channel("docs-"+uid)
      .on("postgres_changes", { event:"*", schema:"public", table:"docs", filter:"user_id=eq."+uid }, p => {
        const c = (p.new && p.new.collection) || (p.old && p.old.collection);
        if (c) refresh(c); else refreshAll();
      }).subscribe();
  } catch(e){}
  window.addEventListener("online", () => { flushPending().then(refreshAll); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState==="visible"){ flushPending().then(refreshAll); } });
  setInterval(() => { if (document.visibilityState==="visible") flushPending().then(refreshAll); }, 60000);
  sb.auth.onAuthStateChange(ev => { if (ev==="TOKEN_REFRESHED" || ev==="SIGNED_IN") flushPending(); });

  function setStatus(err){
    const el = document.getElementById("sync"); if (!el) return;
    if (!navigator.onLine) el.textContent = "offline · "+(pending.length? pending.length+" change(s) will sync" : "saved on this device");
    else if (pending.length) el.textContent = "syncing "+pending.length+"…";
    else if (err) el.textContent = "can't reach sync right now · saved on this device";
    else el.textContent = "synced across your devices";
  }
  flushPending();
  return db;
}

const assets = {
  async upload(file, opts){
    const type = (opts && opts.type) || file.type || "application/octet-stream";
    const uid = storedUid();
    const safe = String(file.name||"file").replace(/[^\w.\-]+/g,"_").slice(-80);
    const path = uid+"/"+(crypto.randomUUID? crypto.randomUUID() : Date.now())+"-"+safe;
    const { error } = await sb.storage.from("files").upload(path, file, { contentType:type, upsert:false });
    if (error){
      const m = String(error.message||""); const st = error.statusCode || error.status;
      throw { code: (st==413 || /too large|exceeded the maximum/i.test(m)) ? "too_large" : /mime|type/i.test(m) ? "unsupported_type" : /quota/i.test(m) ? "quota_or_state" : "upstream_error", message:m };
    }
    return { id:path, url:null, sizeBytes:file.size, contentType:type };
  },
  async delete(id){ const { error } = await sb.storage.from("files").remove([id]); if (error) throw { code:"upstream_error" }; return { deleted:true }; },
  async url(id){ const { data, error } = await sb.storage.from("files").createSignedUrl(id, 3600); if (error) throw error; return data.signedUrl; }
};

let started = false;
function start(uid){
  if (started || !uid) return; started = true;
  document.documentElement.classList.remove("needs-auth");
  resolveReady({ db: makeDb(uid), assets });
}
window.BB.signOut = async () => {
  try { await sb.auth.signOut(); } catch(e){}
  try { localStorage.removeItem(TOKEN_KEY); } catch(e){}
  location.reload();
};

// Gate: stored session → in immediately (works offline). Otherwise show sign-in.
const uid0 = storedUid();
if (uid0) start(uid0); else document.documentElement.classList.add("needs-auth");
sb.auth.onAuthStateChange((ev, session) => {
  if (session && session.user) start(session.user.id);
  if (ev === "SIGNED_OUT" && started) location.reload();
});

// sign-in form
function wireAuth(){
  const f = document.getElementById("authForm"); if (!f) return;
  const msg = document.getElementById("authMsg");
  let mode = "in";
  const toggle = document.getElementById("authToggle");
  toggle.addEventListener("click", () => {
    mode = mode==="in" ? "up" : "in";
    document.getElementById("authTitle").textContent = mode==="in" ? "Sign in" : "Create your account";
    document.getElementById("authGo").textContent = mode==="in" ? "Sign in" : "Create account";
    toggle.textContent = mode==="in" ? "First time? Create an account" : "Have an account? Sign in";
    msg.textContent = "";
  });
  f.addEventListener("submit", async e => {
    e.preventDefault();
    const email = document.getElementById("authEmail").value.trim(), password = document.getElementById("authPass").value;
    const go = document.getElementById("authGo"); go.disabled = true; msg.textContent = mode==="in" ? "Signing in…" : "Creating account…";
    try {
      const res = mode==="in" ? await sb.auth.signInWithPassword({ email, password }) : await sb.auth.signUp({ email, password });
      if (res.error) throw res.error;
      if (mode==="up" && !res.data.session) msg.textContent = "Account made. Check your email to confirm, or turn off 'Confirm email' in Supabase, then sign in.";
    } catch(err){
      const m = String(err.message||err);
      msg.textContent = /invalid login/i.test(m) ? "Email or password is wrong." : /already registered/i.test(m) ? "That email already has an account. Sign in instead." : /password/i.test(m) ? m : navigator.onLine ? m : "You're offline. Connect to sign in the first time.";
    }
    go.disabled = false;
  });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireAuth); else wireAuth();
})();
