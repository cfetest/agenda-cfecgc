/* =====================================================================
   Agenda public CFE-CGC Orange Fonctions Corp - interface de la page
   Donnees : window.EVENTS, ecrit dans index.html par fetch-agenda.ps1. Cles d'un rendez-vous :
     t titre, u lien, d date aaaa-mm-jj, h horaire ("08h00 - 10h30"), g libelle, x extrait,
     a 1 = communication email, l lieu + p [lat, lon] (ou v teams|distance|inconnu),
     r zone du lieu idf|ne|no|se|so (filtre "Lieu"), m mode p|d|h (presentiel, distanciel, hybride ;
     absent = non detecte), j jours en plus.
   Trois onglets exclusifs pilotent la colonne gauche (dates + frise 8h-20h, calendrier mensuel,
   carte) ; la colonne droite montre les cartes de la selection, ou le panneau Filtres.
   Recherche et filtres s'appliquent aux trois vues.
   1. Outils  2. Rendez-vous  3. Filtres et recherche  4. Etat  5. Cartes d'evenements
   6. Prochains evenements  7. Calendrier  8. Carte  9. Panneau Filtres  10. Evenements, demarrage
   ===================================================================== */
(function () {
  'use strict';
  var ALL = window.EVENTS || [];
  // iPhone / iPad : Safari zoome sur une liste ou un champ en moins de 16 px ; maximum-scale=1 l'en empeche
  // (le zoom a deux doigts reste possible sur iOS). Pas sur Android, ou cela bloquerait le zoom.
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
    var vp = document.querySelector('meta[name=viewport]');
    if (vp && !/maximum-scale/.test(vp.content)) vp.content += ', maximum-scale=1';
  }
  function $(id) { return document.getElementById(id); }
  function each(sel, fn, root) { Array.prototype.forEach.call((root || document).querySelectorAll(sel), fn); }

  /* ---------- 1. Outils ---------- */
  // Couleurs pastel des rendez-vous d'une journee, par ordre de debut (frise et bordure des cartes)
  var COLORS = ['#a8d8a0', '#9fd4dc', '#abc3ef', '#d0abea', '#f2aebf', '#e9d08c', '#9fd3bb', '#c4c4d4'];
  var UNI = '#9fd19a';   // couleur unique des cartes de l'onglet Agenda
  // Page d'abonnement aux communications (bouton "S'abonner" du site cfecgc-orange.org)
  var SUBSCRIBE = 'https://odyssee.cfecgc-orange.org/com/page/1387';
  var MODES = { p: 'Présentiel', d: 'Distanciel / Teams', h: 'Hybride', u: 'Non détecté' };
  var H0 = 8, H1 = 20, HH = 40;   // frise : 8h-20h, 40 px par heure
  // "Moment de convivialite" (filtre) : mots cherches dans le titre seul, sans accents ni majuscules
  var RE_CONV = /\b(accueils? cafes?|cafes? gourmands?|cafes? croissants?|pause cafe|cafe|petits?[ -]dejeuners?|dejeuners?|brunch|cocktails?|aperitifs?|apero|afterwork|after[ -]work|gouters?|buffet|collation|verre de l.amitie|pot de l.amitie|moments? convivia\w*|convivialite)\b/;
  var fLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  var fChip = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  var fMonth = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
  var fSpan = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });   // 10/11/26
  var fShort = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function pd(k) { var p = k.split('-'); return new Date(+p[0], p[1] - 1, +(p[2] || 1)); }
  function dkey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function weekday(k) { var w = pd(k).getDay(); return w > 0 && w < 6; }
  function longDay(k) { return cap(fLong.format(pd(k))); }
  function nRdv(n) { return n + ' rendez-vous'; }
  var TODAY = dkey(new Date());

  var IC = (function () {
    var a = ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
    function s(w, d) { return '<svg width="' + w + '" height="' + w + '" viewBox="0 0 24 24"' + a + '>' + d + '</svg>'; }
    return {
      pin: s(14, '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
      p: s(14, '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>'),
      d: s(14, '<rect x="2.5" y="6" width="13" height="12" rx="2"/><path d="m15.5 10.5 6-3.5v10l-6-3.5"/>'),
      h: s(14, '<rect x="2.5" y="4" width="19" height="12" rx="2"/><path d="M8 20h8M12 16v4"/><circle cx="12" cy="9" r="2.2"/><path d="M8.5 14a3.5 3.5 0 0 1 7 0"/>'),
      chev: s(16, '<path d="m9 18 6-6-6-6"/>'),
      back: s(14, '<path d="m15 18-6-6 6-6"/>'),
      prev: s(18, '<path d="m15 18-6-6 6-6"/>'),
      next: s(18, '<path d="m9 18 6-6-6-6"/>'),
      x: s(16, '<path d="M6 6l12 12M18 6 6 18"/>'),
      funnel: s(18, '<path d="M3 5h18l-7 8.5V19l-4 2v-7.5z"/>'),
      info: s(14, '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5h.01"/>'),
      gps: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 10.6 20.5 3.5l-7.1 17-2.3-7.6z"/></svg>'
    };
  })();

  /* ---------- 2. Rendez-vous : horaires, durees, couleurs ---------- */
  function hm(s) { var m = /(\d{1,2})\s*h\s*(\d{2})?/i.exec(s || ''); return m ? +m[1] + (+(m[2] || 0)) / 60 : null; }
  ALL.forEach(function (e, i) {
    e.id = i;
    var p = (e.h || '').split('-');
    e.s = hm(p[0]); e.e = p.length > 1 ? hm(p.slice(1).join('-')) : null;
    if (e.j && e.s != null && e.s < 18) e.e = 18;   // plusieurs jours : bloc du debut jusqu'a 18h
    e.dur = '';
    if (e.s != null && e.e != null && e.e > e.s) {
      var mn = Math.round((e.e - e.s) * 60), hh = Math.floor(mn / 60), mm = mn % 60;
      e.dur = hh ? hh + 'h' + (mm ? pad(mm) : '') : mm + 'min';
      if (e.j) e.dur += '+';                       // se poursuit les jours suivants
    }
    e.nt = e.s == null;                            // sans horaire : pas de bloc dans la frise
    e.sk = e.nt ? 99 : e.s;                        // cle de tri (sans horaire : en fin de journee)
    e.mo = e.m || 'u';
    // Moment de convivialite : seulement si le TITRE l'annonce (un evenement d'un autre genre peut offrir un cafe en bonus)
    e.cv = RE_CONV.test(norm(e.t));
    // Texte de recherche : titre, description (intervenants compris), lieu, libelle (pas pour les mails)
    // + k, texte complet de la page detail (intervenants...), jamais affiche
    e.txt = norm([e.t, e.x, e.l, e.a ? '' : e.g, e.k].join(' | '));
  });
  function byTime(a, b) { return a.sk - b.sk || (a.e || 0) - (b.e || 0) || a.id - b.id; }
  // Couleur fixe par jour et par ordre de debut : identique dans la frise, les cartes et toutes les vues
  (function () {
    var g = {};
    ALL.forEach(function (e) { (g[e.d] = g[e.d] || []).push(e); });
    Object.keys(g).forEach(function (k) { g[k].sort(byTime).forEach(function (e, i) { e.c = COLORS[i % COLORS.length]; }); });
  })();
  // Termine : jour passe, ou aujourd'hui et derniere heure de "h" atteinte (fin, sinon debut ;
  // jamais sans horaire). Plusieurs jours : seulement apres le dernier jour.
  function ended(e) {
    var n = new Date(), k = dkey(n);
    if (e.j) { var p = e.d.split('-'); return dkey(new Date(+p[0], p[1] - 1, +p[2] + e.j)) < k; }
    if (e.d !== k) return e.d < k;
    var t = (e.h || '').match(/\d{1,2}\s*h\s*\d{0,2}/gi);
    if (!t) return false;
    var m = /(\d{1,2})\s*h\s*(\d{0,2})/i.exec(t[t.length - 1]);
    return n.getHours() * 60 + n.getMinutes() >= +m[1] * 60 + (+(m[2] || 0));
  }
  // Horaire affiche. Plusieurs jours : debut - 18h00 puis "(+N jours)"
  // Horaire court (mobile) : "16:00-17:00", plusieurs jours "14:00-18:00 (+3 j)"
  function timeShort(e) {
    if (!e.h) return 'Horaire non précisé';
    var t = (e.h.match(/\d{1,2}\s*h\s*\d{0,2}/gi) || []).map(function (x) {
      var m = /(\d{1,2})\s*h\s*(\d{0,2})/i.exec(x); return pad(+m[1]) + ':' + (m[2] ? pad(+m[2]) : '00');
    });
    if (!t.length) return esc(e.h);
    if (e.j) return t[0] + '-18:00 (+' + e.j + ' j)';
    return t.join('-');
  }
  function timeText(e) {
    if (!e.h) return 'Horaire non précisé';
    if (!e.j) return esc(e.h);
    var s = /\d{1,2}\s*h\s*\d{0,2}/i.exec(e.h);
    return (s ? esc(s[0]) + ' - 18h00' : esc(e.h)) + ' (+' + e.j + (e.j > 1 ? ' jours' : ' jour') + ')';
  }
  // Libelles jamais affiches : "Calendrier national" (deja dans la pastille) et "Evenement externe"
  function isNat(g) { var s = String(g || '').trim().toLowerCase(); return s === 'calendrier national' || /^.v.nements? externes?$/.test(s); }

  /* ---------- 3. Filtres (appliques / temporaires) et recherche ---------- */
  var DEF = { nat: true, mail: true, p: true, d: true, u: true, cv: true, lieu: '' };   // d = distanciel ET hybride (un seul filtre)
  function copyF(f) { var o = {}; for (var k in DEF) o[k] = f[k]; return o; }
  function sameF(a, b) { for (var k in DEF) if (a[k] !== b[k]) return false; return true; }
  // Filtre "Lieu" par zone (cle r, calculee d'apres le departement dans fetch-agenda.ps1)
  var ZONES = [['idf', 'Île-de-France'], ['ne', 'Nord-Est'], ['no', 'Nord-Ouest'], ['se', 'Sud-Est'], ['so', 'Sud-Ouest'],
               ['co', 'Corse'], ['hm', 'Hors Métropole']];
  var F = copyF(DEF);   // filtres appliques, memorises sur l'appareil
  try {
    var sv = JSON.parse(localStorage.getItem('agFiltre') || 'null');
    if (sv) for (var k in DEF) if (typeof sv[k] === typeof DEF[k]) F[k] = sv[k];
    if (F.lieu && !ZONES.some(function (z) { return z[0] === F.lieu; })) F.lieu = '';
  } catch (x) {}
  function fmode(e) { return e.mo === 'h' ? 'd' : e.mo; }   // filtre : hybride range avec distanciel / Teams
  function pass(e, f) { return (e.a ? f.mail : f.nat) && f[fmode(e)] && (f.cv || !e.cv) && (!f.lieu || e.r === f.lieu); }
  var Q = [];
  function hit(e) { for (var i = 0; i < Q.length; i++) if (e.txt.indexOf(Q[i]) < 0) return false; return true; }

  /* ---------- 4. Etat de l'interface (garde pour l'onglet, y compris au rechargement auto) ---------- */
  var S = { tab: 'jour', dJour: null, dCal: null, calOff: null, place: null, geo: true, sort: 'heure', q: '',
            sel: null, panel: false, tf: null, info: false };
  var KEEP = ['tab', 'dJour', 'dCal', 'calOff', 'place', 'geo', 'sort', 'q'];
  try {
    var vv = JSON.parse(sessionStorage.getItem('agVue') || 'null');
    if (vv) KEEP.forEach(function (k) { if (k in vv) S[k] = vv[k]; });
  } catch (x) {}
  if (['jour', 'cal', 'carte'].indexOf(S.tab) < 0) S.tab = 'jour';
  if (['heure', 'lieu'].indexOf(S.sort) < 0) S.sort = 'heure';
  function save() {
    var o = {}; KEEP.forEach(function (k) { o[k] = S[k]; });
    try { sessionStorage.setItem('agVue', JSON.stringify(o)); } catch (x) {}
  }

  var VIS = [], BYDAY = {};
  function compute() {
    Q = norm(S.q).split(/\s+/).filter(Boolean);
    VIS = ALL.filter(function (e) { return pass(e, F) && hit(e); });
    BYDAY = {};
    VIS.forEach(function (e) { (BYDAY[e.d] = BYDAY[e.d] || []).push(e); });
    for (var k in BYDAY) BYDAY[k].sort(byTime);
  }
  function narrowed() { return Q.length > 0 || !sameF(F, DEF); }

  /* ---------- 5. Cartes d'evenements (meme composant dans les trois onglets) ---------- */
  var rp = $('rpane');
  function srcTag(e) {
    // libelles longs (PC) et courts (mobile : "national", "mail", "terminé"), le CSS choisit
    return '<span class="src' + (e.a ? ' src-mail' : '') + '">' + (e.a ? '<span class="lg">Communication email</span><span class="sh">mail</span>' : '<span class="lg">Calendrier national</span><span class="sh">national</span>') + '</span>'
      + (ended(e) ? '<span class="src src-end"><span class="lg">événement </span>terminé</span>' : '');
  }
  function modeTag(e) {
    if (!e.m || !MODES[e.m]) return '';
    var t = e.m === 'd' ? (/\bteams\b/.test(e.txt) ? 'Teams' : 'Distanciel') : MODES[e.m];
    return '<span class="it ev-mode">' + IC[e.m] + t + '</span>';
  }
  // uni : couleur unique (onglet Agenda, ou rien ne demande de distinguer les rendez-vous)
  // open : carte depliee d'office (journee de moins de 3 rendez-vous)
  function card(e, uni, open) {
    var on = S.sel === e.id;
    // Communication email : aucun lien publie, lien vers l'inscription aux listes de diffusion
    var link = e.a ? '<a class="ev-link" href="' + SUBSCRIBE + '" target="_blank" rel="noopener">Liste de diffusion →</a>'
      : e.u ? '<a class="ev-link" href="' + esc(e.u) + '"' + (/^mailto:/i.test(e.u) ? '' : ' target="_blank" rel="noopener"') + '>Voir le détail →</a>' : '';
    return '<article class="ev' + (on ? ' sel' : '') + (open ? ' open' : '') + (ended(e) ? ' ended' : '') + '" data-id="' + e.id + '" style="--ev:' + (uni ? UNI : e.c) + '" tabindex="0" aria-expanded="' + !!(on || open) + '">'
      + '<div class="ev-top"><span class="ev-time"><span class="lg">' + timeText(e) + '</span><span class="sh">' + timeShort(e) + '</span></span>' + srcTag(e) + '</div>'
      + '<div class="ev-ttl">' + esc(e.t) + '</div>'
      + '<div class="ev-meta">' + (e.l ? '<span class="it ev-loc">' + IC.pin + esc(e.l) + '</span>' : '') + modeTag(e)
      + (!e.a && e.g && !isNat(e.g) ? '<span class="it ev-tag">' + esc(e.g) + '</span>' : '') + link + '</div>'
      + (e.x ? '<p class="ev-more">' + esc(e.x) + '</p>' : '')
      + '<span class="ev-chev" aria-hidden="true">' + IC.chev + '</span></article>';
  }
  function sortList(list) {
    var l = list.slice();
    // mobile : pas de choix du tri (place), toujours par heure
    if (S.sort === 'lieu' && !MOBILE.matches) l.sort(function (a, b) { return (a.l ? 0 : 1) - (b.l ? 0 : 1) || (a.l || '').localeCompare(b.l || '', 'fr') || byTime(a, b); });
    else l.sort(byTime);
    return l;
  }
  function cardsHtml(list, uni, open) { return '<div class="cards">' + sortList(list).map(function (e) { return card(e, uni, open); }).join('') + '</div>'; }
  function todayPill(k) { return k === TODAY ? ' <span class="tpill">aujourd’hui</span>' : ''; }
  // Liste sur plusieurs jours (mois entier, lieu) : un titre par jour, cartes en retrait dessous
  function groupedHtml(list, uni) {
    var g = {}, days = [];
    list.forEach(function (e) { if (!g[e.d]) { g[e.d] = []; days.push(e.d); } g[e.d].push(e); });
    return days.sort().map(function (d) { return '<h3 class="dayh">' + longDay(d) + todayPill(d) + '</h3>' + cardsHtml(g[d], uni); }).join('');
  }
  function sortSel(n) {
    if (n < 2) return '';
    var o = [['heure', 'heure'], ['lieu', 'lieu']];
    return '<label class="sort">Trier par <select id="sortSel">' + o.map(function (x) {
      return '<option value="' + x[0] + '"' + (S.sort === x[0] ? ' selected' : '') + '>' + x[1] + '</option>';
    }).join('') + '</select></label>';
  }
  function head(title, n, extra) {
    return '<div class="rhead"><h2>' + title + (n != null ? ' <span class="n">(' + nRdv(n) + ')</span>' : '') + '</h2>' + (extra || '') + '</div>';
  }
  function body(html) { return '<div class="rbody">' + html + '</div>'; }
  function empty(msg) { return '<p class="empty">' + msg + '</p>'; }
  function emptyDay(k) {
    if (ALL.some(function (e) { return e.d === k; })) return 'Aucun rendez-vous ne correspond aux filtres ou à la recherche pour cette date.';
    return k === TODAY ? 'Aucun événement n’est encore prévu aujourd’hui.' : 'Aucun rendez-vous ce jour-là.';
  }
  function dayRight(k, uni) {
    var list = BYDAY[k] || [];
    // peu de rendez-vous : cartes depliees d'office (PC : moins de 3 ; telephone : seulement s'il n'y en a qu'un)
    return head(longDay(k) + todayPill(k), list.length, sortSel(list.length)) + body(list.length ? cardsHtml(list, uni, MOBILE.matches ? list.length === 1 : list.length < 3) : empty(emptyDay(k)));
  }
  function renderRight() {
    var html;
    if (S.panel) html = panelHtml();
    else if (S.tab === 'jour') html = S.dJour ? dayRight(S.dJour) : head('Prochains événements') + body(empty(narrowed() ? 'Aucun rendez-vous ne correspond aux filtres ou à la recherche.' : 'Aucun rendez-vous à venir.'));
    else if (S.tab === 'cal') html = rightCal();
    else html = rightCarte();
    rp.innerHTML = html;
    rp.scrollTop = 0;
    $('fltBtn').setAttribute('aria-expanded', S.panel);
    document.body.classList.toggle('panel-open', S.panel);   // mobile : panneau du bas + fond assombri
    // Mobile (une colonne) : si la liste a ete remplacee alors qu'on avait defile plus bas que son debut,
    // on remonte a son titre (sous la barre fixe) au lieu de laisser l'ecran au milieu de nulle part
    if (MOBILE.matches && !S.panel) {
      var top = rp.getBoundingClientRect().top - topH();
      if (top < 0) window.scrollBy(0, top - 8);
    }
  }
  var MOBILE = window.matchMedia('(max-width: 900px)');   // telephone et tablette : interface tactile
  // Hauteur de la barre fixe du haut (titre + onglets), pour ne rien cacher dessous
  function topH() { var t = document.querySelector('.topbar'); return MOBILE.matches && t ? t.offsetHeight : 0; }
  // Selection d'un rendez-vous : bloc de la frise et carte mis en evidence ensemble, carte developpee
  function selectEvent(id, reveal) {
    S.sel = S.sel === id ? null : id;
    each('.cols [data-id]', function (x) {
      var on = +x.getAttribute('data-id') === S.sel;
      x.classList.toggle('sel', on);
      if (x.classList.contains('ev')) x.setAttribute('aria-expanded', on || x.classList.contains('open'));
    });
    if (S.sel != null && reveal) {
      var c = rp.querySelector('.ev[data-id="' + id + '"]');
      if (c) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    // Onglet Carte (PC et mobile) : ouvrir un rendez-vous recentre la carte sur son lieu, quelle que
    // soit la liste affichee (tous les lieux, un lieu, a distance)
    var ev = S.sel != null ? ALL[S.sel] : null;
    if (ev && ev.p && S.tab === 'carte' && map) {
      var mk = markers[ev.p.join(',')];
      if (mk && layer.zoomToShowLayer) layer.zoomToShowLayer(mk, function () { map.panTo(ev.p); });
      else map.setView(ev.p, Math.max(map.getZoom(), 11));
    }
  }

  // Toucher / clic sur une carte : depliee (d'office ou choisie) -> on la replie ; repliee -> on la choisit et la deplie
  function toggleCard(c) {
    var id = +c.getAttribute('data-id');
    if (c.classList.contains('open')) {
      c.classList.remove('open');
      if (S.sel === id) selectEvent(id, false); else c.setAttribute('aria-expanded', false);
    } else selectEvent(id, false);
  }

  /* ---------- 6. Prochains evenements : selecteur de dates et frise horaire ---------- */
  var chipsEl = $('chips'), planEl = $('plan');
  var jDates = [], jPer = 3;
  function chipLabel(k) {   // "Jeu 19 Nov" (Jjj et Mmm, sans point)
    return fChip.format(pd(k)).replace(/\./g, '').split(' ').map(cap).join(' ');
  }
  // Dates affichees : autant que la largeur le permet (jusqu'a 7) sans couper "Mer 18 Nov" ni
  // "3 rendez-vous" : on essaie 7, puis 6... tant qu'un libelle deborde de sa case
  function chipsHtml(per) {
    var idx = jDates.indexOf(S.dJour), page = Math.floor(idx / per), html = '';
    chipsEl.style.setProperty('--n', per);
    jDates.slice(page * per, page * per + per).forEach(function (d) {
      var n = (BYDAY[d] || []).length, on = d === S.dJour;
      html += '<li><button type="button" class="chip' + (on ? ' sel' : '') + (d === TODAY ? ' today' : '') + '" data-d="' + d + '" aria-pressed="' + on + '">'
        + (d === TODAY ? '<i class="today-tag">Aujourd’hui</i>' : '')
        + '<span class="cd">' + chipLabel(d) + '</span><span class="cn">' + nRdv(n) + '</span></button></li>';
    });
    chipsEl.innerHTML = html;
    $('prev').disabled = page === 0;
    $('next').disabled = page >= Math.ceil(jDates.length / per) - 1;
  }
  function chipsOverflow() {
    return [].some.call(chipsEl.querySelectorAll('.chip'), function (c) { return c.scrollWidth > c.clientWidth + 1; });
  }
  function renderJour() {
    // jours ouvres avec rendez-vous (selon filtres et recherche), a partir d'aujourd'hui ;
    // aujourd'hui sans rendez-vous n'apparait pas, sauf s'il n'y a aucun rendez-vous du tout
    // (il porte alors le message "Aucun evenement n'est encore prevu aujourd'hui.")
    jDates = Object.keys(BYDAY).filter(function (d) { return weekday(d) && d >= TODAY; });
    if (!jDates.length) jDates.push(TODAY);
    jDates.sort();
    if (!S.dJour || jDates.indexOf(S.dJour) < 0) {
      var want = S.dJour && S.dJour > TODAY ? S.dJour : TODAY;
      S.dJour = jDates.filter(function (d) { return d >= want; })[0] || jDates[jDates.length - 1];
    }
    for (jPer = 7; jPer > 2; jPer--) { chipsHtml(jPer); if (!chipsOverflow()) break; }
    if (jPer === 2) chipsHtml(2);
    planEl.innerHTML = planHtml(BYDAY[S.dJour] || [], S.dJour);
    fitDurations();
  }
  // Duree dans un bloc de la frise : seulement si elle tient en largeur (sinon bloc sans texte)
  function fitDurations() {
    each('.pblk > span', function (s) { if (s.scrollWidth > s.parentNode.clientWidth - 2) s.remove(); }, planEl);
  }
  function jourPage(step) {
    var page = Math.floor(jDates.indexOf(S.dJour) / jPer) + step;
    var d = jDates[Math.max(0, Math.min(jDates.length - 1, page * jPer))];
    if (d) pickJour(d);
  }
  function pickJour(d) {
    S.dJour = d;
    if (S.sel != null && !(BYDAY[d] || []).some(function (e) { return e.id === S.sel; })) S.sel = null;
    renderJour(); renderRight(); save();
    // telephone : nouveau jour (date, fleches, glisser) = frise et cartes remises en haut de la page
    if (MOBILE.matches) window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  // Frise : position et hauteur proportionnelles aux horaires ; rendez-vous simultanes cote a cote.
  // Groupes de rendez-vous qui se chevauchent -> colonnes (premiere colonne libre) ; tous les blocs
  // d'un groupe ont la largeur du groupe. 4 px entre colonnes, 2 px entre blocs qui se suivent.
  // Plus de 5 colonnes : blocs serres, sans la duree.
  function planHtml(list, day) {
    var HH = MOBILE.matches ? 30 : 40;   // px par heure : frise plus courte sur telephone
    var blocks = [];
    list.forEach(function (e) {
      if (e.nt) return;
      var s = Math.min(Math.max(e.s, H0), H1 - 0.25);
      var f = e.e != null && e.e > e.s ? e.e : e.s + 1;
      // mobile : bloc d au moins 20 px de haut pour que la duree ("30min") s y lise ; compte aussi pour les chevauchements
      var minH = MOBILE.matches ? 22 / HH : 0.25;
      blocks.push({ e: e, s: s, f: Math.max(Math.min(f, H1), s + minH) });
    });
    blocks.sort(function (a, b) { return a.s - b.s || b.f - a.f; });
    var cur = null, end = -1;
    blocks.forEach(function (b) {
      if (!cur || b.s >= end - 1e-6) { cur = { lanes: [] }; end = b.f; } else end = Math.max(end, b.f);
      var l = 0;
      while (l < cur.lanes.length && cur.lanes[l] > b.s + 1e-6) l++;
      cur.lanes[l] = b.f; b.lane = l; b.grp = cur;
    });
    var h = '<div class="plan" style="--hh:' + HH + 'px">', t;
    for (t = H0; t <= H1; t++) h += '<span class="ph" style="top:' + (t - H0) * HH + 'px">' + pad(t) + 'h</span>';
    blocks.forEach(function (b) {
      var e = b.e, n = b.grp.lanes.length, top = (b.s - H0) * HH + 1, ht = Math.max((b.f - b.s) * HH - 2, 8);
      // telephone : 5 rendez-vous ou plus cote a cote = aucun libelle dans ce groupe (sinon certains blocs en ont, d'autres pas)
      // libelle : la duree ; sans heure de fin (duree inconnue), l'heure de debut ("08h30")
      var lbl = e.dur || (e.s != null ? pad(Math.floor(e.s)) + 'h' + pad(Math.round((e.s % 1) * 60)) : '');
      var txt = ht >= (MOBILE.matches ? 18 : 16) && lbl && !(MOBILE.matches && n >= 5) ? '<span>' + lbl + '</span>' : '';
      h += '<div class="pblk' + (n > 5 ? ' tight' : '') + (ended(e) ? ' ended' : '') + (S.sel === e.id ? ' sel' : '') + '" role="button" tabindex="0"'
        + ' data-id="' + e.id + '" aria-label="' + esc(e.t + ', ' + (e.h || '')) + '"'
        + ' style="--ev:' + e.c + ';top:' + top + 'px;height:' + ht + 'px;left:calc(' + (100 * b.lane / n) + '% + 2px);width:calc(' + (100 / n) + '% - 4px)">' + txt + '</div>';
    });
    if (day === TODAY) {
      var n = new Date(), tn = n.getHours() + n.getMinutes() / 60;
      if (tn > H0 && tn < H1) h += '<div class="pnow" style="top:' + (tn - H0) * HH + 'px"></div>';
    }
    h += '</div>';
    var nt = list.filter(function (e) { return e.nt; }).length;
    if (nt) h += '<p class="pnote">' + nRdv(nt) + ' sans horaire précisé : voir la liste.</p>';
    return h;
  }

  /* ---------- 7. Agenda : calendrier mensuel (lundi-vendredi) ---------- */
  var calEl = $('vCal');
  var NOW = new Date();
  function offOf(k) { return (+k.slice(0, 4) - NOW.getFullYear()) * 12 + (+k.slice(5, 7) - 1 - NOW.getMonth()); }
  // Navigation : du mois courant au mois du dernier rendez-vous connu (toutes origines)
  var MAXOFF = Math.max(0, offOf(ALL.map(function (e) { return e.d; }).sort().pop() || TODAY));
  function renderCal() {
    // dCal : 'aaaa-mm-jj' (un jour) ou 'aaaa-mm' (le mois entier, clic sur le nom du mois)
    if (!S.dCal) S.dCal = S.dJour || TODAY;
    if (S.dCal < TODAY.slice(0, S.dCal.length)) S.dCal = S.dJour || TODAY;
    if (S.calOff == null) S.calOff = offOf(S.dCal);
    S.calOff = Math.max(0, Math.min(MAXOFF, S.calOff));
    var first = new Date(NOW.getFullYear(), NOW.getMonth() + S.calOff, 1), mk = dkey(first).slice(0, 7);
    var html = '<div class="mbar">'
      + '<button type="button" class="nav" data-nav="-1" aria-label="Mois précédent"' + (S.calOff <= 0 ? ' disabled' : '') + '>' + IC.prev + '</button>'
      + '<button type="button" class="mtitle' + (S.dCal === mk ? ' sel' : '') + '" data-m="' + mk + '" aria-pressed="' + (S.dCal === mk) + '">' + esc(fMonth.format(first)) + '</button>'
      + '<button type="button" class="nav" data-nav="1" aria-label="Mois suivant"' + (S.calOff >= MAXOFF ? ' disabled' : '') + '>' + IC.next + '</button>'
      + '</div><div class="mgrid">' + ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven'].map(function (x) { return '<div class="mhd">' + x + '</div>'; }).join('');
    var d = new Date(first), started = false, total = 0;
    while (d.getMonth() === first.getMonth()) {
      var w = d.getDay();
      if (w > 0 && w < 6) {
        if (!started) { for (var b = 1; b < w; b++) html += '<span></span>'; started = true; }
        var k = dkey(d), n = (BYDAY[k] || []).length, on = k === S.dCal;
        total += n;
        // jours sans rendez-vous non cliquables (sauf aujourd'hui : message "aucun evenement prevu")
        html += '<button type="button" class="mday' + (n ? ' has' : '') + (k < TODAY ? ' past' : '') + (k === TODAY ? ' today' : '') + (on ? ' sel' : '') + '" data-d="' + k + '"'
          + (n || k === TODAY ? '' : ' disabled') + ' aria-pressed="' + on + '" aria-label="' + esc(longDay(k)) + ' : ' + nRdv(n) + '">'
          + '<span class="num">' + d.getDate() + '</span>' + (n ? '<span class="cnt">' + n + '</span>' : '') + '</button>';
      }
      d.setDate(d.getDate() + 1);
    }
    html += '</div><p class="mhint">' + nRdv(total) + ' ce mois-ci<span class="lg"> - cliquez</span><span class="sh">.<br>Cliquez</span> sur le nom du mois pour tous les afficher.</p>';
    calEl.innerHTML = html;
  }
  function rightCal() {
    var k = S.dCal;
    if (k.length === 7) {
      var list = VIS.filter(function (e) { return e.d.slice(0, 7) === k; });
      return head(cap(fMonth.format(pd(k))), list.length, sortSel(list.length))
        + body(list.length ? groupedHtml(list, true) : empty('Aucun rendez-vous ce mois-ci.'));
    }
    return dayRight(k, true);
  }

  /* ---------- 8. Carte des evenements (Leaflet + OpenStreetMap, regroupement selon le zoom) ---------- */
  var map = null, layer = null, markers = {}, fitted = false, PLACES = {};
  function places() {
    var g = {};
    VIS.forEach(function (e) {
      if (!e.p) return;
      var k = e.p.join(','), o = g[k] || (g[k] = { k: k, p: e.p, names: [], list: [] });
      o.list.push(e);
      if (e.l && o.names.indexOf(e.l) < 0) o.names.push(e.l);
    });
    return g;
  }
  function spanText(list) {
    var ds = list.map(function (e) { return e.d; }).sort();
    if (!ds.length) return '';
    var a = fSpan.format(pd(ds[0])), z = fSpan.format(pd(ds[ds.length - 1]));
    return '(' + a + (z !== a ? ' - ' + z : '') + ')';
  }
  function renderCarte() {
    PLACES = places();
    if (S.place && !PLACES[S.place]) S.place = null;
    var geo = VIS.filter(function (e) { return e.p; }).length, off = VIS.length - geo;
    $('mapBar').innerHTML = '<span class="gps">' + IC.gps + '</span>'
      + '<button type="button" class="geo-sw' + (S.geo ? ' on' : '') + '" role="switch" aria-checked="' + S.geo + '">'
      + '<span class="lbl">événements géolocalisés</span><span class="cnt">' + geo + '</span>'
      + '<span class="sw" aria-hidden="true"><span class="knob"></span></span></button>'
      + '<span class="mapspan">' + spanText(VIS) + '</span>'
      + (S.geo ? '' : '<span class="geo-off">à distance ou non géolocalisés : ' + off + '</span>');
    if (ensureMap()) drawMarkers();
  }
  function ensureMap() {
    if (!window.L) { $('map').innerHTML = '<p class="empty">La carte n’a pas pu être chargée.</p>'; return false; }
    if (!map) {
      map = L.map('map', { zoomSnap: 0.5 }).setView([46.6, 2.4], 5.5);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
      }).addTo(map);
      // Regroupement : les lieux proches fusionnent (total de leurs rendez-vous) et se separent en zoomant
      layer = L.markerClusterGroup ? L.markerClusterGroup({
        showCoverageOnHover: false, maxClusterRadius: 50, spiderfyOnMaxZoom: true,
        iconCreateFunction: function (c) {
          var n = 0; c.getAllChildMarkers().forEach(function (m) { n += m.options.n; });
          return L.divIcon({ className: 'mpin mclu', html: '<span>' + n + '</span>', iconSize: [40, 40], iconAnchor: [20, 20] });
        }
      }) : L.layerGroup();
      layer.addTo(map);
    }
    map.invalidateSize();   // la carte etait peut-etre cachee (onglet) : recalculer sa taille
    return true;
  }
  function drawMarkers() {
    if (!map) return;
    layer.clearLayers(); markers = {};
    if (!S.geo) return;
    var pts = [];
    Object.keys(PLACES).forEach(function (k) {
      var g = PLACES[k], n = g.list.length, on = k === S.place;
      var m = L.marker(g.p, { n: n, keyboard: true, title: g.names.join(' / '), zIndexOffset: on ? 1000 : 0,
        icon: L.divIcon({ className: 'mpin' + (on ? ' sel' : ''), html: '<span>' + n + '</span>', iconSize: [32, 32], iconAnchor: [16, 16] }) });
      if (on) m.bindTooltip('<b>' + esc(g.names.join(' / ')) + '</b><br>' + nRdv(n), { permanent: true, direction: 'right', offset: [18, 0], className: 'mtip' });
      m.on('click', function () { pickPlace(S.place === k ? null : k, false); });
      layer.addLayer(m); markers[k] = m; pts.push(g.p);
    });
    if (!fitted && pts.length) { map.fitBounds(pts, { padding: [30, 30], maxZoom: 9 }); fitted = true; }
  }
  function pickPlace(k, fromList) {
    S.place = k;
    drawMarkers(); renderRight(); save();
    if (k && fromList && markers[k]) {
      if (layer.zoomToShowLayer) layer.zoomToShowLayer(markers[k]); else map.panTo(PLACES[k].p);
    }
    // Telephone : toucher un numero sur la carte descend jusqu'aux rendez-vous de ce lieu (liste sous la carte)
    if (k && !fromList && MOBILE.matches) {
      window.scrollTo({ top: window.scrollY + rp.getBoundingClientRect().top - topH() - 8, behavior: 'smooth' });
    }
  }
  function rightCarte() {
    var off = VIS.filter(function (e) { return !e.p; });
    if (!S.geo) {
      return head('À distance ou non géolocalisés', off.length, sortSel(off.length))
        + body(off.length ? groupedHtml(off) : empty('Aucun rendez-vous.'));
    }
    if (S.place && PLACES[S.place]) {
      var g = PLACES[S.place];
      return head(esc(g.names.join(' / ')), g.list.length, sortSel(g.list.length) + '<button type="button" class="lnk-btn" data-place="">' + IC.back + 'Tous les lieux</button>')
        + body(groupedHtml(g.list));
    }
    var ks = Object.keys(PLACES).sort(function (a, b) {
      return PLACES[b].list.length - PLACES[a].list.length || PLACES[a].names.join().localeCompare(PLACES[b].names.join(), 'fr');
    });
    function row(k) {
      var g = PLACES[k], ds = g.list.map(function (e) { return e.d; }).sort();
      var when = fShort.format(pd(ds[0])) + (ds[ds.length - 1] !== ds[0] ? ' - ' + fShort.format(pd(ds[ds.length - 1])) : '');
      return '<li><button type="button" class="place-row" data-place="' + k + '"><span class="pi">' + IC.pin + '</span>'
        + '<span class="pn"><b>' + esc(g.names.join(' / ')) + '</b><small>' + when + '</small></span>'
        + '<span class="cnt">' + g.list.length + '</span>' + IC.chev + '</button></li>';
    }
    // Lieux groupes par zone (memes zones que le filtre, dans le meme ordre), en retrait sous leur zone
    var zones = ZONES.concat([['', 'Zone non identifiée']]);
    var rows = zones.map(function (z) {
      var zk = ks.filter(function (k) { return (PLACES[k].list[0].r || '') === z[0]; });
      return zk.length ? '<h3 class="dayh">' + z[1] + '</h3><ul class="places">' + zk.map(row).join('') + '</ul>' : '';
    }).join('');
    return head('Lieux des événements', null, '<span class="hsub">' + ks.length + ' lieu' + (ks.length > 1 ? 'x' : '') + '</span>')
      + body((ks.length ? '<p class="hint">Choisissez un lieu sur la carte ou dans la liste.</p>' + rows : empty('Aucun rendez-vous géolocalisé.'))
        + (off.length ? '<button type="button" class="place-row off" data-geo="off"><span class="pi">' + IC.d + '</span><span class="pn"><b>À distance ou non géolocalisés</b><small>non placés sur la carte</small></span><span class="cnt">' + off.length + '</span>' + IC.chev + '</button>' : ''));
  }

  /* ---------- 9. Panneau Filtres (dans la colonne droite) ---------- */
  // Etat temporaire S.tf pendant l'edition ; F (filtres appliques) ne change qu'avec "Appliquer"
  function tfCount() { return ALL.filter(function (e) { return pass(e, S.tf) && hit(e); }).length; }
  // Categories du panneau Filtres : [cle, libelle, test]. Ajouter une origine ou un mode = ajouter une ligne.
  var ORIGINS = [['nat', 'Calendrier national', function (e) { return !e.a; }], ['mail', 'Communications email', function (e) { return e.a; }]];
  // Mode dans les filtres : distanciel / Teams et hybride fusionnes en une seule case
  var MODE_OPTS = [['p', MODES.p], ['d', 'Distanciel / Teams / Hybride'], ['u', MODES.u]].map(function (o) {
    return [o[0], o[1], function (e) { return fmode(e) === o[0]; }];
  });
  function panelHtml() {
    var f = S.tf, base = ALL.filter(hit), n = tfCount();
    function cnt(fn) { return base.filter(fn).length; }
    function chk(k, label, c) {
      return '<label class="chk"><input type="checkbox" data-k="' + k + '"' + (f[k] ? ' checked' : '') + '><span>' + label + '</span><span class="c">(' + c + ')</span></label>';
    }
    // Un groupe n'est propose que s'il distingue vraiment quelque chose : au moins 2 categories ayant
    // chacune au moins 1 rendez-vous. Les categories a 0 sont cachees (sauf si elles sont decochees :
    // on doit toujours pouvoir les recocher), et le groupe reste affiche tant qu'une case est decochee.
    var showInfo = false;
    function group(legend, opts) {
      var rows = opts.map(function (o) { return { o: o, c: cnt(o[2]) }; });
      var full = rows.filter(function (r) { return r.c > 0; }).length;
      var off = rows.some(function (r) { return !f[r.o[0]]; });
      if (full < 2 && !off) return '';
      return '<fieldset class="fgrp"><legend>' + legend + '</legend>' + rows.map(function (r) {
        if (!r.c && f[r.o[0]]) return '';
        if (r.o[0] !== 'u') return chk(r.o[0], r.o[1], r.c);
        showInfo = true;
        return '<div class="chkrow">' + chk('u', r.o[1], r.c)
          + '<button type="button" class="info" id="fInfo" aria-expanded="' + S.info + '" aria-controls="fNote" aria-label="Que signifie « Non détecté » ?">' + IC.info + '</button></div>';
      }).join('') + '</fieldset>';
    }
    // Lieu : zones ayant des rendez-vous (plus celle deja choisie) ; liste cachee s'il y en a moins de 2
    var zones = ZONES.map(function (z) { return { z: z, c: cnt(function (e) { return e.r === z[0]; }) }; })
      .filter(function (x) { return x.c > 0 || f.lieu === x.z[0]; });
    var lieu = zones.filter(function (x) { return x.c > 0; }).length < 2 && !f.lieu ? ''
      : '<div class="fgrp"><label class="lgd" for="fLieu">Lieu (quand identifié)</label><div class="fsel">' + IC.pin
        + '<select id="fLieu"><option value="">Tous les lieux</option>' + zones.map(function (x) {
            return '<option value="' + x.z[0] + '"' + (f.lieu === x.z[0] ? ' selected' : '') + '>' + x.z[1] + ' (' + x.c + ')</option>';
          }).join('') + '</select></div></div>';
    // Moment de convivialite : une case (cochee = les cafes, dejeuners, cocktails... sont affiches, decochee = masques).
    // Proposee seulement s'il y a des rendez-vous des deux sortes (convivialite et autre), ou si la case est decochee.
    var nCv = cnt(function (e) { return e.cv; }), nOther = cnt(function (e) { return !e.cv; });
    var conv = (nCv && nOther) || !f.cv ? '<fieldset class="fgrp"><legend>Moment de convivialité</legend>'
      + chk('cv', 'Afficher les cafés, déjeuners…', nCv) + '</fieldset>' : '';
    var groups = group('Origine des événements', ORIGINS) + group('Mode de participation', MODE_OPTS) + conv + lieu;
    return '<div class="fpanel" role="region" aria-labelledby="fTitle">'
      + '<div class="rhead"><h2 id="fTitle">' + IC.funnel + 'Filtres <span class="n" id="fRes">(' + n + ' résultat' + (n > 1 ? 's' : '') + ')</span></h2>'
      + '<button type="button" class="xbtn" id="fClose" aria-label="Fermer les filtres sans les appliquer">' + IC.x + '</button></div>'
      + '<div class="fgrid">' + (groups || '<p class="empty">Aucun filtre utile : tous les rendez-vous affichés sont de la même sorte.</p>') + '</div>'
      + (showInfo ? '<p class="fnote" id="fNote"' + (S.info ? '' : ' hidden') + '>' + IC.info + '<span>« Non détecté » : le mode de participation n’a pas pu être identifié à partir des informations disponibles (quand il faut cliquer sur un bouton dans un mail pour obtenir l’information par exemple).</span></p>' : '')
      + '<div class="ffoot"><button type="button" class="btn" id="fReset"' + (sameF(f, DEF) ? ' disabled' : '') + '>Réinitialiser (afficher tout)</button>'
      + '<button type="button" class="btn btn-pri" id="fApply"' + (n ? '' : ' disabled') + '>' + applyTxt(n) + '</button></div>'
      + '</div>';
  }
  // "Appliquer les filtres (3 éléments masqués)" : nombre de rendez-vous que les filtres retirent de l'affichage
  function applyTxt(n) {
    var x = ALL.filter(hit).length - n;
    return x ? 'Appliquer les filtres (' + x + (x > 1 ? ' éléments masqués)' : ' élément masqué)') : 'Sortir du menu (aucun élément n’est masqué)';
  }
  function refreshPanelCount() {
    var n = tfCount();
    $('fRes').textContent = '(' + n + ' résultat' + (n > 1 ? 's' : '') + ')';
    $('fApply').textContent = applyTxt(n);
    $('fApply').disabled = !n;
    $('fReset').disabled = sameF(S.tf, DEF);   // rien a reinitialiser
  }
  function openPanel() { S.panel = true; S.tf = copyF(F); renderRight(); var c = rp.querySelector('input,select,button'); if (c) c.focus(); }
  function closePanel() { S.panel = false; S.tf = null; renderRight(); $('fltBtn').focus(); }
  function applyPanel() {
    if (S.tf.lieu !== F.lieu) fitted = false;   // zone changee : la carte se recadre sur ses lieux
    F = copyF(S.tf);
    try { localStorage.setItem('agFiltre', JSON.stringify(F)); } catch (x) {}
    S.panel = false; S.tf = null;
    update();
    $('fltBtn').focus();
  }

  /* ---------- 10. Mise a jour, evenements, demarrage ---------- */
  function renderHeader() {
    var b = $('fltBtn');
    // Pas de compteur : une pastille "filtre actif" (entonnoir barre) quand des filtres masquent des rendez-vous
    var on = !sameF(F, DEF);
    $('fltN').innerHTML = on ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 12h12"/></svg><span class="sr">(filtres actifs : des rendez-vous sont masqués)</span>' : '';
    b.classList.toggle('act', !sameF(F, DEF));
    $('qClear').hidden = !S.q;
    $('qKey').hidden = !!S.q;
  }
  function renderLeft() { if (S.tab === 'jour') renderJour(); else if (S.tab === 'cal') renderCal(); else renderCarte(); }
  function update() { compute(); renderHeader(); renderLeft(); renderRight(); save(); }
  var tabs = document.querySelectorAll('.tab');
  function setTab(t) {
    document.body.setAttribute("data-tab", t);   // mobile : mise en page propre a chaque onglet (CSS)
    S.tab = t;
    Array.prototype.forEach.call(tabs, function (b) {
      var on = b.getAttribute('data-tab') === t;
      b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1;
    });
    $('vJour').hidden = t !== 'jour'; $('vCal').hidden = t !== 'cal'; $('vCarte').hidden = t !== 'carte';
    renderLeft(); renderRight(); save();
    syncTop();   // hauteur de la rangee des dates : mesuree une fois l onglet affiche (sinon 0, la frise passait dessous)
  }

  // Onglets (fleches gauche/droite entre onglets)
  Array.prototype.forEach.call(tabs, function (b, i) {
    b.addEventListener('click', function () {
      if (S.tab !== b.getAttribute('data-tab')) setTab(b.getAttribute('data-tab'));
      // telephone : changer d'onglet, ou retoucher l'onglet actif, remonte en haut de la page
      if (MOBILE.matches) window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    b.addEventListener('keydown', function (ev) {
      var d = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0; if (!d) return;
      var nb = tabs[(i + d + tabs.length) % tabs.length]; nb.focus(); nb.click();
    });
  });
  // Prochains evenements
  chipsEl.addEventListener('click', function (ev) { var b = ev.target.closest('.chip'); if (b) pickJour(b.getAttribute('data-d')); });
  $('prev').addEventListener('click', function () { jourPage(-1); });
  $('next').addEventListener('click', function () { jourPage(1); });
  // Changer de mois (fleches ou glisser) : une liste du mois ouverte suit le nouveau mois ; un jour choisi reste affiche
  function calNav(step) {
    var o = Math.max(0, Math.min(MAXOFF, S.calOff + step));
    if (o === S.calOff) return;
    S.calOff = o;
    if (S.dCal.length === 7) { S.dCal = dkey(new Date(NOW.getFullYear(), NOW.getMonth() + S.calOff, 1)).slice(0, 7); renderRight(); }
    renderCal(); save();
  }
  // Glisser au doigt vers la gauche / la droite (telephone, tablette), en plus des fleches : jours suivants /
  // precedents sur la rangee des dates et la frise, mois suivant / precedent sur le calendrier. Seuls les gestes
  // nettement horizontaux comptent, pour ne pas gener le defilement vertical.
  function swipe(el, next, prev) {
    var x0 = null, y0 = 0;
    el.addEventListener('touchstart', function (ev) { if (ev.touches.length === 1) { x0 = ev.touches[0].clientX; y0 = ev.touches[0].clientY; } else x0 = null; }, { passive: true });
    el.addEventListener('touchend', function (ev) {
      if (x0 == null) return;
      var dx = ev.changedTouches[0].clientX - x0, dy = ev.changedTouches[0].clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) (dx < 0 ? next : prev)();
    }, { passive: true });
  }
  swipe(document.querySelector('.days'), function () { jourPage(1); }, function () { jourPage(-1); });
  swipe(planEl, function () { jourPage(1); }, function () { jourPage(-1); });
  swipe(calEl, function () { calNav(1); }, function () { calNav(-1); });
  planEl.addEventListener('click', function (ev) { var b = ev.target.closest('.pblk'); if (b) selectEvent(+b.getAttribute('data-id'), true); });
  // Calendrier
  calEl.addEventListener('click', function (ev) {
    var nav = ev.target.closest('.nav');
    if (nav) {
      calNav(+nav.getAttribute('data-nav')); return;
    }
    var mt = ev.target.closest('.mtitle'), day = ev.target.closest('.mday');
    if (mt) S.dCal = mt.getAttribute('data-m');
    else if (day && !day.disabled) {
      S.dCal = day.getAttribute('data-d');
      if (S.sel != null && !(BYDAY[S.dCal] || []).some(function (e) { return e.id === S.sel; })) S.sel = null;
    } else return;
    renderCal(); renderRight(); save();
  });
  // Carte
  $('mapBar').addEventListener('click', function (ev) {
    if (!ev.target.closest('.geo-sw')) return;
    S.geo = !S.geo; S.place = null;
    renderCarte(); renderRight(); save();
  });
  // Colonne droite : cartes, tri, lieux, panneau Filtres
  rp.addEventListener('click', function (ev) {
    var t = ev.target;
    if (t.closest('a')) return;   // liens "Voir le detail", "Liste de diffusion" : comportement normal
    var x;
    if ((x = t.closest('[data-place]'))) { pickPlace(x.getAttribute('data-place') || null, true); return; }
    if (t.closest('[data-geo]')) { S.geo = false; S.place = null; renderCarte(); renderRight(); save(); return; }
    if (t.closest('#fClose')) { closePanel(); return; }
    if (t.closest('#fApply')) { applyPanel(); return; }
    // Reinitialiser : on coche tout sur place, sans redessiner le panneau (sinon, sur mobile, il remonte
    // avec son animation et revient en haut : effet de flash)
    if (t.closest('#fReset')) {
      S.tf = copyF(DEF);
      each('.fpanel input[data-k]', function (i) { i.checked = true; });
      if ($('fLieu')) $('fLieu').value = '';
      refreshPanelCount(); return;
    }
    if (t.closest('#fInfo')) {
      S.info = !S.info; $('fNote').hidden = !S.info; $('fInfo').setAttribute('aria-expanded', S.info); return;
    }
    if (t.closest('select, label')) return;
    if ((x = t.closest('.ev'))) toggleCard(x);
  });
  rp.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.id === 'sortSel') { S.sort = t.value; renderRight(); save(); return; }
    if (!S.panel) return;
    if (t.id === 'fLieu') S.tf.lieu = t.value;
    else if (t.hasAttribute('data-k')) S.tf[t.getAttribute('data-k')] = t.checked;
    refreshPanelCount();
  });
  // Clavier : Entree / Espace sur un bloc ou une carte = selection
  document.addEventListener('keydown', function (ev) {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('.pblk, .ev')) {
      ev.preventDefault();
      if (ev.target.classList.contains('pblk')) selectEvent(+ev.target.getAttribute('data-id'), true); else toggleCard(ev.target);
    }
  });
  // Survol : le bloc et sa carte s'eclairent ensemble
  function hl(ev, on) {
    var a = ev.target.closest && ev.target.closest('.cols [data-id]'); if (!a) return;
    each('.cols [data-id="' + a.getAttribute('data-id') + '"]', function (x) { x.classList.toggle('hl', on); });
  }
  document.addEventListener('mouseover', function (ev) { hl(ev, true); });
  document.addEventListener('mouseout', function (ev) { hl(ev, false); });

  // Recherche (titre, description, lieu, intervenant) : agit sur les trois vues, avec les filtres
  var qEl = $('q');
  qEl.value = S.q;
  qEl.addEventListener('input', function () { S.q = qEl.value; update(); });
  $('qClear').addEventListener('click', function () { S.q = qEl.value = ''; update(); qEl.focus(); });
  // Mobile : la loupe deplie / replie le champ de recherche sous le titre (il reste ouvert si une recherche est en cours)
  var banner = document.querySelector('.banner');
  function searchOpen(on) {
    banner.classList.toggle('sopen', on);
    $('qBtn').setAttribute('aria-expanded', on);
    syncTop();
  }
  $('qBtn').addEventListener('click', function () {
    var on = !banner.classList.contains('sopen');
    searchOpen(on || !!S.q);
    if (on) qEl.focus(); else qEl.blur();
  });
  if (S.q) searchOpen(true);
  if (/Mac|iPhone|iPad/.test(navigator.platform || '')) $('qKey').textContent = '⌘ K';
  document.addEventListener('keydown', function (ev) {
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'k' || ev.key === 'K')) { ev.preventDefault(); qEl.focus(); qEl.select(); return; }
    if (ev.key === 'Escape') {
      if (document.activeElement === qEl && S.q) { S.q = qEl.value = ''; update(); }
      else if (S.panel) closePanel();
    }
  });
  // Bouton Filtres : ouvre / ferme (sans appliquer) le panneau dans la colonne droite
  $('fltBtn').addEventListener('click', function () { if (S.panel) closePanel(); else openPanel(); });

  // Mode nuit (choix memorise ; sinon suit le systeme)
  var root = document.documentElement, tb = $('themeBtn');
  function themeLabel() { tb.setAttribute('aria-checked', root.getAttribute('data-theme') === 'dark'); }
  tb.addEventListener('click', function () {
    var t = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', t);
    try { localStorage.setItem('theme', t); } catch (e) {}
    themeLabel();
  });
  if (window.matchMedia) {
    var mq = matchMedia('(prefers-color-scheme: dark)'), onSys = function (e) {
      var saved = null;
      try { saved = localStorage.getItem('theme'); } catch (x) {}
      if (!saved) { root.setAttribute('data-theme', e.matches ? 'dark' : 'light'); themeLabel(); }
    };
    if (mq.addEventListener) mq.addEventListener('change', onSys); else if (mq.addListener) mq.addListener(onSys);
  }
  themeLabel();

  // Mobile : fond assombri derriere le panneau Filtres (toucher = fermer sans appliquer)
  var sheetBg = document.createElement('div');
  sheetBg.className = 'sheet-bg';
  sheetBg.addEventListener('click', function () { if (S.panel) closePanel(); });
  document.body.appendChild(sheetBg);
  // Hauteur de la barre fixe -> --top-h (cartes et titres qu'on fait defiler s'arretent dessous)
  function syncTop() {
    var s = document.documentElement.style, d = document.querySelector('.days');
    s.setProperty('--top-h', topH() + 'px');
    s.setProperty('--days-h', (d ? d.offsetHeight : 0) + 'px');   // mobile : la frise se colle sous les dates
  }

  // Largeur : nombre de dates affichees, taille de la carte. Sur telephone, la barre d'adresse qui
  // apparait / disparait en defilant change la hauteur : on ne refait le rendu que si la largeur change.
  var rsz = null, lastW = window.innerWidth;
  window.addEventListener('resize', function () {
    clearTimeout(rsz);
    rsz = setTimeout(function () {
      syncTop();
      if (window.innerWidth !== lastW) { lastW = window.innerWidth; if (S.tab === 'jour') renderJour(); }
      if (map && S.tab === 'carte') map.invalidateSize();
    }, 120);
  });
  // Rechargement toutes les 15 min (nouvelles donnees), seulement si la page est inactive depuis 1 min
  // et le panneau Filtres ferme ; l'onglet, les dates, le lieu et la recherche sont conserves.
  var t0 = Date.now(), act = Date.now();
  ['pointerdown', 'keydown', 'wheel', 'input'].forEach(function (n) { document.addEventListener(n, function () { act = Date.now(); }, { passive: true }); });
  setInterval(function () {
    if (Date.now() - t0 > 15 * 60000 && Date.now() - act > 60000 && !S.panel) { save(); location.reload(); }
  }, 30000);

  // Panneau travaux (PC) : le survol affiche l'avertissement "version de demonstration" ;
  // Echap le referme. Sur telephone la bulle est masquee par le CSS.
  var wipBtn = $('wipBtn'), wipTip = $('wipTip');
  function wip(on) { wipTip.hidden = !on; wipBtn.setAttribute('aria-expanded', on); }
  if (wipBtn) {
    // la bulle s'affiche au survol de la souris (ou au focus clavier), sans clic
    var wipBox = wipBtn.parentNode;
    wipBox.addEventListener('mouseenter', function () { if (!MOBILE.matches) wip(true); });
    wipBox.addEventListener('mouseleave', function () { if (!MOBILE.matches) wip(false); });
    wipBtn.addEventListener('focus', function () { if (!MOBILE.matches) wip(true); });
    wipBtn.addEventListener('blur', function () { if (!MOBILE.matches) wip(false); });
    // Telephone : toucher l'icone ouvre / ferme le panneau qui descend sous la barre ; toucher ailleurs le ferme
    wipBtn.addEventListener('click', function () { if (MOBILE.matches) wip(wipTip.hidden); });
    document.addEventListener('click', function (ev) {
      if (MOBILE.matches && !wipTip.hidden && (!wipBox.contains(ev.target) || wipTip.contains(ev.target))) wip(false);
    });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && !wipTip.hidden) wip(false); });
  }

  compute(); renderHeader(); setTab(S.tab); syncTop();
})();
