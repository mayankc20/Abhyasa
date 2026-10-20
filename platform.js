/* Daybook platform layer.
   The page asks for capabilities through window.claude.use(name), the same way it did as a
   claude.ai artifact. On the phone those are served locally:
   - db, user, assets, downloads: IndexedDB on this device, nothing leaves the phone
   - sample: Claude, called directly with the API key saved in Settings */
(function(){
  const DB_NAME = "daybook", DB_VER = 1;
  let dbp = null;
  function idb(){
    if(dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        if(!d.objectStoreNames.contains("docs")) d.createObjectStore("docs", {keyPath:"docId"});
        if(!d.objectStoreNames.contains("blobs")) d.createObjectStore("blobs", {keyPath:"id"});
        if(!d.objectStoreNames.contains("settings")) d.createObjectStore("settings", {keyPath:"k"});
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  function tx(store, mode, fn){
    return idb().then(d => new Promise((res, rej) => {
      const t = d.transaction(store, mode), s = t.objectStore(store);
      let out; const r = fn(s); if(r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    }));
  }
  const getAll = store => tx(store, "readonly", s => s.getAll());

  /* settings */
  const settings = {
    get: k => tx("settings","readonly", s => s.get(k)).then(r => r ? r.v : null),
    set: (k, v) => tx("settings","readwrite", s => s.put({k, v}))
  };

  /* db: one private collection on this phone */
  const listeners = new Set();
  async function emit(){
    const docs = await getAll("docs");
    const snap = {docs: docs.map(d => ({id:d.docId, exists:true, data:() => { const {docId, ...rest} = d; return rest; }}))};
    snap.size = snap.docs.length; snap.empty = !snap.size;
    listeners.forEach(fn => { try{ fn(snap); }catch(e){ console.error(e); } });
  }
  function collection(){
    return {
      doc: id => ({
        id,
        set: async data => { await tx("docs","readwrite", s => s.put({...data, docId:id})); emit(); },
        delete: async () => { await tx("docs","readwrite", s => s.delete(id)); emit(); }
      }),
      onSnapshot(next){ listeners.add(next); emit(); return () => listeners.delete(next); }
    };
  }
  const db = {collection, doc: p => collection().doc(p.split("/").pop())};

  /* photos */
  const blobUrls = {};
  const blobsReady = getAll("blobs").then(rows => rows.forEach(r => { blobUrls[r.id] = URL.createObjectURL(r.blob); })).catch(()=>{});
  window.blobSrc = id => blobUrls[id] || "";
  const assets = {
    async upload(blob){
      const id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
      await tx("blobs","readwrite", s => s.put({id, blob}));
      blobUrls[id] = URL.createObjectURL(blob);
      return {id, url: blobUrls[id], sizeBytes: blob.size, contentType: blob.type};
    },
    async delete(id){ await tx("blobs","readwrite", s => s.delete(id)); if(blobUrls[id]) URL.revokeObjectURL(blobUrls[id]); delete blobUrls[id]; }
  };

  /* file download */
  const downloads = {
    async save({filename, data}){
      const blob = data instanceof Blob ? data : new Blob([data], {type:"application/json"});
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      return {saved:true};
    }
  };

  /* Claude with the user's own API key */
  const MODEL = "claude-opus-5-5";
  let clientP = null, clientKey = null;
  async function client(){
    const key = await settings.get("apiKey");
    if(!key) return null;
    if(!clientP || clientKey !== key){
      clientKey = key;
      clientP = import("./vendor/anthropic.mjs").then(m => new m.default({apiKey:key, dangerouslyAllowBrowser:true}));
    }
    return clientP;
  }
  const toMessages = input => typeof input === "string" ? [{role:"user", content:input}] : input;
  function params(input, opts){
    return {
      model: MODEL, max_tokens: 16000,
      output_config: {effort: opts && opts.modelTier === "quick" ? "low" : "medium"},
      betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      messages: toMessages(input)
    };
  }
  function failure(code, message, text){ const e = new Error(message); e.code = code; if(text) e.text = text; return e; }
  function wrapError(e){
    const s = e && e.status;
    if(s === 401) return failure("not_granted", "Your Claude API key was rejected. Check it in Settings.");
    if(s === 429) return failure("rate_limited", "Claude is busy. Try again in a minute.");
    if(!s) return failure("unavailable", "Couldn't reach Claude. Check your internet connection.");
    return failure("error", (e && e.message) || "Claude returned an error.");
  }
  async function makeSample(){
    const c = await client();
    if(!c) return null;
    async function sample(input, opts = {}){
      try{
        const stream = c.beta.messages.stream(params(input, opts), opts.signal ? {signal:opts.signal} : undefined);
        let text = "";
        stream.on("text", delta => { text += delta; if(opts.onText) opts.onText({text, delta}); });
        const msg = await stream.finalMessage();
        if(msg.stop_reason === "refusal") throw failure("refused", "Claude declined to answer this one.", text);
        return {text, truncated: msg.stop_reason === "max_tokens"};
      }catch(e){ throw e.code ? e : wrapError(e); }
    }
    sample.json = async (input, opts = {}) => {
      const r = await sample(input, opts);
      const t = r.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
      const start = t.search(/[\[{]/);
      try{ return JSON.parse(start > 0 ? t.slice(start) : t); }
      catch(e){ throw failure("invalid_json", "Claude's reply wasn't valid JSON.", r.text); }
    };
    sample.limits = async () => ({images:null});
    return sample;
  }

  const user = { id: async () => "me", isOwner: () => true, canEdit: () => true, can: () => true };
  const caps = { db: async () => db, user: async () => user, assets: async () => { await blobsReady; return assets; }, downloads: async () => downloads, sample: makeSample };
  window.claude = { use: name => (caps[name] ? caps[name]() : Promise.resolve(null)).catch(() => null) };

  /* Settings and backups, used by the Settings screen */
  window.daybook = {
    settings,
    async exportAll(){ return {app:"daybook", version:1, exportedAt:new Date().toISOString(), docs: await getAll("docs")}; },
    async importAll(obj){
      if(!obj || !Array.isArray(obj.docs)) throw new Error("That file isn't a Daybook backup.");
      await tx("docs","readwrite", s => { obj.docs.forEach(d => d && d.docId && s.put(d)); });
      emit(); return obj.docs.length;
    },
    async testKey(){ const s = await makeSample(); if(!s) throw new Error("No key saved."); const r = await s("Reply with the single word: ready", {modelTier:"quick"}); return r.text; },
    persist: () => navigator.storage && navigator.storage.persist ? navigator.storage.persist() : Promise.resolve(false)
  };

  if("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(()=>{}));
})();
