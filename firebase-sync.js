/* firebase-sync.js — login (Firebase Authentication) + sincronização (Cloud Firestore).
 * Só roda se firebase-config.js estiver preenchido. Sem configuração, o app funciona
 * 100% local, como antes. Veja FIREBASE.md.
 */
(function () {
  'use strict';
  if (!window.FIREBASE_ENABLED || !window.SPSyncCore) return;

  var Core = window.SPSyncCore;
  var cfg = window.SP_FIREBASE;
  var SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
  var STATE_KEY = 'sp_sync_v1', DEVICE_KEY = 'sp_device_id', DEBOUNCE = 1500, SAFETY_MS = 10000;
  var root = document.documentElement;
  var $ = function (id) { return document.getElementById(id); };

  var fb = {};            // módulos do SDK
  var auth = null, fs = null, user = null, engine = null, unsub = null;
  var firstSnap = true, timer = null, lastRaw = null, safetyTimer = null, rerenderTimer = null;

  var deviceId = (function () {
    try {
      var d = localStorage.getItem(DEVICE_KEY);
      if (!d) { d = 'd' + Math.random().toString(36).slice(2, 10); localStorage.setItem(DEVICE_KEY, d); }
      return d;
    } catch (e) { return 'd' + Math.random().toString(36).slice(2, 10); }
  })();

  /* ---------- UI: cartão de login dentro do #authGate ---------- */
  function buildCard() {
    var gate = $('authGate'); if (!gate || $('fbCard')) return;
    var card = document.createElement('div');
    card.className = 'auth-card'; card.id = 'fbCard';
    card.innerHTML =
      '<div class="auth-logo" id="fbLogo">LK</div>' +
      '<h1 class="auth-title" id="fbTitle">Studio Pilates</h1>' +
      '<p class="auth-sub" id="fbSub">Entre com seu e-mail e senha.</p>' +
      '<form class="auth-form" id="fbForm" novalidate>' +
      '<label class="auth-label" for="fbEmail">E-mail</label>' +
      '<input class="auth-in" id="fbEmail" type="email" inputmode="email" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false">' +
      '<label class="auth-label" for="fbPass">Senha</label>' +
      '<input class="auth-in" id="fbPass" type="password" autocomplete="current-password">' +
      '<div class="auth-error" id="fbErr" role="alert" aria-live="assertive"></div>' +
      '<label class="auth-remember"><input type="checkbox" id="fbRemember" checked> Manter conectado neste dispositivo</label>' +
      '<button type="submit" class="auth-submit" id="fbSubmit">Entrar</button>' +
      '<button type="button" class="auth-link" id="fbForgot">Esqueci minha senha</button>' +
      '</form>' +
      '<div class="auth-foot"><span>Acesso restrito · dados protegidos na nuvem</span></div>';
    gate.appendChild(card);
    brand();
    $('fbForm').addEventListener('submit', onSubmit);
    $('fbForgot').addEventListener('click', onForgot);
  }
  function brand() {
    try {
      var bl = $('brandLogo'), bn = $('brandName');
      if (bl && bl.firstChild) { var l = $('fbLogo'); l.innerHTML = ''; Array.prototype.forEach.call(bl.childNodes, function (n) { l.appendChild(n.cloneNode(true)); }); }
      if (bn && bn.firstChild) { var t = $('fbTitle'); t.innerHTML = ''; Array.prototype.forEach.call(bn.childNodes, function (n) { t.appendChild(n.cloneNode(true)); }); }
    } catch (e) {}
  }
  function setErr(msg, ok) { var e = $('fbErr'); if (!e) return; e.textContent = msg || ''; e.classList.toggle('ok', !!ok); }
  function showLogin(msg) {
    root.classList.add('auth-locked');
    buildCard(); brand();
    var s = $('fbSubmit'); if (s) { s.disabled = false; s.textContent = 'Entrar'; }
    setErr(msg || '');
    setTimeout(function () { var i = $('fbEmail'); if (i && !i.value) i.focus(); }, 50);
  }
  function hideLogin() { root.classList.remove('auth-locked'); var p = $('fbPass'); if (p) p.value = ''; setErr(''); }

  function friendly(e) {
    var c = (e && e.code) || '';
    if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(c)) return 'E-mail ou senha incorretos.';
    if (/invalid-email/.test(c)) return 'E-mail inválido.';
    if (/too-many-requests/.test(c)) return 'Muitas tentativas. Aguarde alguns minutos ou redefina a senha.';
    if (/network/.test(c)) return 'Sem conexão com a internet.';
    if (/user-disabled/.test(c)) return 'Esta conta está desativada.';
    return 'Não foi possível entrar (' + (c || 'erro') + ').';
  }
  async function onSubmit(ev) {
    ev.preventDefault();
    var email = $('fbEmail').value.trim(), pass = $('fbPass').value;
    if (!email || !pass) { setErr('Informe e-mail e senha.'); return; }
    var btn = $('fbSubmit'); btn.disabled = true; btn.textContent = 'Entrando…'; setErr('');
    try {
      await fb.authMod.setPersistence(auth, $('fbRemember').checked ? fb.authMod.browserLocalPersistence : fb.authMod.browserSessionPersistence);
      await fb.authMod.signInWithEmailAndPassword(auth, email, pass);
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Entrar'; $('fbPass').value = '';
      setErr(friendly(e));
    }
  }
  async function onForgot() {
    var email = $('fbEmail').value.trim();
    if (!email) { setErr('Digite seu e-mail acima e toque novamente.'); $('fbEmail').focus(); return; }
    try { await fb.authMod.sendPasswordResetEmail(auth, email); setErr('Se o e-mail estiver cadastrado, enviamos o link de redefinição.', true); }
    catch (e) { setErr(friendly(e)); }
  }

  /* ---------- indicador de status ---------- */
  var chip = null;
  function injectStyle() {
    var st = document.createElement('style');
    st.textContent =
      '.sp-sync{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:650;color:var(--muted,#667085);padding:6px 10px;border:1px solid var(--line,#e5e7eb);border-radius:999px;background:var(--card,#fff);cursor:pointer;white-space:nowrap}' +
      '.sp-sync i{width:8px;height:8px;border-radius:50%;background:#16a34a;display:inline-block}' +
      '.sp-sync.syncing i{background:#2563eb;animation:spPulse 1s infinite}.sp-sync.offline i{background:#d97706}.sp-sync.error i{background:#dc2626}' +
      '@keyframes spPulse{50%{opacity:.35}}@media(prefers-reduced-motion:reduce){.sp-sync.syncing i{animation:none}}' +
      '@media(max-width:520px){.sp-sync span{display:none}}';
    document.head.appendChild(st);
  }
  function mountChip() {
    if (chip) return;
    var anchor = document.querySelector('.storage-status');
    chip = document.createElement('button');
    chip.type = 'button'; chip.className = 'sp-sync'; chip.id = 'spSyncChip';
    chip.innerHTML = '<i></i><span>Nuvem</span>';
    chip.addEventListener('click', function () { schedule(0); });
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(chip, anchor.nextSibling);
    else { chip.style.cssText += ';position:fixed;left:10px;bottom:10px;z-index:50'; document.body.appendChild(chip); }
  }
  var statusTexts = { ok: 'Sincronizado', syncing: 'Sincronizando…', offline: 'Offline', error: 'Erro de sincronização' };
  /* Enquanto sincroniza, o gerador automático de aulas fica em espera (window.__spCloudHold),
     para não criar aulas "novas" que já existem no outro aparelho. */
  var holdTimeout = null;
  function holdAgenda() { window.__spCloudHold = true; }
  function releaseAgenda() {
    clearTimeout(holdTimeout);
    if (!window.__spCloudHold) return;
    window.__spCloudHold = false;
    window.__agSig = null;                       // força o app a reavaliar a agenda com os dados completos
    clearTimeout(rerenderTimer);
    rerenderTimer = setTimeout(function () { try { if (typeof renderAll === 'function') renderAll(); } catch (e) {} }, 200);
  }
  function setStatus(kind, err) {
    if (kind === 'syncing') holdAgenda(); else releaseAgenda();
    if (!chip) return;
    chip.className = 'sp-sync ' + (kind === 'ok' ? '' : kind);
    chip.querySelector('span').textContent = statusTexts[kind] || kind;
    chip.title = (user && user.email ? user.email + ' — ' : '') + statusTexts[kind] +
      (kind === 'error' && err ? ' (' + (err.code || err.message) + ')' : '') + '. Toque para sincronizar agora.';
    if (kind === 'error' && err) console.warn('[sync]', err);
  }

  /* ---------- banco local ---------- */
  function getDB() { return (typeof db !== 'undefined') ? db : null; }
  /* Rede de segurança: duas aulas automáticas idênticas (mesmo aluno, data e horário), nunca
     editadas, são duplicatas geradas em aparelhos diferentes. Mantém a de menor id (decisão
     idêntica em todos os aparelhos, então convergem). */
  function dedupeAuto() {
    var D = getDB(); if (!D || !Array.isArray(D.classes)) return 0;
    var cand = D.classes.filter(function (c) { return c && c.auto && c.status === 'Agendada' && !c.updatedAt && c.studentId && c.date; })
      .sort(function (a, b) { return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0; });
    var seen = {}, drop = {}, n = 0;
    cand.forEach(function (c) { var k = c.studentId + '|' + c.date + '|' + c.time; if (seen[k]) { drop[c.id] = 1; n++; } else seen[k] = 1; });
    if (n) { var keep = D.classes.filter(function (c) { return !(c && drop[c.id]); }); D.classes.splice.apply(D.classes, [0, D.classes.length].concat(keep)); }
    return n;
  }
  function flushLocal() {
    var n = 0; try { n = dedupeAuto(); } catch (e) { console.warn('[sync] dedupe', e); }
    persistLocal();
    if (n) { schedule(200); clearTimeout(rerenderTimer); rerenderTimer = setTimeout(function () { try { renderAll(); } catch (e) {} }, 300); }
  }
  function persistLocal() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(getDB())); } catch (e) { console.warn('[sync] localStorage', e); }
    try { if (typeof saveStudentVault === 'function') saveStudentVault(getDB().students); } catch (e) {}
    lastRaw = localStorage.getItem(STORAGE_KEY);
  }
  function applyDoc(docId, items) {
    var D = getDB(); if (!D) return;
    if (docId === 'meta') { Object.keys(items).forEach(function (k) { D[k] = items[k]; }); }
    else {
      var col = docId.slice(0, docId.lastIndexOf('_'));
      var arr = D[col]; if (!Array.isArray(arr)) arr = D[col] = [];
      var out = [], seen = {};
      arr.forEach(function (it) {
        if (!it || typeof it !== 'object' || Core.docIdFor(col, it) !== docId) { out.push(it); return; }
        var id = Core.itemId(it);
        if (items[id] !== undefined) { out.push(items[id]); seen[id] = 1; }
      });
      Object.keys(items).forEach(function (id) { if (!seen[id]) out.push(items[id]); });
      arr.splice.apply(arr, [0, arr.length].concat(out));
    }
    clearTimeout(rerenderTimer);
    rerenderTimer = setTimeout(function () {
      try { if (typeof renderAll === 'function') renderAll(); } catch (e) { console.warn('[sync] render', e); }
    }, 300);
  }

  /* ---------- adaptador Firestore ---------- */
  function colRef() { return fb.fsMod.collection(fs, 'studios', user.uid, 'data'); }
  var adapter = {
    async write(docId, json, expectedRev) {
      var ref = fb.fsMod.doc(fs, 'studios', user.uid, 'data', docId);
      try {
        return await fb.fsMod.runTransaction(fs, async function (tx) {
          var snap = await tx.get(ref);
          var cur = snap.exists() ? (snap.data().rev || 0) : 0;
          if (cur !== expectedRev) return { ok: false, remote: { rev: cur, json: snap.data().json } };
          tx.set(ref, { json: json, rev: cur + 1, by: deviceId, updatedAt: fb.fsMod.serverTimestamp() });
          return { ok: true, rev: cur + 1 };
        });
      } catch (e) {
        if (e && (e.code === 'unavailable' || e.code === 'deadline-exceeded' || !navigator.onLine)) e.__net = true;
        throw e;
      }
    }
  };

  /* ---------- agendamento ---------- */
  function schedule(delay) {
    if (!engine) return;
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (!engine) return;
      if (!navigator.onLine) { setStatus('offline'); return; }
      engine.sync();
    }, delay == null ? DEBOUNCE : delay);
  }
  function hookSaveDB() {
    if (window.__spSaveHooked || typeof window.saveDB !== 'function') return;
    var orig = window.saveDB;
    window.saveDB = function () { var r = orig.apply(this, arguments); schedule(); return r; };
    window.__spSaveHooked = true;
  }

  async function startSync() {
    var D = getDB();
    for (var n = 0; !D && n < 100; n++) { await new Promise(function (r) { setTimeout(r, 100); }); D = getDB(); }
    if (!D) return;
    hookSaveDB();

    // Outra conta neste aparelho? Evita misturar dados de estúdios diferentes.
    var st = null; try { st = JSON.parse(localStorage.getItem(STATE_KEY)); } catch (e) {}
    if (st && st.uid && st.uid !== user.uid) {
      var temDados = (D.students || []).length || (D.classes || []).length || (D.finance || []).length;
      if (temDados && !window.confirm('Este aparelho contém dados de OUTRA conta. Entrar com esta conta vai substituí-los pelos dados dela.\n\nContinuar?')) {
        await fb.authMod.signOut(auth); return;
      }
      [typeof STORAGE_KEY !== 'undefined' ? STORAGE_KEY : null, typeof BACKUP_KEY !== 'undefined' ? BACKUP_KEY : null,
       typeof STUDENTS_STORAGE_KEY !== 'undefined' ? STUDENTS_STORAGE_KEY : null].forEach(function (k) { if (k) localStorage.removeItem(k); });
      localStorage.removeItem(STATE_KEY);
      location.reload(); return;
    }

    engine = new Core.Engine({
      adapter: adapter, getDB: getDB, applyDoc: applyDoc, flushLocal: flushLocal,
      store: {
        get: function () { try { return JSON.parse(localStorage.getItem(STATE_KEY)); } catch (e) { return null; } },
        set: function (o) { o.uid = user.uid; localStorage.setItem(STATE_KEY, JSON.stringify(o)); }
      },
      onStatus: setStatus
    });
    firstSnap = true;
    holdAgenda();
    holdTimeout = setTimeout(releaseAgenda, 8000);   // sem rede: libera para o uso offline
    setStatus('syncing');
    unsub = fb.fsMod.onSnapshot(colRef(), function (snap) {
      if (!engine) return;
      if (firstSnap) {
        firstSnap = false;
        var all = {};
        snap.docs.forEach(function (d) { all[d.id] = d.data(); });
        engine.setAllRemote(all);
      } else {
        snap.docChanges().forEach(function (ch) {
          engine.setRemote(ch.doc.id, ch.type === 'removed' ? null : ch.doc.data());
        });
      }
      schedule(firstSnap ? 0 : 300);
    }, function (err) {
      setStatus(err && err.code === 'permission-denied' ? 'error' : 'offline', err);
    });
    lastRaw = localStorage.getItem(STORAGE_KEY);
    safetyTimer = setInterval(function () {      // rede de segurança: pega gravações que não passaram por saveDB()
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw !== lastRaw) { lastRaw = raw; schedule(); }
    }, SAFETY_MS);
  }
  function stopSync() {
    if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
    clearInterval(safetyTimer); clearTimeout(timer); engine = null;
  }

  async function logout() {
    try { if (engine && navigator.onLine) await Promise.race([engine.sync(), new Promise(function (r) { setTimeout(r, 4000); })]); } catch (e) {}
    try { await fb.authMod.signOut(auth); } catch (e) { console.warn(e); }
  }

  /* ---------- inicialização ---------- */
  function boot() {
    injectStyle();
    buildCard();
    var lock = $('btnAuthLock');
    if (lock) lock.title = 'Sair da conta';
    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('#btnAuthLock')) { e.stopImmediatePropagation(); e.preventDefault(); logout(); }
    }, true);
    window.addEventListener('online', function () { schedule(500); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) schedule(500); });

    Promise.all([
      import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js')
    ]).then(function (m) {
      fb.appMod = m[0]; fb.authMod = m[1]; fb.fsMod = m[2];
      var app = fb.appMod.initializeApp(cfg);
      auth = fb.authMod.getAuth(app);
      fs = fb.fsMod.initializeFirestore(app, { experimentalAutoDetectLongPolling: true, ignoreUndefinedProperties: true });
      fb.authMod.onAuthStateChanged(auth, function (u) {
        user = u;
        if (u) { hideLogin(); mountChip(); startSync(); }
        else { stopSync(); showLogin(); }
      });
    }).catch(function (e) {
      console.error('[firebase]', e);
      showLogin('Não foi possível carregar o Firebase. Verifique a internet e recarregue a página.');
      var s = $('fbSubmit'); if (s) s.disabled = true;
    });
  }

  window.SPCloud = { syncNow: function () { schedule(0); }, signOut: logout };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
