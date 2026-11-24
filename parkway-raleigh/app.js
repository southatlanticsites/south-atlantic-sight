// Downtown Raleigh parking map for Parkway Corporation. Static page on GitHub Pages.
// Public data is in sites.json and zoning.json. Our notes are AES-GCM encrypted in
// notes.enc.json and are only readable with the password (never stored in this repo).
(function () {
  'use strict';
  var CFG = window.SIGHT_CONFIG || {};
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var money = function (v) { return v ? '$' + (v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : Math.round(v).toLocaleString()) : '—'; };
  var num = function (v) { return v == null ? '—' : Math.round(v).toLocaleString(); };
  var HEX = { 'Surface lot': '#e4572e', 'Parking deck': '#1f5c8b', 'Noted site': '#7a3db8' };
  var ZC = [['DX', '#b85fa3', 'Downtown mixed use'], ['CX', '#d96b6b', 'Commercial mixed use'], ['OX', '#5f86cf', 'Office mixed use'], ['IX', '#a8875a', 'Industrial mixed use'], ['NX', '#e3a13f', 'Neighborhood mixed use'], ['RX', '#d8c14a', 'Residential mixed use'], ['PD', '#4fa77c', 'Planned development'], ['OP', '#3fa9ad', 'Office park'], ['R-', '#e0d56f', 'Residential'], ['IH', '#8a7250', 'Heavy industrial']];
  var zcol = function (z) { z = z || ''; for (var i = 0; i < ZC.length; i++) if (z.indexOf(ZC[i][0]) === 0) return ZC[i][1]; return '#999999'; };

  var S = [], byId = {}, NOTES = null, map, siteData, zoneData, ovlData, dtData, sel = null, tip, info;
  var state = { q: '', kinds: { 'Surface lot': 1, 'Parking deck': 1, 'Noted site': 1 }, f: {}, sort: 'ac' };

  var isPrivate = function (s) { return !s.tags.some(function (t) { return /City of Raleigh|Public|Religious|Condo/.test(t); }); };
  var devFlag = function (s) { return s.tags.some(function (t) { return /Development|construction/.test(t); }); };
  var notesFor = function (s) { return NOTES ? (NOTES[String(s.id)] || []) : []; };

  function kpis() {
    var lots = S.filter(function (s) { return s.kind === 'Surface lot'; });
    var ac = lots.reduce(function (a, s) { return a + s.ac; }, 0);
    var priv = lots.filter(isPrivate).reduce(function (a, s) { return a + s.ac; }, 0);
    var decks = S.filter(function (s) { return s.kind === 'Parking deck'; }).length;
    var k = [[lots.length, 'surface lots'], [ac.toFixed(0) + ' ac', 'in surface lots'], [Math.round(100 * priv / ac) + '%', 'of that acreage privately held'], [decks, 'deck parcels'], [S.filter(function (s) { return s.nn; }).length, 'sites with our notes']];
    $('#kpis').innerHTML = k.map(function (x) { return '<div class="kpi"><b>' + esc(x[0]) + '</b><span>' + esc(x[1]) + '</span></div>'; }).join('');
  }

  function match(s) {
    if (!state.kinds[s.kind]) return false;
    if (state.f.notes && !s.nn) return false;
    if (state.f.news && !s.news.length) return false;
    if (state.f['private'] && !isPrivate(s)) return false;
    if (state.f.dev && !devFlag(s)) return false;
    if (state.q) {
      var hay = [s.name, s.owner, s.mail].concat(s.addr, s.pins, s.tags, s.zoning.map(function (z) { return z.code; })).join(' ').toLowerCase();
      var words = state.q.toLowerCase().split(/\s+/);
      for (var i = 0; i < words.length; i++) if (hay.indexOf(words[i]) < 0) return false;
    }
    return true;
  }

  function sorted(a) {
    var k = state.sort;
    return a.slice().sort(function (x, y) {
      if (k === 'ac') return y.ac - x.ac;
      if (k === 'val') return y.land - x.land;
      if (k === 'owner') return x.owner.localeCompare(y.owner);
      if (k === 'sale') return String(y.sale || '').localeCompare(String(x.sale || ''));
      return ((y.nn * 2 + y.news.length) - (x.nn * 2 + x.news.length)) || y.ac - x.ac;
    });
  }

  function render() {
    var vis = S.filter(match);
    $('#count').textContent = vis.length + ' of ' + S.length + ' sites';
    $('#list').innerHTML = sorted(vis).map(function (s) {
      var flags = (s.nn ? '<span class="flag n1">' + s.nn + ' note' + (s.nn > 1 ? 's' : '') + '</span>' : '') +
        (s.news.length ? '<span class="flag n2">' + s.news.length + ' news</span>' : '') +
        (s.zoning[0] ? '<span class="flag">' + esc(s.zoning[0].code) + '</span>' : '') +
        s.tags.filter(function (t) { return !/City|Public/.test(t); }).slice(0, 2).map(function (t) { return '<span class="flag">' + esc(t.replace(' (by mailing address)', '')) + '</span>'; }).join('');
      return '<button class="item' + (sel === s.id ? ' on' : '') + '" role="listitem" data-id="' + esc(s.id) + '"><span class="dot" style="background:' + HEX[s.kind] + '"></span><span class="n">' + esc(s.name) + '</span><span class="a">' + s.ac.toFixed(2) + ' ac</span><span class="o">' + esc(s.owner) + '</span><span class="flags">' + flags + '</span></button>';
    }).join('') || '<p class="empty" style="padding:14px">No sites match these filters.</p>';
    if (siteData) siteData.setStyle(styleFor);
  }

  function styleFor(f) {
    var s = byId[f.getProperty('id')], c = HEX[s.kind], on = match(s), me = s.id === sel;
    if (!on) return { strokeColor: c, strokeOpacity: 0.2, strokeWeight: 0.6, fillColor: c, fillOpacity: 0.05, zIndex: 1 };
    return { strokeColor: c, strokeOpacity: 1, strokeWeight: me ? 4 : 1.5, fillColor: c, fillOpacity: me ? 0.75 : 0.5, zIndex: me ? 10 : 5 };
  }

  function bounds(geom) {
    var b = new google.maps.LatLngBounds();
    geom.forEachLatLng(function (ll) { b.extend(ll); });
    return b;
  }

  function sheet(s) {
    sel = s.id;
    var z = s.zoning || [];
    var fac = s.fac.map(function (f) {
      return [f.Name || f.asset_name, f.operator_info || f.Owner, (f.Num_Spaces || f.parking_space_count) ? (f.Num_Spaces || f.parking_space_count) + ' spaces' : '', f.Levels ? f.Levels + ' levels' : '', f.pricing_structure || '', f.public_availability || '', f.MonthlyAct ? 'monthly accounts: ' + f.MonthlyAct : ''].filter(Boolean).map(esc).join(' · ');
    }).join('<br>');
    var nts = notesFor(s);
    var notesHtml = !s.nn ? '<p class="empty">Nothing in our email or Drive on this lot.</p>' :
      !NOTES ? '<p class="empty">' + s.nn + ' note' + (s.nn > 1 ? 's' : '') + ' from South Atlantic Sites. <a href="#" id="unl2">Unlock notes</a> to read.</p>' :
      nts.map(function (n) { return '<div class="note"><div class="m">' + esc(n.date) + ' · ' + esc(n.src) + ' · ' + esc(n.title) + '</div>' + esc(n.text) + '</div>'; }).join('');
    var titleCase = s.addr.join(', ').toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    $('#sheet').innerHTML = '<button class="back" id="back">← All sites</button>' +
      '<div style="display:flex;gap:8px;align-items:center;font-size:13px;color:var(--mute)"><span class="dot" style="margin:0;background:' + HEX[s.kind] + '"></span>' + esc(s.kind) + (s.outside ? ' · just outside downtown boundary' : '') + '</div>' +
      '<h2>' + esc(s.name) + '</h2><div style="color:var(--mute);font-size:14px">' + esc(titleCase) + '</div>' +
      '<dl class="kv"><dt>Owner</dt><dd><b>' + esc(s.owner) + '</b></dd><dt>Mailing address</dt><dd>' + esc(s.mail) + '</dd>' +
      '<dt>Size</dt><dd>' + s.ac.toFixed(2) + ' ac' + (s.parksf ? ' · ' + num(s.parksf) + ' SF paved parking' : '') + '</dd>' +
      '<dt>Spaces</dt><dd>' + (s.spaces ? num(s.spaces) : s.est ? '≈ ' + num(s.est) + ' (estimate)' : '—') + '</dd>' +
      '<dt>Zoning</dt><dd>' + (z.map(function (x) { return esc(x.code) + (z.length > 1 ? ' (' + x.pct + '%)' : '') + (x.link ? ' · <a href="' + esc(x.link) + '" target="_blank" rel="noopener">conditions</a>' : ''); }).join('<br>') || '—') + (s.ovl.length ? '<br>' + s.ovl.map(esc).join('<br>') : '') + '</dd>' +
      '<dt>Tax value</dt><dd>' + money(s.tot) + ' <span style="color:var(--mute)">(land ' + money(s.land) + ', bldg ' + money(s.bldg) + ')</span></dd>' +
      '<dt>Last sale</dt><dd>' + (s.sale ? esc(s.sale) + (s.price ? ' · ' + money(s.price) : '') : '—') + '</dd>' +
      '<dt>PIN' + (s.pins.length > 1 ? 's' : '') + '</dt><dd>' + s.pins.map(esc).join(', ') + '</dd>' +
      '<dt>Tags</dt><dd>' + (s.tags.map(esc).join(', ') || 'Private') + '</dd></dl>' +
      (s.grp.n > 1 ? '<p style="font-size:14px">Same owner mailing address controls <b>' + s.grp.n + ' lots</b> on this map (' + s.grp.ac + ' ac). <a href="#" id="grp">Show them</a></p>' : '') +
      (fac ? '<h3>Operator and rates (City parking data)</h3><p style="font-size:14px">' + fac + '</p>' : '') +
      '<h3>Our notes (South Atlantic Sites)</h3>' + notesHtml +
      '<h3>News and public record</h3>' + (s.news.length ? s.news.map(function (n) { return '<div class="news"><div class="m">' + esc(n.date) + ' · ' + esc(n.source) + '</div>' + esc(n.text) + (n.url ? ' <a href="' + esc(n.url) + '" target="_blank" rel="noopener">Read</a>' : '') + '</div>'; }).join('') : '<p class="empty">No coverage found for this lot.</p>') +
      (s.permits.length ? '<h3>City permits</h3>' + s.permits.map(function (p) { return '<div class="news" style="border-color:var(--line)"><div class="m">' + esc(p.status) + ' · ' + esc(p.issued || p.applied || '') + (p.cost > 1 ? ' · ' + money(p.cost) : '') + '</div>' + esc(((p.work || '') + ' ' + (p.desc || '')).slice(0, 220)) + '</div>'; }).join('') : '') +
      '<h3>Look it up</h3><div class="links">' + (s.reid ? '<a target="_blank" rel="noopener" href="https://services.wake.gov/realestate/Account.asp?id=' + esc(s.reid) + '">Wake County tax record</a>' : '') +
      '<a target="_blank" rel="noopener" href="https://maps.wakegov.com/imaps/?pin=' + esc(s.pins[0]) + '">Wake iMaps</a>' +
      '<a target="_blank" rel="noopener" href="https://news.google.com/search?q=' + encodeURIComponent('"' + (s.addr[0] || '').toLowerCase() + '" Raleigh') + '">Search news</a>' +
      '<a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + s.lat + ',' + s.lon + '">Google Maps</a></div>';
    $('#sheet').classList.add('open');
    $('#sheet').scrollTop = 0;
    $('#back').onclick = function () { sel = null; $('#sheet').classList.remove('open'); render(); };
    var g = $('#grp');
    if (g) g.onclick = function (e) { e.preventDefault(); state.q = s.mail.split(',')[0]; $('#q').value = state.q; sel = null; $('#sheet').classList.remove('open'); render(); fitVisible(); };
    var u = $('#unl2');
    if (u) u.onclick = function (e) { e.preventDefault(); showPw(); };
    render();
  }

  function fitVisible() {
    var b = new google.maps.LatLngBounds(), any = false;
    siteData.forEach(function (f) { if (match(byId[f.getProperty('id')])) { b.union(bounds(f.getGeometry())); any = true; } });
    if (any) map.fitBounds(b, 40);
  }

  function open(id) {
    var s = byId[id];
    if (!s) return;
    sheet(s);
    var f = siteData.getFeatureById(String(id));
    if (f) { map.fitBounds(bounds(f.getGeometry()), 120); if (map.getZoom() > 19) map.setZoom(19); }
  }

  function legend() {
    var on = $('#L_zone').checked;
    $('#legend').classList.toggle('show', on);
    $('#legend').innerHTML = '<b>Zoning (base district)</b><br>' + ZC.map(function (c) { return '<div><i style="background:' + c[1] + '"></i>' + c[0].replace('-', '') + ' · ' + c[2] + '</div>'; }).join('') + '<div style="margin-top:4px;color:var(--mute)">Click a zone for its full code and conditions.</div>';
  }

  // ---- notes (encrypted) ----
  var b64 = function (s) { return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); };
  function decrypt(pw) {
    return fetch('notes.enc.json').then(function (r) { return r.json(); }).then(function (e) {
      var enc = new TextEncoder();
      return crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']).then(function (base) {
        return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(e.salt), iterations: e.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      }).then(function (key) {
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(e.iv) }, key, b64(e.ct));
      }).then(function (buf) { return JSON.parse(new TextDecoder().decode(buf)); });
    });
  }
  function unlocked(n, pw) {
    NOTES = n;
    try { sessionStorage.setItem('pkwyNotes', pw); } catch (e) { /* private mode */ }
    $('#pwform').hidden = true;
    $('#unlock').textContent = 'Notes unlocked';
    $('#unlock').classList.add('on');
    if (sel != null) sheet(byId[sel]);
  }
  function showPw() { $('#pwform').hidden = false; $('#pw').focus(); }
  $('#unlock').addEventListener('click', function () { if (!NOTES) showPw(); });
  $('#pwform').addEventListener('submit', function (e) {
    e.preventDefault();
    var pw = $('#pw').value;
    $('#pwmsg').textContent = 'Checking…';
    decrypt(pw).then(function (n) { $('#pwmsg').textContent = ''; unlocked(n, pw); }).catch(function () { $('#pwmsg').textContent = 'That password did not work.'; });
  });
  try { var saved = sessionStorage.getItem('pkwyNotes'); if (saved) decrypt(saved).then(function (n) { unlocked(n, saved); }).catch(function () {}); } catch (e) { /* ignore */ }

  // ---- map ----
  window.pkwyInit = function () {
    map = new google.maps.Map($('#map'), {
      center: { lat: 35.7795, lng: -78.6415 }, zoom: 15, mapTypeId: 'roadmap',
      mapTypeControl: false, streetViewControl: true, fullscreenControl: true, clickableIcons: false,
      styles: [{ featureType: 'poi', stylers: [{ visibility: 'off' }] }, { featureType: 'transit.station', stylers: [{ visibility: 'simplified' }] }]
    });
    info = new google.maps.InfoWindow();
    tip = document.createElement('div');
    tip.style.cssText = 'position:absolute;z-index:6;pointer-events:none;background:#fff;border:1px solid #d9dee2;border-radius:6px;padding:4px 8px;font-size:12.5px;box-shadow:0 2px 8px #0002;display:none;max-width:260px';
    $('.mapwrap').appendChild(tip);
    var moveTip = function (e, html) {
      if (!e.domEvent || e.domEvent.clientX == null) return;
      var r = $('.mapwrap').getBoundingClientRect();
      tip.innerHTML = html; tip.style.display = 'block';
      tip.style.left = (e.domEvent.clientX - r.left + 14) + 'px'; tip.style.top = (e.domEvent.clientY - r.top + 14) + 'px';
    };

    Promise.all([fetch('sites.json').then(function (r) { return r.json(); }), fetch('zoning.json').then(function (r) { return r.json(); })]).then(function (res) {
      S = res[0]; var Z = res[1];
      S.forEach(function (s) { byId[s.id] = s; });

      zoneData = new google.maps.Data();
      zoneData.addGeoJson({ type: 'FeatureCollection', features: Z.zoning.map(function (p) { return { type: 'Feature', geometry: p.g, properties: { z: p.z, c: p.c, l: p.l } }; }) });
      zoneData.setStyle(function (f) { var c = zcol(f.getProperty('z')); return { strokeColor: c, strokeWeight: 1, fillColor: c, fillOpacity: 0.28, zIndex: 0 }; });
      zoneData.addListener('mouseover', function (e) { moveTip(e, esc(e.feature.getProperty('z'))); });
      zoneData.addListener('mouseout', function () { tip.style.display = 'none'; });
      zoneData.addListener('click', function (e) {
        var f = e.feature;
        info.setContent('<b>' + esc(f.getProperty('z')) + '</b>' + (f.getProperty('c') ? '<br>Case ' + esc(f.getProperty('c')) : '') + (f.getProperty('l') ? '<br><a target="_blank" rel="noopener" href="' + esc(f.getProperty('l')) + '">Conditions</a>' : ''));
        info.setPosition(e.latLng); info.open(map);
      });

      ovlData = new google.maps.Data();
      ovlData.addGeoJson({ type: 'FeatureCollection', features: Z.ovl.map(function (p) { return { type: 'Feature', geometry: p.g, properties: { n: p.n } }; }) });
      ovlData.setStyle(function (f) { return { strokeColor: /Transit/.test(f.getProperty('n')) ? '#0a8a6a' : '#8a5a00', strokeWeight: 2.5, fillOpacity: 0, zIndex: 2 }; });
      ovlData.addListener('mouseover', function (e) { moveTip(e, esc(e.feature.getProperty('n'))); });
      ovlData.addListener('mouseout', function () { tip.style.display = 'none'; });

      dtData = new google.maps.Data();
      dtData.addGeoJson({ type: 'Feature', geometry: Z.downtown, properties: {} });
      dtData.setStyle({ strokeColor: '#14202a', strokeWeight: 2, strokeOpacity: 0.7, fillOpacity: 0, clickable: false, zIndex: 1 });
      dtData.setMap(map);

      siteData = new google.maps.Data();
      siteData.addGeoJson({ type: 'FeatureCollection', features: S.map(function (s) { return { type: 'Feature', id: String(s.id), geometry: s.g, properties: { id: s.id } }; }) });
      siteData.setStyle(styleFor);
      siteData.addListener('mouseover', function (e) { var s = byId[e.feature.getProperty('id')]; moveTip(e, '<b>' + esc(s.name) + '</b><br>' + esc(s.owner) + '<br>' + s.ac.toFixed(2) + ' ac · ' + esc((s.zoning[0] || {}).code || '')); });
      siteData.addListener('mousemove', function (e) { if (tip.style.display === 'block') { var r = $('.mapwrap').getBoundingClientRect(); if (e.domEvent) { tip.style.left = (e.domEvent.clientX - r.left + 14) + 'px'; tip.style.top = (e.domEvent.clientY - r.top + 14) + 'px'; } } });
      siteData.addListener('mouseout', function () { tip.style.display = 'none'; });
      siteData.addListener('click', function (e) { open(e.feature.getProperty('id')); });
      siteData.setMap(map);

      var b = new google.maps.LatLngBounds();
      dtData.forEach(function (f) { b.union(bounds(f.getGeometry())); });
      map.fitBounds(b, 10);

      var tog = function (id, layer) { $(id).addEventListener('change', function (e) { layer.setMap(e.target.checked ? map : null); legend(); }); };
      tog('#L_zone', zoneData); tog('#L_ovl', ovlData); tog('#L_dt', dtData);
      $('#L_sat').addEventListener('change', function (e) { map.setMapTypeId(e.target.checked ? 'hybrid' : 'roadmap'); });
      kpis(); render();
    }).catch(function (err) {
      $('#list').innerHTML = '<p class="empty" style="padding:14px">The map data did not load. Refresh the page to try again.</p>';
      console.log(err);
    });
  };

  $('#list').addEventListener('click', function (e) { var b = e.target.closest('.item'); if (b) open(isNaN(b.dataset.id) ? b.dataset.id : +b.dataset.id); });
  $('#q').addEventListener('input', function (e) { state.q = e.target.value.trim(); render(); });
  $('#sort').addEventListener('change', function (e) { state.sort = e.target.value; render(); });
  $('#kinds').addEventListener('click', function (e) { var b = e.target.closest('.chip'); if (!b) return; var on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', on); if (on) state.kinds[b.dataset.k] = 1; else delete state.kinds[b.dataset.k]; render(); });
  $('#flags').addEventListener('click', function (e) { var b = e.target.closest('.chip'); if (!b) return; var on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', on); if (on) state.f[b.dataset.f] = 1; else delete state.f[b.dataset.f]; render(); });
  if (innerWidth < 700) $('#layers').open = false;

  var s = document.createElement('script');
  s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(CFG.mapsKey) + '&v=weekly&loading=async&callback=pkwyInit';
  s.async = true;
  document.head.appendChild(s);
})();
