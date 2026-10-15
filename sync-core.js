/* sync-core.js — motor de sincronização (independente do Firebase).
 *
 * Modelo: o app continua "local-first" (localStorage é a fonte da verdade no aparelho).
 * O banco (db) é dividido em documentos pequenos:
 *   - coleções de registros (students, classes, finance, makeups, waitlist) → "buckets"
 *     estáveis por id (ex.: classes_07), para respeitar o limite de 1 MiB por documento;
 *   - todo o resto (settings, plans, hours, ...) → um documento "meta".
 * A cada ciclo faz um merge de 3 vias (local × remoto × última versão sincronizada),
 * por registro, e só grava o que mudou. Nunca apaga dados por causa de documento ausente.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SPSyncCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var RECORDS = ['students', 'classes', 'finance', 'makeups', 'waitlist'];
  var BUCKETS = 32;
  var MAX_DOC_JSON = 900000;   // Firestore: 1 MiB por documento
  var POOL = 6;                // gravações simultâneas

  /* ---------- hash / serialização estável ---------- */
  function cyrb53(str) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
  function stable(v) {
    if (v === undefined) return 'null';
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    var ks = Object.keys(v).sort(), out = [];
    for (var i = 0; i < ks.length; i++) {
      if (v[ks[i]] !== undefined) out.push(JSON.stringify(ks[i]) + ':' + stable(v[ks[i]]));
    }
    return '{' + out.join(',') + '}';
  }
  function hash(v) { return cyrb53(stable(v)).toString(36); }
  function hashMap(items) {
    var o = {};
    if (!items) return o;
    Object.keys(items).forEach(function (id) { o[id] = hash(items[id]); });
    return o;
  }
  function sameMap(a, b) {
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (var i = 0; i < ka.length; i++) if (a[ka[i]] !== b[ka[i]]) return false;
    return true;
  }
  function isEmpty(o) { return !o || Object.keys(o).length === 0; }

  /* ---------- divisão do db em documentos ---------- */
  function itemId(it) { return it.id != null ? String(it.id) : 'h' + hash(it); }
  function docIdFor(col, it) {
    var b = cyrb53(itemId(it)) % BUCKETS;
    return col + '_' + (b < 10 ? '0' : '') + b;
  }
  function splitDB(db) {
    var docs = {};
    RECORDS.forEach(function (col) {
      var arr = db && db[col];
      if (!Array.isArray(arr)) return;
      arr.forEach(function (it) {
        if (!it || typeof it !== 'object') return;
        var d = docIdFor(col, it);
        (docs[d] = docs[d] || {})[itemId(it)] = it;
      });
    });
    var meta = {};
    Object.keys(db || {}).forEach(function (k) {
      if (RECORDS.indexOf(k) < 0 && db[k] !== undefined) meta[k] = db[k];
    });
    docs.meta = meta;
    return docs;
  }

  /* ---------- merge de 3 vias por id ---------- */
  function resolve(L, R, hasBase) {
    var a = L && L.updatedAt, b = R && R.updatedAt;
    if (a && b && a !== b) return String(a) > String(b) ? L : R;
    return hasBase ? L : R;   // empate: com histórico, local; aparelho novo, remoto
  }
  function merge3(local, remote, base) {
    var hasBase = !!base, remoteMissing = remote === null || remote === undefined;
    local = local || {}; remote = remote || {}; base = base || {};
    var ids = {}, result = {};
    [local, remote, base].forEach(function (o) { Object.keys(o).forEach(function (i) { ids[i] = 1; }); });
    Object.keys(ids).forEach(function (id) {
      var L = local[id], R = remote[id], B = base[id], pick;
      var hL = L === undefined ? null : hash(L), hR = R === undefined ? null : hash(R);
      if (remoteMissing) pick = L;                       // documento remoto não existe: nunca apagar
      else if (hL === hR) pick = L;
      else if (B === undefined) {                         // novo em pelo menos um dos lados
        pick = L === undefined ? R : R === undefined ? L : resolve(L, R, hasBase);
      } else if (hL === B) pick = R;                      // local não mudou → vale o remoto (inclui exclusão)
      else if (hR === B) pick = L;                        // remoto não mudou → vale o local (inclui exclusão)
      else pick = L === undefined ? R : R === undefined ? L : resolve(L, R, hasBase); // ambos mudaram: preserva dado
      if (pick !== undefined) result[id] = pick;
    });
    return { result: result, hashes: hashMap(result) };
  }

  /* ---------- motor ---------- */
  /* opts: adapter{write(docId,json,expectedRev)->{ok,rev}|{ok:false,remote:{rev,json}}},
           getDB(), applyDoc(docId,items), store{get(),set(obj)}, onStatus(kind,err) */
  function Engine(opts) {
    this.adapter = opts.adapter;
    this.getDB = opts.getDB;
    this.applyDoc = opts.applyDoc;
    this.store = opts.store;
    this.onStatus = opts.onStatus || function () {};
    this.flushLocal = opts.flushLocal || function () {};
    var st = this.store.get();
    this.state = st && st.docs ? st : { uid: null, docs: {} };
    this.remote = {};
    this.running = null;
    this.again = false;
    this.applied = 0;
  }
  Engine.prototype._persist = function () { try { this.store.set(this.state); } catch (e) {} };
  Engine.prototype.setRemote = function (docId, data) {
    if (!data) { delete this.remote[docId]; return; }
    var cur = this.remote[docId];
    if (cur && cur.rev >= data.rev) return;
    var items;
    try { items = JSON.parse(data.json || '{}'); } catch (e) { items = {}; }
    this.remote[docId] = { rev: data.rev || 0, items: items };
  };
  Engine.prototype.setAllRemote = function (map) {
    this.remote = {};
    var self = this;
    Object.keys(map).forEach(function (id) { self.setRemote(id, map[id]); });
  };
  Engine.prototype.sync = function () {
    var self = this;
    if (self.running) { self.again = true; return self.running; }
    self.running = (async function () {
      try {
        do { self.again = false; await self._cycle(); } while (self.again);
        self.onStatus('ok');
      } catch (e) {
        self.onStatus(e && e.__net ? 'offline' : 'error', e);
      } finally {
        // Ordem importa: primeiro grava os dados locais, depois o estado de sincronização.
        // Assim o estado nunca afirma que algo está sincronizado se o aparelho ainda não o guardou.
        if (self.applied) { try { self.flushLocal(); } catch (e) {} self.applied = 0; }
        self._persist();
        self.running = null;
      }
    })();
    return self.running;
  };
  Engine.prototype._cycle = async function () {
    var self = this, local = splitDB(self.getDB()), lh = {}, work = [];
    var ids = {};
    [local, self.remote, self.state.docs].forEach(function (o) { Object.keys(o).forEach(function (k) { ids[k] = 1; }); });
    Object.keys(ids).forEach(function (id) {
      var items = local[id] || {}, st = self.state.docs[id], rem = self.remote[id];
      lh[id] = hashMap(items);
      if (!rem && isEmpty(items)) { if (st) delete self.state.docs[id]; return; }
      if (st && rem && st.rev === rem.rev && sameMap(lh[id], st.h)) return;
      work.push(id);
    });
    if (!work.length) return;
    self.onStatus('syncing');
    var firstErr = null, i = 0;
    async function worker() {
      while (i < work.length) {
        var id = work[i++];
        try { await self._syncDoc(id, local[id] || {}, lh[id]); }
        catch (e) { if (!firstErr) firstErr = e; }
      }
    }
    var ws = [];
    for (var k = 0; k < Math.min(POOL, work.length); k++) ws.push(worker());
    await Promise.all(ws);
    if (firstErr) throw firstErr;
  };
  Engine.prototype._syncDoc = async function (docId, localItems, localHashes) {
    var st = this.state.docs[docId];
    for (var attempt = 0; attempt < 6; attempt++) {
      if (attempt > 0) {                       // reconsulta o estado local (pode ter mudado durante a rede)
        localItems = splitDB(this.getDB())[docId] || {};
        localHashes = hashMap(localItems);
      }
      var rem = this.remote[docId];
      var m = merge3(localItems, rem ? rem.items : null, st ? st.h : undefined);
      var remHashes = rem ? hashMap(rem.items) : {};
      if (!sameMap(m.hashes, localHashes)) { this.applyDoc(docId, JSON.parse(JSON.stringify(m.result))); this.applied++; }  // cópia: o cache remoto nunca compartilha objetos com o banco local
      if (!rem && isEmpty(m.result)) { delete this.state.docs[docId]; return; }
      if (rem && sameMap(m.hashes, remHashes)) {
        st = this.state.docs[docId] = { rev: rem.rev, h: m.hashes };
        return;
      }
      var json = JSON.stringify(m.result);
      if (json.length > MAX_DOC_JSON) {
        var big = new Error('Documento ' + docId + ' excede o limite do Firestore'); big.code = 'too-large'; throw big;
      }
      var res = await this.adapter.write(docId, json, rem ? rem.rev : 0);
      if (res.ok) {
        this.remote[docId] = { rev: res.rev, items: JSON.parse(json) };
        st = this.state.docs[docId] = { rev: res.rev, h: m.hashes };
        return;
      }
      this.remote[docId] = { rev: res.remote.rev, items: JSON.parse(res.remote.json || '{}') };  // conflito → refaz o merge
    }
    var e = new Error('Conflito persistente em ' + docId); e.code = 'conflict'; throw e;
  };

  return {
    RECORDS: RECORDS, BUCKETS: BUCKETS, Engine: Engine,
    splitDB: splitDB, merge3: merge3, hash: hash, hashMap: hashMap,
    docIdFor: docIdFor, itemId: itemId, cyrb53: cyrb53
  };
});
