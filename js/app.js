/* South Atlantic Sight - client-facing map. No build step; plain browser JavaScript. */
(function () {
  'use strict';
  const CFG = window.SIGHT_CONFIG, LAYERS = window.SIGHT_LAYERS, GROUPS = window.SIGHT_GROUPS;
  const byId = Object.fromEntries(LAYERS.map(l => [l.id, l]));
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => Math.round(n).toLocaleString('en-US');
  const money = n => '$' + Math.round(n).toLocaleString('en-US');
  const MI = 1609.344, MERC = 20037508.342789244;
  let map, geocoder, HtmlMarker, pin = null, parcelShapes = [];
  const on = new Set(), H = {}, rowEls = {};
  const state = { demoVar: 'd', measure: null, clickSeq: 0 };

  // ------------------------------------------------------------------ helpers
  function toMerc(lat, lng) {
    const y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180);
    return [lng * MERC / 180, y * MERC / 180];
  }
  function fromMerc(x, y) {
    return { lng: x / MERC * 180, lat: Math.atan(Math.exp(y / MERC * Math.PI)) * 360 / Math.PI - 90 };
  }
  function qs(params) {
    return Object.keys(params).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
  }
  function jsonp(url) {
    return new Promise((resolve, reject) => {
      const cb = '__sight_cb' + Math.random().toString(36).slice(2);
      const s = document.createElement('script');
      const done = () => { delete window[cb]; s.remove(); clearTimeout(t); };
      const t = setTimeout(() => { done(); reject(new Error('timeout')); }, 20000);
      window[cb] = d => { done(); resolve(d); };
      s.onerror = () => { done(); reject(new Error('network')); };
      s.src = url + '&callback=' + cb;
      document.head.appendChild(s);
    });
  }
  // ArcGIS REST call. Some servers (FEMA) send no cross-site header, so fall back to JSONP.
  async function arc(url, params) {
    const full = url + '?' + qs(Object.assign({ f: 'json' }, params));
    let d;
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 45000);
    try {
      const r = await fetch(full, { signal: ctl.signal });
      d = await r.json();
    } catch (e) {
      if (ctl.signal.aborted) throw new Error('timeout');
      d = await jsonp(full);
    } finally { clearTimeout(timer); }
    if (d && d.error) throw new Error(d.error.message || 'service error');
    return d;
  }
  function status(msg) { $('#status').textContent = msg || ''; }
  function showTab(name) {
    document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === name));
    document.querySelectorAll('#tabpanes section').forEach(s => { s.hidden = s.id !== 'tab-' + name; });
    if (document.body.classList.contains('panel-closed')) togglePanel();
  }
  function togglePanel() {
    const closed = document.body.classList.toggle('panel-closed');
    $('#panel-toggle').textContent = closed ? 'Show panel' : 'Hide panel';
    $('#panel-toggle').setAttribute('aria-expanded', String(!closed));
    if (map) google.maps.event.trigger(map, 'resize');
  }
  function swatch(s) {
    if (!s) return '';
    const m = /^(line|dot):(.+)$/.exec(s);
    if (m) return m[1] === 'line' ? '<span class="sw line" style="border-top-color:' + m[2] + '"></span>'
      : '<span class="sw dot" style="background:' + m[2] + '"></span>';
    return '<span class="sw" style="background:' + s + '"></span>';
  }

  // ------------------------------------------------------------------ URL state
  function readHash() {
    const o = {};
    location.hash.replace(/^#/, '').split('&').forEach(p => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1)); });
    return o;
  }
  function writeHash() {
    if (!map || !map.getCenter()) return;
    const c = map.getCenter();
    const h = 'c=' + c.lat().toFixed(5) + ',' + c.lng().toFixed(5) + '&z=' + map.getZoom() + '&l=' + Array.from(on).join(',') +
      '&b=' + map.getMapTypeId() + '&v=' + state.demoVar;
    history.replaceState(null, '', '#' + h);
  }

  // ------------------------------------------------------------------ layer panel
  function buildLayerPanel() {
    const root = $('#tab-layers');
    root.innerHTML = '';
    GROUPS.forEach(g => {
      const defs = LAYERS.filter(l => l.group === g);
      if (!defs.length) return;
      const box = document.createElement('div');
      box.className = 'group';
      box.innerHTML = '<h2>' + esc(g) + '</h2>';
      defs.forEach(def => {
        const row = document.createElement('div');
        row.className = 'layer';
        row.innerHTML = '<label><input type="checkbox" data-id="' + def.id + '">' + swatch(def.swatch) +
          '<span class="nm">' + esc(def.name) + '</span></label>' +
          '<div class="meta state" hidden></div><div class="extra"></div>' +
          (def.note || def.type === 'arcgis' ? '<div class="meta"><button class="more" type="button">About this layer</button>' +
            '<span class="about" hidden> ' + esc(def.note || '') + '</span></div>' : '');
        row.querySelector('input').addEventListener('change', e => setLayer(def.id, e.target.checked));
        const more = row.querySelector('.more');
        if (more) more.addEventListener('click', () => {
          const a = row.querySelector('.about');
          a.hidden = !a.hidden;
          more.textContent = a.hidden ? 'About this layer' : 'Hide';
          if (!a.hidden && def.type === 'arcgis') loadKey(def, row);
        });
        rowEls[def.id] = row;
        box.appendChild(row);
      });
      root.appendChild(box);
    });
  }
  function rowState(id, text, cls) {
    const el = rowEls[id] && rowEls[id].querySelector('.state');
    if (!el) return;
    el.hidden = !text;
    el.className = 'meta state ' + (cls || '');
    el.textContent = text || '';
  }
  async function loadKey(def, row) {
    if (row.dataset.key) return;
    row.dataset.key = '1';
    try {
      const d = await arc(def.url + '/legend', {});
      const items = [];
      (d.layers || []).filter(l => def.layers.indexOf(l.layerId) >= 0).forEach(l => (l.legend || []).slice(0, 14).forEach(g => {
        items.push('<div><img alt="" width="18" height="18" src="data:' + g.contentType + ';base64,' + g.imageData + '">' +
          esc(g.label || l.layerName) + '</div>');
      }));
      if (items.length) {
        const k = document.createElement('div');
        k.className = 'key';
        k.innerHTML = items.slice(0, 40).join('');
        row.appendChild(k);
      }
    } catch (e) { /* key is optional */ }
  }
  function setLayer(id, want, silent) {
    const def = byId[id];
    if (!def || !H[id]) return;
    if (want) on.add(id); else on.delete(id);
    const cb = rowEls[id].querySelector('input');
    cb.checked = want;
    try { want ? H[id].show() : H[id].hide(); } catch (e) { console.error(id, e); }
    if (!want) rowState(id, '');
    refreshHints();
    updateLegend();
    if (!silent) writeHash();
  }
  function refreshHints() {
    const z = map.getZoom();
    const need = [];
    on.forEach(id => {
      const def = byId[id];
      if (def.minZoom && z < def.minZoom) { rowState(id, 'Zoom in to see this layer', 'hint'); need.push(def.name); }
      else if (rowEls[id].querySelector('.state').classList.contains('hint')) rowState(id, '');
    });
    status(need.length ? 'Zoom in to see: ' + need.join(', ') : '');
  }

  // ------------------------------------------------------------------ ArcGIS server-drawn layers
  // Ground overlays stack in the order they are added, so re-add them bottom to top:
  // aerial photos, then shaded areas (zoning, flood), then lines (parcels, roads).
  const imageStack = [];
  function zOf(def) { return def.z != null ? def.z : def.type === 'image' ? 0 : def.id === 'parcels' ? 9 : /^line:|^dot:/.test(def.swatch || '') ? 7 : 4; }
  function restack(changed) {
    const above = imageStack.filter(e => zOf(e.def) > zOf(changed) && e.overlays().length);
    above.sort((a, b) => zOf(a.def) - zOf(b.def)).forEach(e => e.overlays().forEach(o => { o.setMap(null); o.setMap(map); }));
  }
  function makeImageLayer(def) {
    const parts = [{ url: def.url, layers: def.layers }].concat(def.also || []).map(p => ({ p: p, ov: null, seq: 0 }));
    let visible = false;
    function clear() { parts.forEach(s => { if (s.ov) { s.ov.setMap(null); s.ov = null; } s.seq++; }); }
    function refresh() {
      if (!visible) return;
      if (def.minZoom && map.getZoom() < def.minZoom) { clear(); return; }
      const b = map.getBounds();
      if (!b) return;
      const div = map.getDiv(), pad = 0.12;
      const sw = toMerc(b.getSouthWest().lat(), b.getSouthWest().lng()), ne = toMerc(b.getNorthEast().lat(), b.getNorthEast().lng());
      const dx = (ne[0] - sw[0]) * pad, dy = (ne[1] - sw[1]) * pad;
      const box = [sw[0] - dx, sw[1] - dy, ne[0] + dx, ne[1] + dy];
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      let w = div.clientWidth * (1 + 2 * pad) * dpr, h = div.clientHeight * (1 + 2 * pad) * dpr, dpi = 96 * dpr;
      const k = Math.min(1, 2048 / Math.max(w, h));
      w = Math.round(w * k); h = Math.round(h * k); dpi = Math.round(dpi * k);
      const bounds = new google.maps.LatLngBounds(fromMerc(box[0], box[1]), fromMerc(box[2], box[3]));
      const zoomUrl = def.byZoom ? (def.byZoom.find(b => map.getZoom() >= b[0]) || [0, def.url])[1] : null;
      parts.forEach(s => {
        const base = zoomUrl && s.p.url === def.url ? zoomUrl : s.p.url;
        const common = { bbox: box.join(','), bboxSR: 3857, imageSR: 3857, size: w + ',' + h, f: 'image' };
        const url = def.type === 'image'
          ? base + '/exportImage?' + qs(Object.assign(common, def.png ? { format: 'png32', transparent: true } : { format: 'jpgpng' }))
          : base + '/export?' + qs(Object.assign(common, { format: 'png32', transparent: true, dpi: dpi, layers: 'show:' + s.p.layers.join(',') }));
        const seq = ++s.seq, img = new Image();
        img.onload = () => {
          if (seq !== s.seq || !visible) return;
          const ov = new google.maps.GroundOverlay(url, bounds, { clickable: false, opacity: def.opacity == null ? (def.type === 'image' ? 1 : 0.85) : def.opacity });
          ov.setMap(map);
          if (s.ov) s.ov.setMap(null);
          s.ov = ov;
          restack(def);
          if (rowEls[def.id].querySelector('.state').classList.contains('warn')) rowState(def.id, '');
        };
        img.onerror = () => { if (seq === s.seq) rowState(def.id, 'The source for this layer is not responding right now.', 'warn'); };
        img.src = url;
      });
    }
    imageStack.push({ def: def, overlays: () => parts.filter(s => s.ov).map(s => s.ov) });
    return { show() { visible = true; refresh(); }, hide() { visible = false; clear(); }, refresh: refresh };
  }

  // ------------------------------------------------------------------ browser-drawn feature layers
  function latestAadt(a) {
    for (let y = 2035; y >= 2002; y--) { const v = a['AADT_' + y]; if (v && v > 0) return { v: v, y: y }; }
    return null;
  }
  function makeFeatureLayer(def) {
    const data = new google.maps.Data();
    let visible = false, seq = 0, labels = [];
    if (def.kind === 'polygon') data.setStyle({ fillColor: def.style.fill, fillOpacity: 0.22, strokeColor: def.style.stroke, strokeWeight: 1.5 });
    if (def.kind === 'line') data.setStyle({ strokeColor: def.style.stroke, strokeWeight: def.style.weight || 2, strokeOpacity: 0.9 });
    if (def.kind === 'aadt') data.setStyle({ visible: false });
    data.addListener('click', e => {
      const props = {};
      e.feature.forEachProperty((v, k) => { props[k] = v; });
      handleClick(e.latLng, [{ title: def.title || def.name, html: attrTable(props, def.pick) }]);
    });
    function clearLabels() { labels.forEach(m => m.setMap(null)); labels = []; }
    async function refresh() {
      if (!visible) return;
      if (def.minZoom && map.getZoom() < def.minZoom) { data.forEach(f => data.remove(f)); clearLabels(); return; }
      const b = map.getBounds();
      if (!b) return;
      const my = ++seq, sw = b.getSouthWest(), ne = b.getNorthEast();
      const p = { where: def.where || '1=1', geometry: [sw.lng(), sw.lat(), ne.lng(), ne.lat()].join(','), geometryType: 'esriGeometryEnvelope',
        inSR: 4326, spatialRel: 'esriSpatialRelIntersects', outFields: '*', outSR: 4326, f: 'geojson', resultRecordCount: 1000 };
      if (def.kind !== 'aadt') p.maxAllowableOffset = (ne.lng() - sw.lng()) / 1500;
      try {
        const r = await fetch(def.url + '/query?' + qs(p));
        const gj = await r.json();
        if (my !== seq || !visible) return;
        if (gj.error) throw new Error(gj.error.message);
        data.forEach(f => data.remove(f));
        clearLabels();
        data.addGeoJson(gj);
        if (def.kind === 'aadt') {
          (gj.features || []).forEach(f => {
            const a = f.properties, t = latestAadt(a);
            if (!t || !f.geometry) return;
            const c = f.geometry.coordinates;
            labels.push(new HtmlMarker({ lat: c[1], lng: c[0] }, 'mk-aadt', num(t.v), () => {
              handleClick(new google.maps.LatLng(c[1], c[0]), [{ title: 'Traffic count', html: aadtHtml(a) }]);
            }, (a.ROUTE || '') + ' ' + (a.LOCATION || '') + ' (' + t.y + ')'));
          });
        }
        rowState(def.id, (gj.features || []).length >= 1000 ? 'Showing the first 1,000 here; zoom in for all.' : '', 'hint');
      } catch (e) {
        if (my === seq) rowState(def.id, 'The source for this layer is not responding right now.', 'warn');
      }
    }
    return { show() { visible = true; data.setMap(map); refresh(); }, hide() { visible = false; seq++; data.setMap(null); clearLabels(); }, refresh: refresh };
  }
  function aadtHtml(a) {
    const yrs = [];
    for (let y = 2035; y >= 2002 && yrs.length < 6; y--) { const v = a['AADT_' + y]; if (v && v > 0) yrs.push('<dt>' + y + '</dt><dd>' + num(v) + ' vehicles a day</dd>'); }
    return '<p class="lead">' + esc((a.ROUTE || '') + ' ' + (a.LOCATION || '')) + '</p><p class="sublead">' + esc(a.COUNTY || '') + ' County, NCDOT count station</p><dl>' + yrs.join('') + '</dl>';
  }

  // ------------------------------------------------------------------ local line layers (county downloads cut into grid cells)
  // Each cell file holds [code, encoded polyline] pairs; tiles are drawn on canvas, so tens of thousands of lines stay fast.
  function decodeLine(s) {
    const out = [];
    let i = 0, lat = 0, lng = 0;
    while (i < s.length) {
      for (let k = 0; k < 2; k++) {
        let b, sh = 0, r = 0;
        do { b = s.charCodeAt(i++) - 63; r |= (b & 0x1f) << sh; sh += 5; } while (b >= 0x20);
        const d = (r & 1) ? ~(r >> 1) : (r >> 1);
        if (k === 0) lat += d; else lng += d;
      }
      const la = lat / 1e6, ln = lng / 1e6, sn = Math.sin(la * Math.PI / 180);
      out.push((ln + 180) / 360 * 256, (0.5 - Math.log((1 + sn) / (1 - sn)) / (4 * Math.PI)) * 256);
    }
    return Float64Array.from(out);
  }
  function worldPx(lat, lng) {
    const sn = Math.sin(lat * Math.PI / 180);
    return [(lng + 180) / 360 * 256, (0.5 - Math.log((1 + sn) / (1 - sn)) / (4 * Math.PI)) * 256];
  }
  function segDist(px, py, a, i) {
    const x1 = a[i], y1 = a[i + 1], x2 = a[i + 2], y2 = a[i + 3], dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
    let t = L ? ((px - x1) * dx + (py - y1) * dy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    const ex = x1 + t * dx - px, ey = y1 + t * dy - py;
    return Math.sqrt(ex * ex + ey * ey);
  }
  function makeGridLayer(def) {
    let meta = null, metaP = null, mt = null, visible = false;
    const cache = {};
    const getMeta = () => metaP || (metaP = fetch(def.grid + '/meta.json').then(r => r.json()).then(m => { meta = m; meta.has = new Set(m.cells); return m; }));
    const cell = k => cache[k] || (cache[k] = fetch(def.grid + '/' + k + '.json').then(r => r.json()).then(a => a.map(x => Array.isArray(x[1]) ? { c: x[0], r: x[1].map(decodeLine), n: x[2] || '' } : { c: x[0], p: decodeLine(x[1]), n: x[2] || '' })).catch(() => []));
    function cellsIn(w, s, e, n) {
      const c = meta.cell, out = [];
      for (let i = Math.floor(w / c); i <= Math.floor(e / c); i++)
        for (let j = Math.floor(s / c); j <= Math.floor(n / c); j++) if (meta.has.has(i + '_' + j)) out.push(i + '_' + j);
      return out;
    }
    const lngOf = x => x / 256 * 360 - 180, latOf = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 256))) * 180 / Math.PI;
    async function paint(cv, x, y, z) {
      if (def.minZoom && z < def.minZoom) return;
      await getMeta();
      const sc = Math.pow(2, z), pad = 4 / sc;
      const wx0 = x * 256 / sc - pad, wy0 = y * 256 / sc - pad, wx1 = (x + 1) * 256 / sc + pad, wy1 = (y + 1) * 256 / sc + pad;
      const keys = cellsIn(lngOf(wx0), latOf(wy1), lngOf(wx1), latOf(wy0));
      if (!keys.length) return;
      const sets = await Promise.all(keys.map(cell));
      if (!visible) return;
      const r = cv.width / 256, ctx = cv.getContext('2d');
      ctx.scale(r, r); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const labels = [];
      sets.forEach(lines => lines.forEach(L => {
        const st = GRID_STYLE[def.render].call({ meta: meta }, L.c, z);
        if (!st) return;
        if (L.r) {
          ctx.beginPath();
          L.r.forEach(q => { for (let i = 0; i < q.length; i += 2) { const px = q[i] * sc - x * 256, py = q[i + 1] * sc - y * 256; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath(); });
          ctx.globalAlpha = st.alpha == null ? 0.45 : st.alpha; ctx.fillStyle = st.fill; ctx.fill('evenodd');
          return;
        }
        const p = L.p;
        ctx.beginPath();
        for (let i = 0; i < p.length; i += 2) {
          const px = (p[i] * sc - x * 256), py = (p[i + 1] * sc - y * 256);
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.strokeStyle = st.color; ctx.lineWidth = st.width; ctx.globalAlpha = st.alpha == null ? 0.9 : st.alpha;
        ctx.setLineDash(st.dash || []);
        ctx.stroke();
        if (st.label && p.length >= 8) {
          const m = Math.floor(p.length / 4) * 2, lx = p[m] * sc - x * 256, ly = p[m + 1] * sc - y * 256;
          if (lx > 18 && lx < 238 && ly > 10 && ly < 246) labels.push([st.label, lx, ly, st.color]);
        }
      }));
      ctx.globalAlpha = 1; ctx.setLineDash([]);
      ctx.font = '600 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      labels.forEach(l => { ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeText(l[0], l[1], l[2]); ctx.fillStyle = l[3]; ctx.fillText(l[0], l[1], l[2]); });
    }
    function Tiles() { this.tileSize = new google.maps.Size(256, 256); }
    Tiles.prototype.getTile = function (coord, z, doc) {
      const cv = doc.createElement('canvas'), r = Math.min(2, Math.ceil(window.devicePixelRatio || 1));
      cv.width = cv.height = 256 * r; cv.style.width = cv.style.height = '256px';
      const n = Math.pow(2, z), x = ((coord.x % n) + n) % n;
      paint(cv, x, coord.y, z).catch(() => {});
      return cv;
    };
    Tiles.prototype.releaseTile = function () {};
    // Nearest line to a spot, searching out to `reach` degrees; distance returned in feet.
    async function nearest(lat, lng, reach) {
      await getMeta();
      const sets = await Promise.all(cellsIn(lng - reach, lat - reach, lng + reach, lat + reach).map(cell));
      const [px, py] = worldPx(lat, lng);
      let best = null;
      sets.forEach(lines => lines.forEach(L => {
        if (def.hitFilter && !def.hitFilter(L.c)) return;
        const consider = d => { if (!best || d < best.d) best = { d: d, c: L.c, n: L.n, area: !!L.r }; };
        if (L.r) {
          let inside = false;
          L.r.forEach(q => { for (let i = 0, j = q.length - 2; i < q.length; j = i, i += 2) { if ((q[i + 1] > py) !== (q[j + 1] > py) && px < (q[j] - q[i]) * (py - q[i + 1]) / (q[j + 1] - q[i + 1]) + q[i]) inside = !inside; } });
          if (inside) { consider(0); return; }
          L.r.forEach(q => { for (let i = 0; i + 3 < q.length; i += 2) consider(segDist(px, py, q, i)); });
          return;
        }
        for (let i = 0; i + 3 < L.p.length; i += 2) consider(segDist(px, py, L.p, i));
      }));
      if (!best) return null;
      best.ft = best.d * (40075016.686 / 256) * Math.cos(lat * Math.PI / 180) * 3.28084;
      return best;
    }
    return {
      show() {
        visible = true;
        getMeta().catch(() => rowState(def.id, 'This layer could not be loaded.', 'warn'));
        if (!mt) mt = new Tiles();
        if (map.overlayMapTypes.getArray().indexOf(mt) < 0) map.overlayMapTypes.push(mt);
      },
      hide() { visible = false; const i = map.overlayMapTypes.getArray().indexOf(mt); if (i >= 0) map.overlayMapTypes.removeAt(i); },
      refresh() {},
      nearest: nearest,
      meta: () => meta,
      identify(lat, lng) {
        if (meta && meta.bounds && (lng < meta.bounds[0] - 0.05 || lng > meta.bounds[2] + 0.05 || lat < meta.bounds[1] - 0.05 || lat > meta.bounds[3] + 0.05)) return null;
        return [{ local: async () => {
          const mpp = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, map.getZoom()) * 3.28084;
          const b = await nearest(lat, lng, def.reach || 0.005);
          return GRID_DESCRIBE[def.render](b, meta, mpp);
        } }];
      }
    };
  }
  const plural = (n, w) => num(n) + ' ' + w + (Math.round(n) === 1 ? '' : 's');
  const GRID_STYLE = {
    sewer(c, z) {
      const p = this.meta.props[c] || [], t = p[0] || '', d = p[1] || 8;
      const w = (d <= 8 ? 1.6 : d <= 15 ? 2.6 : 3.6) * (z >= 16 ? 1.3 : 1);
      if (/Force/.test(t)) return { color: '#C2410C', width: w, dash: [6, 4] };
      if (/Gravity/.test(t)) return { color: '#15803D', width: w };
      return { color: '#9CA3AF', width: 1.2, dash: [2, 4], alpha: 0.8 };
    },
    hydro(c, z) {
      if (c >= 10) return { fill: { 12: '#14B8A6', 14: '#60A5FA' }[c] || '#3B82F6', alpha: c === 12 ? 0.28 : c === 14 ? 0.2 : 0.45 };
      const w = z >= 15 ? 1.6 : z >= 13 ? 1.2 : 0.9;
      return [{ color: '#1D4ED8', width: w + 0.3 }, { color: '#2563EB', width: w, dash: [6, 3] }, { color: '#60A5FA', width: w * 0.8, dash: [2, 3] },
        { color: '#2563EB', width: w }, { color: '#0E7490', width: w }, { color: '#1D4ED8', width: w, alpha: 0.5 }][c];
    },
  };
  const GRID_DESCRIBE = {
    sewer(b, meta, mpp) {
      if (!b) return [{ title: 'County sewer', html: '<p class="sublead">No Johnston County Public Utilities sewer line within about half a mile.</p><p class="fineprint">Towns such as Smithfield, Clayton, Selma and Benson run their own systems, which are not in this layer.</p>' }];
      const p = meta.props[b.c], on = b.ft <= Math.max(12, 10 * mpp);
      const rows = meta.fields.map((f, i) => p[i] != null && p[i] !== '' ? '<dt>' + esc(f) + '</dt><dd>' + esc(p[i]) + '</dd>' : '').join('');
      return [{ title: on ? 'County sewer line' : 'Nearest county sewer line', html: '<p class="lead">' + esc((p[1] ? p[1] + '-inch ' : '') + (p[0] || 'Sewer line').toLowerCase()) + '</p>' +
        '<p class="sublead">' + (on ? 'At this spot' : 'About ' + plural(Math.round(b.ft / 10) * 10, 'foot').replace('foots', 'feet') + ' away, straight line') + '</p><dl>' + rows + '</dl>' +
        '<p class="fineprint">Johnston County Public Utilities sewer map. Capacity, depth and permission to connect have to be confirmed with the county. Town-owned systems are not shown.</p>' }];
    },
    hydro(b, meta, mpp) {
      if (!b) return null;
      const on = b.d === 0 || b.ft <= Math.max(12, 10 * mpp);
      const kind = b.area ? meta.areaKinds[b.c] : meta.lineKinds[b.c];
      return [{ title: on ? 'Mapped water feature' : 'Nearest mapped stream or water body', html: '<p class="lead">' + esc(b.n || kind) + '</p>' +
        '<p class="sublead">' + (b.n ? esc(kind) + ', ' : '') + (on ? (b.area && b.d === 0 ? 'this spot is in it' : 'at this spot') : 'about ' + num(Math.round(b.ft / 10) * 10) + ' feet away') + '</p>' +
        '<p class="fineprint">USGS National Hydrography Dataset, high resolution (last release, 2023). Stream buffer rules apply in the Neuse, Tar-Pamlico, Jordan Lake, Catawba, Randleman and Goose Creek basins, and many towns add their own; perennial and intermittent streams usually count. NCDEQ or the local planning office makes the call on site.</p>' }];
    }
  };

  // ------------------------------------------------------------------ Johnston County school attendance zones
  const SZ_COLORS = ['#BFDBFE', '#FDE68A', '#BBF7D0', '#FBCFE8', '#DDD6FE', '#FED7AA', '#A5F3FC', '#FECACA', '#D9F99D', '#E9D5FF', '#FEF08A', '#C7D2FE'];
  const sz = { data: null, gj: null, level: 'Elementary', load: null };
  function inRing(x, y, ring) {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  function inGeom(lng, lat, g) {
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    return polys.some(p => inRing(lng, lat, p[0]) && !p.slice(1).some(h => inRing(lng, lat, h)));
  }
  function szStyle() {
    const names = sz.gj.features.filter(f => f.properties.l === sz.level).map(f => f.properties.n).sort();
    sz.data.setStyle(f => {
      const mine = f.getProperty('l') === sz.level;
      return { visible: mine, clickable: false, fillColor: SZ_COLORS[names.indexOf(f.getProperty('n')) % SZ_COLORS.length], fillOpacity: 0.32, strokeColor: '#1E3A8A', strokeWeight: 1.6, strokeOpacity: 0.85 };
    });
  }
  H['jc-schoolzones'] = {
    show() {
      const row = rowEls['jc-schoolzones'].querySelector('.extra');
      if (!row.innerHTML) {
        row.innerHTML = '<div class="sub"><label class="sr" for="sz-level">Show zones for</label><select id="sz-level">' +
          ['Elementary', 'Middle', 'High'].map(k => '<option>' + k + '</option>').join('') + '</select></div>';
        row.querySelector('select').addEventListener('change', e => { sz.level = e.target.value; if (sz.data) szStyle(); });
      }
      row.hidden = false;
      if (!sz.data) {
        sz.data = new google.maps.Data();
        sz.load = fetch('data/joco/school_zones.geojson').then(r => r.json()).then(gj => { sz.gj = gj; sz.data.addGeoJson(gj); szStyle(); })
          .catch(() => rowState('jc-schoolzones', 'School zones could not be loaded.', 'warn'));
      }
      sz.data.setMap(map);
    },
    hide() { if (sz.data) sz.data.setMap(null); rowEls['jc-schoolzones'].querySelector('.extra').hidden = true; },
    refresh() {},
    identify(lat, lng) {
      return [{ local: async () => {
        await sz.load;
        const hit = {};
        (sz.gj ? sz.gj.features : []).forEach(f => { if (inGeom(lng, lat, f.geometry)) hit[f.properties.l] = f.properties.n; });
        if (!Object.keys(hit).length) return null;
        return [{ title: 'Assigned schools (Johnston County)', html: '<dl>' + ['Elementary', 'Middle', 'High'].map(l => hit[l] ? '<dt>' + l + '</dt><dd>' + esc(hit[l]) + '</dd>' : '').join('') + '</dl>' +
          '<p class="fineprint">Johnston County Public Schools attendance zones from the county GIS site. Zones are redrawn when new schools open; confirm with the district.</p>' }];
      } }];
    }
  };

  // Ground elevation from North Carolina's statewide LiDAR elevation model (3-foot grid, feet above sea level).
  async function elevationAt(lat, lng) {
    const svc = 'https://services.nconemap.gov/secure/rest/services/Elevation/DEM03/ImageServer';
    const g = JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } });
    const [px, cat] = await Promise.all([
      arc(svc + '/identify', { geometry: g, geometryType: 'esriGeometryPoint', returnCatalogItems: false, returnGeometry: false }),
      arc(svc + '/query', { geometry: lng + ',' + lat, geometryType: 'esriGeometryPoint', inSR: 4326, spatialRel: 'esriSpatialRelIntersects', where: 'maxps <= 500', outFields: 'name', returnGeometry: false }).catch(() => null)]);
    const v = parseFloat(px && px.value);
    if (!isFinite(v)) return null;
    const src = cat && cat.features && cat.features[0] ? cat.features[0].attributes.name : '';
    const yr = (/(20\d\d)/.exec(src) || [])[1];
    return [{ title: 'Ground elevation', html: '<p class="lead">' + num(v) + ' ft above sea level</p><p class="sublead">North Carolina LiDAR, bare ground' + (yr ? ', ' + yr + ' flight' : '') + '</p>' +
      '<p class="fineprint">From NC OneMap\'s statewide 3-foot elevation model. Grading after the flight is not reflected. Use for screening; a survey governs.</p>' }];
  }
  // ------------------------------------------------------------------ attribute display
  const SKIP = /^(objectid|objectid_1|fid|gfid|shape|globalid|shape[._].*|st_area.*|st_length.*|created_.*|last_edited.*|editor|.*\.objectid|.*\.shape)$/i;
  function label(k, aliases) {
    let s = (aliases && aliases[k] && aliases[k] !== k) ? aliases[k] : k;
    s = s.split('.').pop().replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }
  function value(k, v, types) {
    if (v == null || v === '' || v === ' ') return null;
    const t = types && types[k];
    if (t === 'esriFieldTypeDate' && typeof v === 'number') return new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
    if (k === 'SFHA_TF') return (v === 'T' || v === 1) ? 'Yes' : 'No';
    if (typeof v === 'number') {
      if (v <= -9999) return null;
      if (/cost|val$|value|price/i.test(k)) return money(v);
      if (/year/i.test(k)) return String(v);
      return Number.isInteger(v) ? num(v) : String(Math.round(v * 100) / 100);
    }
    const s = String(v).trim();
    if (/^https?:\/\//i.test(s)) return '<a href="' + esc(s) + '" target="_blank" rel="noopener">Open link</a>';
    return esc(s);
  }
  function attrTable(a, pick, aliases, types) {
    const keys = pick ? pick.map(k => Array.isArray(k) ? k : [k, null]).filter(k => k[0] in a) : Object.keys(a).filter(k => !SKIP.test(k)).map(k => [k, null]);
    const rows = [];
    keys.slice(0, 16).forEach(k => { const v = value(k[0], a[k[0]], types); if (v != null) rows.push('<dt>' + esc(k[1] || label(k[0], aliases)) + '</dt><dd>' + v + '</dd>'); });
    if (!rows.length && pick) return attrTable(a, null, aliases, types);
    return rows.length ? '<dl>' + rows.join('') + '</dl>' : '<p class="fineprint">No details published for this feature.</p>';
  }
  function parcelHtml(a) {
    const site = [a.siteadd, a.scity].filter(Boolean).join(', ');
    const mail = [a.mailadd, a.mcity, a.mstate, a.mzip].filter(Boolean).join(', ');
    const rows = [];
    const add = (k, v) => { if (v != null && v !== '' && v !== 0) rows.push('<dt>' + k + '</dt><dd>' + v + '</dd>'); };
    add('Parcel ID', esc(a.parno || a.nparno || ''));
    add('Acres', a.gisacres ? (Math.round(a.gisacres * 100) / 100).toLocaleString('en-US') + ' (mapped)' : null);
    add('Assessed value', a.parval ? money(a.parval) : null);
    add('Land value', a.landval ? money(a.landval) : null);
    add('Building value', a.improvval ? money(a.improvval) : null);
    add('Last sale', a.saledate ? new Date(a.saledate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', timeZone: 'UTC' }) : esc(a.saledatetx || ''));
    add('Land use', esc(a.parusedesc || ''));
    add('Year built', a.structyear ? String(a.structyear) : null);
    add('Owner mailing', esc(mail));
    add('County', esc(a.cntyname || ''));
    add('State copy updated', a.transfdate ? new Date(a.transfdate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', timeZone: 'UTC' }) : null);
    return '<p class="lead">' + esc(a.ownname || 'Owner not listed') + '</p><p class="sublead">' + esc(site || 'No site address on file') + '</p><dl>' + rows.join('') + '</dl>';
  }

  // ------------------------------------------------------------------ click: what is at this spot
  function envelope(latLng, px) {
    const lat = latLng.lat(), lng = latLng.lng();
    const mpp = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, map.getZoom());
    const d = Math.max(px, 0.5) * mpp, dLat = d / 111320, dLng = d / (111320 * Math.cos(lat * Math.PI / 180));
    return [lng - dLng, lat - dLat, lng + dLng, lat + dLat].join(',');
  }
  function clearParcel() { parcelShapes.forEach(s => s.setMap(null)); parcelShapes = []; }
  function drawParcel(geom) {
    clearParcel();
    if (!geom || !geom.rings) return;
    parcelShapes.push(new google.maps.Polygon({ map: map, clickable: false, strokeColor: '#00E5FF', strokeWeight: 3, fillColor: '#00E5FF', fillOpacity: 0.12,
      paths: geom.rings.map(r => r.map(p => ({ lat: p[1], lng: p[0] }))) }));
  }
  function setPin(latLng) {
    if (pin) pin.setMap(null);
    pin = new HtmlMarker({ lat: latLng.lat(), lng: latLng.lng() }, 'mk-pin', '', null, 'Selected spot');
  }
  async function handleClick(latLng, extra) {
    if (state.measure) { measureAdd(latLng); return; }
    const seq = ++state.clickSeq, lat = latLng.lat(), lng = latLng.lng();
    setPin(latLng);
    showTab('here');
    const pane = $('#tab-here');
    const gm = 'https://www.google.com/maps/search/?api=1&query=' + lat.toFixed(6) + ',' + lng.toFixed(6);
    const sv = 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=' + lat.toFixed(6) + ',' + lng.toFixed(6);
    pane.innerHTML = '<div class="spot-head"><h2 id="spot-title">This spot</h2><p>' + lat.toFixed(5) + ', ' + lng.toFixed(5) +
      ' &nbsp;<a href="' + gm + '" target="_blank" rel="noopener">Google Maps</a> &nbsp;<a href="' + sv + '" target="_blank" rel="noopener">Street View</a></p></div>' +
      '<div id="spot-secs"></div><div id="spot-rings" class="sec"><h3>People within 1, 3 and 5 miles</h3><p class="loading">Adding up the area…</p></div>';
    const secs = $('#spot-secs');
    const addSec = (title, html) => { if (seq !== state.clickSeq) return; const d = document.createElement('div'); d.className = 'sec'; d.innerHTML = '<h3>' + esc(title) + '</h3>' + html; secs.appendChild(d); };
    (extra || []).forEach(x => addSec(x.title, x.html));
    geocoder.geocode({ location: latLng }).then(r => {
      if (seq === state.clickSeq && r.results && r.results[0]) $('#spot-title').textContent = r.results[0].formatted_address.replace(/, USA$/, '');
    }).catch(() => {});

    const tasks = [];
    let sawParcelLayer = false;
    const lost = '<p class="fineprint">This source did not answer. Click again in a moment.</p>';
    on.forEach(id => {
      const def = byId[id];
      if (def.minZoom && map.getZoom() < def.minZoom && id !== 'parcels') return;
      const idfs = def.identify || (H[id].identify ? H[id].identify(lat, lng) : null);
      if (!idfs || !idfs.length) return;
      // one placeholder per layer so slow sources show that they are still working
      const hold = document.createElement('div');
      hold.className = 'sec';
      hold.innerHTML = '<h3>' + esc(def.name) + '</h3><p class="loading">Looking this up…</p>';
      secs.appendChild(hold);
      let found = 0, failed = false;
      const put = (title, html) => { if (seq !== state.clickSeq) return; found++; const d = document.createElement('div'); d.className = 'sec'; d.innerHTML = '<h3>' + esc(title) + '</h3>' + html; secs.insertBefore(d, hold); };
      const jobs = idfs.map(idf => {
        if (idf.kind === 'parcel') sawParcelLayer = true;
        if (idf.local) return idf.local().then(rs => (rs || []).forEach(r => put(r.title, r.html)));
        if (idf.service) {             // one request for every sub-layer of the service
          const b = map.getBounds(), div = map.getDiv();
          const ask = tol => arc((idf.url || def.url) + '/identify', { geometry: lng + ',' + lat, geometryType: 'esriGeometryPoint', sr: 4326, layers: 'all:' + (idf.layers || def.layers).join(','), tolerance: tol,
            mapExtent: [b.getSouthWest().lng(), b.getSouthWest().lat(), b.getNorthEast().lng(), b.getNorthEast().lat()].join(','),
            imageDisplay: div.clientWidth + ',' + div.clientHeight + ',96', returnGeometry: false });
          const first = idf.src ? 0 : (idf.tol || 1);
          return ask(first).then(d => (d.results && d.results.length) || !idf.src ? d : ask(4)).then(d => {
            const seen = {};
            (d.results || []).forEach(r => {
              if (seen[r.layerName] || Object.keys(seen).length >= 3) return;   // one answer per sub-layer
              seen[r.layerName] = 1;
              const a = {};
              Object.keys(r.attributes).forEach(k => { if (r.attributes[k] !== 'Null' && r.attributes[k] !== '') a[k] = r.attributes[k]; });
              put(idf.src ? idf.title + ' (' + r.layerName + ')' : (r.layerName || idf.title), attrTable(a, idf.pick) + (idf.foot || ''));
            });
          });
        }
        const url = idf.url || (def.url + '/' + idf.layer);
        const tol = idf.tol || 1;
        const geom = tol <= 1 ? { geometry: lng + ',' + lat, geometryType: 'esriGeometryPoint' } : { geometry: envelope(latLng, tol), geometryType: 'esriGeometryEnvelope' };
        const base = { inSR: 4326, spatialRel: 'esriSpatialRelIntersects', outFields: '*', returnGeometry: !!idf.geometry, outSR: 4326, geometryPrecision: 6, resultRecordCount: 5 };
        // Zoning polygons often leave out the street, so widen the search a little when the exact point misses.
        return arc(url + '/query', Object.assign({}, geom, base)).then(d => (d.features && d.features.length) || !idf.src ? d :
          arc(url + '/query', Object.assign({ geometry: envelope(latLng, 5), geometryType: 'esriGeometryEnvelope' }, base))).then(d => {
          if (seq !== state.clickSeq) return;
          const types = {};
          (d.fields || []).forEach(f => { types[f.name] = f.type; });
          const seenZ = {};
          (d.features || []).slice(0, 3).forEach(f => {
            if (idf.src) { const k = zKey(f.attributes, idf.src); if (!k || seenZ[k]) return; seenZ[k] = 1; }
            if (idf.kind === 'parcel') { drawParcel(f.geometry); put('Parcel', parcelHtml(f.attributes)); }
            else put(idf.title, attrTable(f.attributes, idf.pick, d.fieldAliases, types) + (idf.foot || ''));
          });
        });
      });
      tasks.push(Promise.allSettled(jobs).then(rs => {
        failed = rs.some(r => r.status === 'rejected');
        if (seq !== state.clickSeq) return;
        if (failed && !found) hold.innerHTML = '<h3>' + esc(def.name) + '</h3>' + lost; else hold.remove();
      }));
    });
    if (!sawParcelLayer) clearParcel();
    if (on.has('demographics')) demoAt(latLng).then(html => { if (html) addSec('Census block group here', html); });
    Promise.allSettled(tasks).then(() => {
      if (seq !== state.clickSeq) return;
      if (!secs.children.length) secs.innerHTML = '<p class="empty">Nothing from the layers you have on at this spot. Turn on Parcels, zoning or flood zones in the Layers tab, then click again.</p>';
    });
    ringsAt(lat, lng).then(html => { if (seq === state.clickSeq) $('#spot-rings').innerHTML = '<h3>People within 1, 3 and 5 miles</h3>' + html; });
  }

  // ------------------------------------------------------------------ demographics
  const DEMO = {
    d: { name: 'Population density', unit: 'people per sq mi', breaks: [250, 1000, 2000, 4000, 7000], f: num },
    i: { name: 'Median household income', unit: '2025 dollars', breaks: [40000, 55000, 75000, 100000, 140000], f: money },
    a: { name: 'Median age', unit: 'years', breaks: [30, 35, 40, 45, 52], f: v => String(v) },
    o: { name: 'Owner-occupied homes', unit: '% of occupied homes', breaks: [30, 50, 65, 80, 90], f: v => v + '%' },
    gr: { name: 'County growth since the census survey', unit: '% population change', breaks: [0, 2, 4, 6, 8], f: v => v + '%' }
  };
  const RAMP = ['#F1EEF6', '#D0D1E6', '#A6BDDB', '#74A9CF', '#2B8CBE', '#045A8D'];
  const EDG = [0, 10e3, 15e3, 20e3, 25e3, 30e3, 35e3, 40e3, 45e3, 50e3, 60e3, 75e3, 100e3, 125e3, 150e3, 200e3, 250e3];
  let BG = null, BGP = null, BGMETA = null, demoData = null, demoLoad = null;
  function loadBG() {
    if (!BGP) BGP = fetch('data/bgpts.json').then(r => r.json()).then(j => { BG = j.rows; BGMETA = j.meta; });
    return BGP;
  }
  // Area-weighted ring totals: each block group is treated as a circle of its land area (same method as the Lidl map).
  function ringStats(la, lo, R, aged) {
    let P = 0, Hh = 0; const bins = new Array(16).fill(0);
    for (const r of BG) {
      const dy = (la - r[0]) * 69.0, dx = (lo - r[1]) * 69.172 * Math.cos((la + r[0]) / 2 * Math.PI / 180), d = Math.sqrt(dx * dx + dy * dy);
      const rr = Math.sqrt(Math.max(r[2], 1e-4) / Math.PI);
      if (d >= R + rr) continue;
      let w;
      if (d + rr <= R) w = 1;
      else if (d + R <= rr) w = R * R / (rr * rr);
      else {
        const a1 = Math.acos(Math.max(-1, Math.min(1, (d * d + rr * rr - R * R) / (2 * d * rr)))), a2 = Math.acos(Math.max(-1, Math.min(1, (d * d + R * R - rr * rr) / (2 * d * R))));
        const A = rr * rr * a1 + R * R * a2 - 0.5 * Math.sqrt(Math.max(0, (-d + rr + R) * (d + rr - R) * (d - rr + R) * (d + rr + R)));
        w = Math.min(1, A / (Math.PI * rr * rr));
      }
      const fa = aged ? (r[21] || 1) : 1;
      P += w * fa * r[3]; Hh += w * fa * r[4];
      for (let i = 0; i < 16; i++) bins[i] += w * fa * r[5 + i];
    }
    const t = bins.reduce((a, b) => a + b, 0);
    let cum = 0, med = null;
    for (let i = 0; i < 16 && t > 0; i++) { if (cum + bins[i] >= t / 2) { med = EDG[i] + (t / 2 - cum) / Math.max(bins[i], 1e-9) * (EDG[i + 1] - EDG[i]); break; } cum += bins[i]; }
    if (aged && med != null) med *= BGMETA.cpi;
    return { P: P, H: Hh, med: med };
  }
  async function ringsAt(la, lo) {
    try { await loadBG(); } catch (e) { return '<p class="fineprint">Demographic data could not be loaded.</p>'; }
    const s = [1, 3, 5].map(R => ringStats(la, lo, R, true)), raw = ringStats(la, lo, 3, false);
    const inc = m => m == null ? 'n/a' : m >= 250e3 ? '$250K+' : '$' + (m / 1000).toFixed(1) + 'K';
    return '<table class="rings"><thead><tr><th></th><th>1 mile</th><th>3 miles</th><th>5 miles</th></tr></thead><tbody>' +
      '<tr><td>Population</td>' + s.map(x => '<td>' + num(x.P) + '</td>').join('') + '</tr>' +
      '<tr><td>Households</td>' + s.map(x => '<td>' + num(x.H) + '</td>').join('') + '</tr>' +
      '<tr><td>Median household income</td>' + s.map(x => '<td>' + inc(x.med) + '</td>').join('') + '</tr></tbody></table>' +
      '<p class="fineprint">' + BGMETA.est_year + ' estimates: Census ACS ' + BGMETA.acs + ' block groups, aged with Census county population estimates, income by CPI. ' +
      'Unadjusted 3-mile figures: ' + num(raw.P) + ' people, ' + inc(raw.med) + '.</p>';
  }
  function demoColor(v, breaks) {
    if (v == null) return null;
    let i = 0;
    while (i < breaks.length && v >= breaks[i]) i++;
    return RAMP[i];
  }
  function demoStyle() {
    const cfg = DEMO[state.demoVar];
    demoData.setStyle(f => {
      const c = demoColor(f.getProperty(state.demoVar), cfg.breaks);
      return { fillColor: c || '#999', fillOpacity: c ? 0.62 : 0.08, strokeColor: '#334155', strokeOpacity: 0.35, strokeWeight: map.getZoom() >= 11 ? 0.6 : 0.15 };
    });
  }
  async function demoAt(latLng) {
    if (!demoData) return null;
    let hit = null;
    demoData.forEach(f => {
      if (hit) return;
      const g = f.getGeometry();
      const polys = g.getType() === 'Polygon' ? [g] : g.getArray();
      for (const p of polys) {
        const poly = new google.maps.Polygon({ paths: p.getArray().map(r => r.getArray()) });
        if (google.maps.geometry.poly.containsLocation(latLng, poly)) { hit = f; break; }
      }
    });
    if (!hit) return null;
    const g = k => hit.getProperty(k);
    return '<dl><dt>Population (2025 est.)</dt><dd>' + num(g('p')) + '</dd><dt>Households</dt><dd>' + num(g('h')) + '</dd>' +
      '<dt>Median household income</dt><dd>' + (g('i') ? money(g('i')) : 'n/a') + '</dd><dt>Median age</dt><dd>' + (g('a') || 'n/a') + '</dd>' +
      '<dt>People per sq mi</dt><dd>' + (g('d') != null ? num(g('d')) : 'n/a') + '</dd><dt>Owner-occupied</dt><dd>' + (g('o') != null ? g('o') + '%' : 'n/a') + '</dd>' +
      '<dt>' + esc(g('c')) + ' County growth</dt><dd>' + g('gr') + '% since the survey</dd></dl>';
  }
  H.demographics = {
    show() {
      const row = rowEls.demographics.querySelector('.extra');
      if (!row.innerHTML) {
        row.innerHTML = '<div class="sub"><label class="sr" for="demo-var">Shade by</label><select id="demo-var">' +
          Object.keys(DEMO).map(k => '<option value="' + k + '">' + DEMO[k].name + '</option>').join('') + '</select></div>';
        row.querySelector('select').value = state.demoVar;
        row.querySelector('select').addEventListener('change', e => { state.demoVar = e.target.value; if (demoData) demoStyle(); updateLegend(); writeHash(); });
      }
      row.hidden = false;
      if (!demoData) {
        demoData = new google.maps.Data();
        demoData.addListener('click', e => handleClick(e.latLng));
        rowState('demographics', 'Loading block groups…', 'hint');
        demoLoad = fetch('data/demographics_bg.geojson').then(r => r.json()).then(gj => { demoData.addGeoJson(gj); demoStyle(); rowState('demographics', ''); })
          .catch(() => rowState('demographics', 'Demographic data could not be loaded.', 'warn'));
      }
      demoData.setMap(map);
    },
    hide() { if (demoData) demoData.setMap(null); rowEls.demographics.querySelector('.extra').hidden = true; },
    refresh() { if (demoData && demoData.getMap()) demoStyle(); }
  };

  // ------------------------------------------------------------------ brands
  const BRAND_COLORS = { Coffee: '#6F4E37', QSR: '#D9480F', Grocery: '#2F855A', 'Big box': '#1D4ED8', Convenience: '#B7791F', Childcare: '#9D3C9D' };
  const brandState = { data: null, layer: null, cats: new Set(['Coffee', 'QSR', 'Grocery']), brand: '' };
  function brandStyle() {
    brandState.layer.setStyle(f => {
      const c = f.getProperty('c'), b = f.getProperty('b');
      const show = brandState.brand ? b === brandState.brand : brandState.cats.has(c);
      return { visible: show, title: b, icon: { path: google.maps.SymbolPath.CIRCLE, scale: map.getZoom() >= 11 ? 6 : 4, fillColor: BRAND_COLORS[c] || '#444', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 1.2 } };
    });
  }
  H.brands = {
    show() {
      const row = rowEls.brands.querySelector('.extra');
      row.hidden = false;
      if (brandState.layer) { brandState.layer.setMap(map); return; }
      brandState.layer = new google.maps.Data();
      brandState.layer.addListener('click', e => {
        const g = k => e.feature.getProperty(k);
        handleClick(e.latLng, [{ title: g('c'), html: '<p class="lead">' + esc(g('b')) + '</p><p class="sublead">' + esc([g('a'), g('t')].filter(Boolean).join(', ')) + '</p>' }]);
      });
      fetch('data/brands.json').then(r => r.json()).then(d => {
        brandState.data = d.locations;
        d.locations.forEach(x => brandState.layer.add(new google.maps.Data.Feature({ geometry: new google.maps.Data.Point({ lat: x.lat, lng: x.lng }), properties: x })));
        const names = Array.from(new Set(d.locations.map(x => x.b))).sort();
        row.innerHTML = '<div class="sub">' + Object.keys(BRAND_COLORS).map(c => '<label><input type="checkbox" value="' + c + '"' + (brandState.cats.has(c) ? ' checked' : '') + '>' +
          '<span class="sw dot" style="background:' + BRAND_COLORS[c] + ';margin:0"></span>' + c + '</label>').join('') +
          '<select aria-label="Show one brand"><option value="">All brands in the checked groups</option>' + names.map(n => '<option>' + esc(n) + '</option>').join('') + '</select></div>';
        row.querySelectorAll('input').forEach(i => i.addEventListener('change', () => { i.checked ? brandState.cats.add(i.value) : brandState.cats.delete(i.value); brandStyle(); }));
        row.querySelector('select').addEventListener('change', e => { brandState.brand = e.target.value; brandStyle(); });
        brandStyle();
      }).catch(() => rowState('brands', 'Brand locations could not be loaded.', 'warn'));
      brandState.layer.setMap(map);
    },
    hide() { if (brandState.layer) brandState.layer.setMap(null); rowEls.brands.querySelector('.extra').hidden = true; },
    refresh() {}
  };

  // ------------------------------------------------------------------ news
  const NEWS_COLORS = { Retail: '#D9480F', Industrial: '#475569', Office: '#1D4ED8', Housing: '#2F855A', 'Mixed-use': '#7A4EA3', Land: '#A16207' };
  const news = { items: null, cats: new Set(), tags: new Set(), days: 60, place: null, markers: [], visible: false, updated: '' };
  function newsFiltered(ignorePlace) {
    const cut = new Date(Date.now() - news.days * 864e5).toISOString().slice(0, 10);
    return (news.items || []).filter(i => i.d >= cut && (!news.cats.size || news.cats.has(i.cat)) &&
      (!news.tags.size || i.tags.some(t => news.tags.has(t))) && (ignorePlace || !news.place || i.place === news.place));
  }
  function newsMarkers() {
    news.markers.forEach(m => m.setMap(null)); news.markers = [];
    if (!news.visible) return;
    const groups = {};
    newsFiltered(true).filter(i => i.lat != null).forEach(i => { const k = i.lat.toFixed(3) + ',' + i.lng.toFixed(3); (groups[k] = groups[k] || []).push(i); });
    Object.keys(groups).forEach(k => {
      const g = groups[k], top = {};
      g.forEach(i => { top[i.cat] = (top[i.cat] || 0) + 1; });
      const cat = Object.keys(top).sort((a, b) => top[b] - top[a])[0];
      const m = new HtmlMarker({ lat: g[0].lat, lng: g[0].lng }, 'mk-news', String(g.length), () => { news.place = g[0].place; renderNews(); showTab('news'); },
        g[0].place + ': ' + g.length + (g.length === 1 ? ' headline' : ' headlines'));
      m.color = NEWS_COLORS[cat];
      news.markers.push(m);
    });
  }
  function renderNews() {
    const pane = $('#tab-news');
    if (!news.items) { pane.innerHTML = '<p class="empty">Loading headlines…</p>'; return; }
    const tagCounts = {};
    news.items.forEach(i => i.tags.forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));
    const tags = Object.keys(tagCounts).sort((a, b) => tagCounts[b] - tagCounts[a]);
    const list = newsFiltered();
    const chip = (v, set, cls) => '<button type="button" data-set="' + cls + '" data-v="' + esc(v) + '" aria-pressed="' + set.has(v) + '">' + esc(v) + '</button>';
    pane.innerHTML = (on.has('news') ? '' : '<p class="filterline">Headlines are listed here. Turn on Property news in Layers to see them on the map.</p>') +
      '<p class="filterline">Property type</p><div class="chips">' + Object.keys(NEWS_COLORS).map(c => chip(c, news.cats, 'cats')).join('') + '</div>' +
      '<p class="filterline">Use</p><div class="chips tags">' + tags.map(t => chip(t, news.tags, 'tags')).join('') + '</div>' +
      '<p class="filterline"><label>Published in the last <select id="news-days">' + [14, 30, 60, 120].map(d => '<option' + (d === news.days ? ' selected' : '') + '>' + d + '</option>').join('') + '</select> days</label></p>' +
      '<p class="filterline">' + list.length + (list.length === 1 ? ' headline' : ' headlines') + (news.place ? ' in ' + esc(news.place) + ' <button class="more" type="button" id="news-all">Show all places</button>' : '') +
      (news.updated ? '. Updated ' + esc(news.updated.slice(0, 10)) : '') + '</p>' +
      (list.length ? list.slice(0, 150).map(i => '<div class="item"><a class="t" href="' + esc(i.u) + '" target="_blank" rel="noopener">' + esc(i.t) + '</a>' +
        '<div class="m"><span class="tag" style="background:' + NEWS_COLORS[i.cat] + '">' + esc(i.cat) + '</span>' + esc(i.s) + ', ' + esc(i.d) +
        (i.lat != null ? ' &nbsp;<button type="button" data-lat="' + i.lat + '" data-lng="' + i.lng + '">' + esc(i.place) + (i.approx ? ' (town center)' : '') + '</button>' : '') + '</div></div>').join('')
        : '<p class="empty">No headlines match these filters. Clear a filter or widen the date range.</p>');
    pane.querySelectorAll('.chips button').forEach(b => b.addEventListener('click', () => {
      const set = news[b.dataset.set]; set.has(b.dataset.v) ? set.delete(b.dataset.v) : set.add(b.dataset.v); renderNews(); newsMarkers();
    }));
    pane.querySelector('#news-days').addEventListener('change', e => { news.days = +e.target.value; renderNews(); newsMarkers(); });
    const all = pane.querySelector('#news-all');
    if (all) all.addEventListener('click', () => { news.place = null; renderNews(); });
    pane.querySelectorAll('.item .m button').forEach(b => b.addEventListener('click', () => { map.moveCamera({ center: { lat: +b.dataset.lat, lng: +b.dataset.lng }, zoom: Math.max(map.getZoom(), 11) }); }));
  }
  function loadNews() {
    if (news.loading) return news.loading;
    news.loading = fetch('data/news.json').then(r => r.json()).then(d => { news.items = d.items; news.updated = d.updated; renderNews(); newsMarkers(); })
      .catch(() => { $('#tab-news').innerHTML = '<p class="empty">Headlines could not be loaded. Reload the page to try again.</p>'; });
    return news.loading;
  }
  H.news = { show() { news.visible = true; loadNews().then(() => { renderNews(); newsMarkers(); }); }, hide() { news.visible = false; newsMarkers(); if (news.items) renderNews(); }, refresh() {} };

  // ------------------------------------------------------------------ SAS listings
  const TYPE_COLOR = { 'For Lease': '#2563EB', 'For Sale': '#DC2626', 'Ground Lease': '#16A34A', 'For Sale or Lease': '#9333EA', 'For Sale or Ground Lease': '#EA580C' };
  const listings = { items: null, markers: [], visible: false, active: -1 };
  async function loadListings() {
    if (listings.loading) return listings.loading;
    listings.loading = (async () => {
      let items = null;
      try {
        const html = await (await fetch(CFG.listingsUrl, { cache: 'no-cache' })).text();
        const m = /const LISTINGS = (\[[\s\S]*?\n\]);/.exec(html);
        if (m) items = JSON.parse(m[1]);
      } catch (e) { /* fall through to the snapshot */ }
      if (!items) items = await (await fetch(CFG.listingsFallback)).json();
      listings.items = items;
      renderListings();
      for (const l of items) {             // geocode with the Maps key; cached in the browser afterwards
        const q = l.address + ', ' + l.city, key = 'sight-geo:' + q;
        let c = null;
        try { c = JSON.parse(localStorage.getItem(key)); } catch (e) {}
        if (!c) {
          try {
            const r = await geocoder.geocode({ address: q, region: 'us' });
            const loc = r.results[0].geometry.location;
            c = { lat: loc.lat(), lng: loc.lng() };
            try { localStorage.setItem(key, JSON.stringify(c)); } catch (e) {}
          } catch (e) { c = null; }
        }
        l._pos = c;
      }
      listingMarkers();
    })();
    return listings.loading;
  }
  function listingMarkers() {
    listings.markers.forEach(m => m.setMap(null)); listings.markers = [];
    if (!listings.visible || !listings.items) return;
    listings.items.forEach((l, i) => {
      if (!l._pos) return;
      const m = new HtmlMarker(l._pos, 'mk-listing' + (i === listings.active ? ' active' : ''), '', () => selectListing(i, false), l.name + ' (' + l.type + ')');
      m.color = TYPE_COLOR[l.type] || '#C9A249';
      listings.markers.push(m);
    });
  }
  function selectListing(i, pan) {
    listings.active = i;
    renderListings(); listingMarkers(); showTab('listings');
    const card = document.querySelector('.card.active');
    if (card) card.scrollIntoView({ block: 'nearest' });
    const l = listings.items[i];
    if (pan && l._pos) map.moveCamera({ center: l._pos, zoom: Math.max(map.getZoom(), 15) });
  }
  function renderListings() {
    const pane = $('#tab-listings');
    if (!listings.items) { pane.innerHTML = '<p class="empty">Loading listings…</p>'; return; }
    pane.innerHTML = '<p class="filterline">' + listings.items.length + ' South Atlantic Sites listings. Select one to zoom to it.</p>' +
      listings.items.map((l, i) => '<div class="card' + (i === listings.active ? ' active' : '') + '" data-i="' + i + '" tabindex="0">' +
        '<span class="ty" style="color:' + (TYPE_COLOR[l.type] ? '#fff' : '#fff') + '"><span class="tag" style="background:' + (TYPE_COLOR[l.type] || '#C9A249') + '">' + esc(l.type) + '</span></span>' +
        '<h3>' + esc(l.name) + '</h3><p>' + esc(l.address + ', ' + l.city) + '</p>' +
        '<p class="facts">' + esc([l.size, l.price].filter(Boolean).join(', ')) + '</p>' +
        (i === listings.active ? '<p>' + esc(l.highlights || '') + '</p><p>Zoning ' + esc(l.zoning || 'n/a') + '. ' + esc(l.use || '') + '. Available: ' + esc(l.available || 'n/a') + '.</p>' +
          '<p>Contact ' + esc(l.broker || 'South Atlantic Sites') + (l.flyer ? ' &nbsp;<a href="' + esc(l.flyer) + '" target="_blank" rel="noopener">Open the flyer</a>' : '') + '</p>' : '') + '</div>').join('');
    pane.querySelectorAll('.card').forEach(c => {
      const go = e => { if (e.target.tagName === 'A') return; selectListing(+c.dataset.i, true); };
      c.addEventListener('click', go);
      c.addEventListener('keydown', e => { if (e.key === 'Enter') go(e); });
    });
  }
  H.listings = { show() { listings.visible = true; loadListings().then(listingMarkers); }, hide() { listings.visible = false; listingMarkers(); }, refresh() {} };

  // ------------------------------------------------------------------ planned schools / fire stations
  const planned = { items: null, markers: [] };
  H.planned = {
    show() {
      (planned.items || []).forEach(p => planned.markers.push(new HtmlMarker({ lat: p.lat, lng: p.lng }, 'mk-planned', '', () =>
        handleClick(new google.maps.LatLng(p.lat, p.lng), [{ title: 'Planned ' + (p.kind || 'facility'), html: '<p class="lead">' + esc(p.name) + '</p><p class="sublead">' + esc(p.status || '') + '</p>' +
          (p.source ? '<p><a href="' + esc(p.source) + '" target="_blank" rel="noopener">Source</a></p>' : '') }]), p.name)));
    },
    hide() { planned.markers.forEach(m => m.setMap(null)); planned.markers = []; },
    refresh() {}
  };

  // ------------------------------------------------------------------ zoning (many sources, shown by area)
  const ZSRC = window.SIGHT_ZONING || [];
  const ZPAL = ['#F6E27A', '#F4A259', '#E76F51', '#C9ADA7', '#9D8DF1', '#74C0FC', '#63E6BE', '#B2F2BB', '#FFC9C9', '#D0BFFF', '#FFD8A8', '#A5D8FF', '#E599F7', '#C0EB75', '#FFA8A8', '#99E9F2'];
  const zoning = { subs: {}, visible: false };
  function zKey(p, src) {
    for (const f of src.f) if (p[f] != null && p[f] !== '') return String(p[f]);
    for (const k in p) if (/zon|class|district/i.test(k) && typeof p[k] === 'string' && p[k].trim()) return p[k];
    return '';
  }
  function zColor(code) { let h = 0; for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0; return ZPAL[h % ZPAL.length]; }
  function makeZoningFeatures(src) {
    const data = new google.maps.Data();
    let vis = false, seq = 0;
    data.setStyle(f => ({ clickable: false, fillColor: zColor(f.getProperty('__z') || ''), fillOpacity: 0.5, strokeColor: '#5B4A1E', strokeWeight: 0.7, strokeOpacity: 0.8 }));
    async function refresh() {
      if (!vis) return;
      const b = map.getBounds();
      if (!b) return;
      const my = ++seq, sw = b.getSouthWest(), ne = b.getNorthEast();
      const p = { where: '1=1', geometry: [sw.lng(), sw.lat(), ne.lng(), ne.lat()].join(','), geometryType: 'esriGeometryEnvelope', inSR: 4326, spatialRel: 'esriSpatialRelIntersects',
        outFields: '*', outSR: 4326, f: 'geojson', resultRecordCount: 2000, maxAllowableOffset: (ne.lng() - sw.lng()) / 1500, geometryPrecision: 6 };
      try {
        // Parcel-by-parcel zoning can exceed one response, so read up to four pages per layer.
        const pull = async id => {
          const all = [];
          for (let page = 0; page < 4; page++) {
            const gj = await fetch(src.u + '/' + id + '/query?' + qs(Object.assign({ resultOffset: page * 2000 }, p))).then(r => r.json());
            if (!gj || !gj.features) break;
            all.push(gj);
            const more = gj.exceededTransferLimit || (gj.properties && gj.properties.exceededTransferLimit);
            if (!more || gj.features.length < 2000) break;
          }
          return all;
        };
        const sets = [].concat.apply([], await Promise.all(src.l.map(pull)));
        if (my !== seq || !vis) return;
        data.forEach(f => data.remove(f));
        sets.forEach(gj => {
          gj.features.forEach(f => { f.properties = { __z: zKey(f.properties || {}, src) }; delete f.id; });
          data.addGeoJson(gj);
        });
      } catch (e) { if (my === seq) rowState('zoning', 'A zoning source for this area is not responding right now.', 'warn'); }
    }
    return { show() { vis = true; data.setMap(map); refresh(); }, hide() { vis = false; seq++; data.setMap(null); data.forEach(f => data.remove(f)); }, refresh: refresh };
  }
  H.zoning = {
    show() { zoning.visible = true; this.refresh(); },
    hide() { zoning.visible = false; Object.keys(zoning.subs).forEach(i => { const s = zoning.subs[i]; if (s.on) { s.h.hide(); s.on = false; } }); },
    refresh() {
      if (!zoning.visible) return;
      const z = map.getZoom(), b = map.getBounds();
      if (!b) return;
      const sw = b.getSouthWest(), ne = b.getNorthEast();
      const hits = z >= 11 ? ZSRC.map((s, i) => ({ s: s, i: i })).filter(o => o.s.b[0] < ne.lng() && o.s.b[2] > sw.lng() && o.s.b[1] < ne.lat() && o.s.b[3] > sw.lat()) : [];
      const show = hits.filter(o => z >= o.s.z).slice(0, 12);
      const want = new Set(show.map(o => o.i));
      Object.keys(zoning.subs).forEach(i => { const s = zoning.subs[i]; if (s.on && !want.has(+i)) { s.h.hide(); s.on = false; } });
      show.forEach(o => {
        let sub = zoning.subs[o.i];
        if (!sub) sub = zoning.subs[o.i] = { on: false, h: o.s.t === 'x' ? makeImageLayer({ id: 'zoning', type: 'arcgis', url: o.s.u, layers: o.s.l, opacity: 0.6, swatch: '#D9A441' }) : makeZoningFeatures(o.s) };
        if (!sub.on) { sub.on = true; sub.h.show(); } else sub.h.refresh();
      });
      if (z < 11) return;
      const wait = hits.filter(o => z < o.s.z).map(o => o.s.n);
      rowState('zoning', !hits.length ? 'No zoning source is loaded for this area yet.' :
        (show.length ? 'Sources in this view: ' + show.map(o => o.s.n).join('; ') + '.' : '') + (wait.length ? ' Zoom in more for ' + wait.join('; ') + '.' : ''), 'info');
    },
    identify(lat, lng) {
      const out = [];
      ZSRC.filter(s => lng >= s.b[0] && lng <= s.b[2] && lat >= s.b[1] && lat <= s.b[3]).slice(0, 6).forEach(s => {
        const foot = '<p class="fineprint">From the public map service for ' + esc(s.n) + (s.d ? ', catalog entry dated ' + esc(s.d) : '') + '. Zoning changes often; confirm with the planning office.</p>';
        if (s.t === 'x' && s.l.length > 1) out.push({ service: true, url: s.u, layers: s.l, title: 'Zoning', tol: 1, src: s, foot: foot });
        else s.l.slice(0, 6).forEach(id => out.push({ url: s.u + '/' + id, title: 'Zoning: ' + s.n, tol: 1, pick: s.f, src: s, foot: foot }));
      });
      return out;
    }
  };

  // ------------------------------------------------------------------ sewer lines (many utilities, shown by area)
  const SSRC = window.SIGHT_SEWER || [];
  const SEWER_ZOOM = 14, SEWER_REACH = 0.007;
  const jcSewerDef = { id: 'sewer', render: 'sewer', grid: 'data/joco/sewer', minZoom: 11, reach: 0.008,
    hitFilter: c => { const m = jcSewer.meta(), p = m && m.props[c]; return !!p && /Gravity|Force/.test(p[0] || ''); } };
  const jcSewer = makeGridLayer(jcSewerDef);
  const sewer = { vis: false, subs: {} };
  const sVal = (a, f) => f && a[f] != null && String(a[f]).trim() !== '' ? a[f] : null;
  const sDiam = v => { const n = parseFloat(v); return isFinite(n) && n > 0 && n < 200 ? n : null; };
  const sYear = v => { if (v == null || v === '') return null; const n = +v; if (!isFinite(n)) return null; const y = Math.abs(n) > 1e9 ? new Date(n).getUTCFullYear() : n; return y >= 1910 && y <= 2100 ? Math.round(y) : null; };
  const sKind = (src, a) => src.f.t && /force|press/i.test(String(a[src.f.t] || '')) ? 'f' : src.k;
  const sFields = src => ['d', 'm', 'y', 'o', 't'].map(k => src.f[k]).filter(Boolean).join(',') || '*';
  function sewerStyle(kind, d) { return { clickable: false, strokeColor: kind === 'f' ? '#C2410C' : '#15803D', strokeOpacity: 0.9, strokeWeight: d >= 16 ? 4 : d >= 10 ? 3 : 2 }; }
  function makeSewerSource(src) {
    const data = new google.maps.Data();
    let vis = false, seq = 0;
    data.setStyle(f => sewerStyle(f.getProperty('k'), f.getProperty('d') || 8));
    async function refresh() {
      if (!vis) return;
      const b = map.getBounds();
      if (!b) return;
      const my = ++seq, sw = b.getSouthWest(), ne = b.getNorthEast();
      const p = { where: src.w || '1=1', geometry: [sw.lng(), sw.lat(), ne.lng(), ne.lat()].join(','), geometryType: 'esriGeometryEnvelope', inSR: 4326, spatialRel: 'esriSpatialRelIntersects',
        outFields: sFields(src), outSR: 4326, f: 'geojson', resultRecordCount: 1000, maxAllowableOffset: (ne.lng() - sw.lng()) / 2500, geometryPrecision: 6 };
      try {
        const all = [];
        for (let page = 0; page < 8; page++) {
          const gj = await fetch(src.u + '/query?' + qs(Object.assign({ resultOffset: page * 1000 }, p))).then(r => r.json());
          if (!gj || !gj.features) break;
          all.push(gj);
          const more = gj.exceededTransferLimit || (gj.properties && gj.properties.exceededTransferLimit);
          if (!more || gj.features.length < 1000 || my !== seq) break;
        }
        if (my !== seq || !vis) return;
        data.forEach(f => data.remove(f));
        all.forEach(gj => {
          gj.features.forEach(f => { const a = f.properties || {}; f.properties = { k: sKind(src, a), d: sDiam(sVal(a, src.f.d)) }; delete f.id; });
          data.addGeoJson(gj);
        });
      } catch (e) { if (my === seq) rowState('sewer', 'A sewer map for this area (' + src.n + ') is not responding right now.', 'warn'); }
    }
    return { show() { vis = true; data.setMap(map); refresh(); }, hide() { vis = false; seq++; data.setMap(null); data.forEach(f => data.remove(f)); }, refresh: refresh };
  }
  const sHit = (s, w, so, e, n) => s.b[0] < e && s.b[2] > w && s.b[1] < n && s.b[3] > so;
  function nearestInGeoJson(gj, lat, lng) {
    const [px, py] = worldPx(lat, lng);
    let best = null;
    (gj.features || []).forEach(f => {
      const g = f.geometry; if (!g) return;
      const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
      lines.forEach(line => {
        const a = [];
        line.forEach(c => { const w = worldPx(c[1], c[0]); a.push(w[0], w[1]); });
        for (let i = 0; i + 3 < a.length; i += 2) { const d = segDist(px, py, a, i); if (!best || d < best.d) best = { d: d, a: f.properties || {} }; }
      });
    });
    if (best) best.ft = best.d * (40075016.686 / 256) * Math.cos(lat * Math.PI / 180) * 3.28084;
    return best;
  }
  async function sewerNearest(lat, lng) {
    const R = SEWER_REACH, cands = [];
    const srcs = SSRC.filter(s => sHit(s, lng - R, lat - R, lng + R, lat + R));
    const jobs = srcs.map(src => arc(src.u + '/query', { where: src.w || '1=1', geometry: [lng - R, lat - R, lng + R, lat + R].join(','), geometryType: 'esriGeometryEnvelope', inSR: 4326,
      spatialRel: 'esriSpatialRelIntersects', outFields: sFields(src), outSR: 4326, f: 'geojson', resultRecordCount: 2000, geometryPrecision: 6 })
      .then(gj => { const b = nearestInGeoJson(gj, lat, lng); if (b) cands.push({ ft: b.ft, util: sVal(b.a, src.f.o) ? String(sVal(b.a, src.f.o)).trim() + ' (via ' + src.n + ')' : src.n,
        kind: sKind(src, b.a), d: sDiam(sVal(b.a, src.f.d)), m: sVal(b.a, src.f.m), y: sYear(sVal(b.a, src.f.y)) }); })
      .catch(() => cands.push({ err: src.n })));
    jobs.push(jcSewer.nearest(lat, lng, 0.008).then(b => {
      if (!b) return;
      const p = jcSewer.meta().props[b.c] || [];
      cands.push({ ft: b.ft, util: 'Johnston County Public Utilities', kind: /Force/.test(p[0] || '') ? 'f' : 'g', d: p[1], m: p[2], y: p[3] });
    }).catch(() => {}));
    await Promise.all(jobs);
    const ok = cands.filter(c => !c.err).sort((a, b) => a.ft - b.ft), errs = cands.filter(c => c.err).map(c => c.err);
    const foot = '<p class="fineprint">From each utility\'s public sewer map. Capacity, depth, allocation and permission to connect have to be confirmed with the utility. Private lines are not shown.' +
      (errs.length ? ' Not responding just now: ' + esc(Array.from(new Set(errs)).join('; ')) + '.' : '') + '</p>';
    if (!ok.length) {
      const covered = srcs.length || (jcSewer.meta() && lng > -78.75 && lng < -78.05 && lat > 35.25 && lat < 35.82);
      return [{ title: 'Public sewer', html: '<p class="sublead">' + (covered ? 'No mapped public sewer line within about 2,000 feet.' : 'No public sewer map is loaded for this area yet. Durham, Greensboro, Burlington, High Point, Clayton and several other towns do not publish theirs.') + '</p>' + foot }];
    }
    const c = ok[0], mpp = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, map.getZoom()) * 3.28084, at = c.ft <= Math.max(12, 10 * mpp);
    const rows = [['Utility', c.util], ['Type', c.kind === 'f' ? 'Force main (pressure)' : 'Gravity sewer'], ['Diameter (in)', c.d], ['Material', c.m], ['Year installed', c.y]]
      .map(r => r[1] != null && r[1] !== '' ? '<dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd>' : '').join('');
    const others = [];
    ok.slice(1).forEach(o => { if (o.util !== c.util && others.length < 2 && !others.some(x => x.util === o.util)) others.push(o); });
    return [{ title: at ? 'Public sewer line' : 'Nearest public sewer line', html: '<p class="lead">' + esc((c.d ? c.d + '-inch ' : '') + (c.kind === 'f' ? 'force main' : 'gravity sewer')) + '</p>' +
      '<p class="sublead">' + (at ? 'At this spot' : 'About ' + num(Math.round(c.ft / 10) * 10) + ' feet away, straight line') + '</p><dl>' + rows + '</dl>' +
      (others.length ? '<p class="sublead">Also nearby: ' + others.map(o => esc(o.util) + ', about ' + num(Math.round(o.ft / 10) * 10) + ' ft').join('; ') + '</p>' : '') + foot }];
  }
  H.sewer = {
    show() { sewer.vis = true; jcSewer.show(); this.refresh(); },
    hide() { sewer.vis = false; jcSewer.hide(); Object.keys(sewer.subs).forEach(i => { const s = sewer.subs[i]; if (s.on) { s.h.hide(); s.on = false; } }); },
    refresh() {
      if (!sewer.vis) return;
      const z = map.getZoom(), b = map.getBounds();
      if (!b) return;
      const sw = b.getSouthWest(), ne = b.getNorthEast();
      const hits = SSRC.map((s, i) => ({ s: s, i: i })).filter(o => sHit(o.s, sw.lng(), sw.lat(), ne.lng(), ne.lat()));
      const show = z >= SEWER_ZOOM ? hits : [];
      const want = new Set(show.map(o => o.i));
      Object.keys(sewer.subs).forEach(i => { const s = sewer.subs[i]; if (s.on && !want.has(+i)) { s.h.hide(); s.on = false; } });
      show.forEach(o => {
        let sub = sewer.subs[o.i];
        if (!sub) sub = sewer.subs[o.i] = { on: false, h: makeSewerSource(o.s) };
        if (!sub.on) { sub.on = true; sub.h.show(); } else sub.h.refresh();
      });
      const names = Array.from(new Set(hits.map(o => o.s.n)));
      rowState('sewer', !names.length ? 'No city or town sewer map in this view (Johnston County pipes show where available).' :
        (z >= SEWER_ZOOM ? 'In this view: ' : 'Zoom in to see pipes from: ') + names.join('; ') + '.', 'info');
    },
    identify(lat, lng) { return [{ local: () => sewerNearest(lat, lng) }]; }
  };

  // ------------------------------------------------------------------ legend
  function updateLegend() {
    const box = $('#legend'), parts = [];
    if (on.has('demographics')) {
      const cfg = DEMO[state.demoVar], b = cfg.breaks;
      const labels = ['Under ' + cfg.f(b[0])].concat(b.slice(0, -1).map((x, i) => cfg.f(x) + ' to ' + cfg.f(b[i + 1])), [cfg.f(b[b.length - 1]) + ' or more']);
      parts.push('<h4>' + cfg.name + ' <span style="font-weight:400">(' + cfg.unit + ')</span></h4>' + labels.map((l, i) => '<div class="row"><i style="background:' + RAMP[i] + '"></i>' + l + '</div>').join('') +
        '<p>Census block groups, 2025 estimates.</p>');
    }
    if (on.has('news')) parts.push('<h4>Property news</h4>' + Object.keys(NEWS_COLORS).map(c => '<div class="row"><i class="dot" style="background:' + NEWS_COLORS[c] + '"></i>' + c + '</div>').join(''));
    if (on.has('listings') && !window.matchMedia('(max-width:760px)').matches) parts.push('<h4>SAS listings</h4>' + Object.keys(TYPE_COLOR).map(c => '<div class="row"><i class="dot" style="background:' + TYPE_COLOR[c] + '"></i>' + c + '</div>').join(''));
    if (on.has('sewer')) parts.push('<h4>Sewer lines</h4><div class="row"><i style="background:#15803D;height:3px"></i>Gravity sewer</div><div class="row"><i style="background:#C2410C;height:3px"></i>Force main</div><p>Thicker lines are larger pipes. Zoom 14+ to see them.</p>');
    box.hidden = !parts.length;
    box.innerHTML = parts.slice(0, 2).join('<div style="height:8px"></div>');
  }

  // ------------------------------------------------------------------ search
  function searchResults(html) { const r = $('#search-results'); r.hidden = !html; r.innerHTML = html || ''; }
  async function runSearch(mode, q) {
    q = q.trim();
    if (!q) return;
    if (mode === 'address') {
      searchResults('<p>Searching…</p>');
      try {
        const r = await geocoder.geocode({ address: q, componentRestrictions: { administrativeArea: 'NC', country: 'US' } });
        const res = r.results[0], loc = res.geometry.location;
        searchResults('');
        if (res.geometry.viewport && !/street_address|premise|subpremise|route|intersection/.test(res.types.join(','))) map.fitBounds(res.geometry.viewport);
        else map.moveCamera({ center: loc, zoom: 17 });
        google.maps.event.addListenerOnce(map, 'idle', () => handleClick(loc));
      } catch (e) { searchResults('<p>No match in North Carolina. Check the spelling or add the town.</p>'); }
      return;
    }
    searchResults(mode === 'owner' ? '<p>Searching North Carolina parcels…</p>' : '<p>Searching all 100 counties. Parcel ID lookups on the state server can take up to a minute.</p>');
    const safe = q.toUpperCase().replace(/'/g, "''");
    const where = mode === 'owner' ? "ownname LIKE '" + safe + "%'" : "parno = '" + safe + "' OR altparno = '" + safe + "' OR nparno = '" + safe + "'";
    const purl = byId.parcels.url + '/1/query';
    try {
      const d = await arc(purl, { where: where, outFields: 'objectid,ownname,siteadd,scity,cntyname,parno,gisacres', returnGeometry: false, resultRecordCount: 40 });
      const f = d.features || [];
      if (!f.length) { searchResults(mode === 'owner' ? '<p>No owner name starts with that. County records list last name first, for example SMITH JOHN, or the LLC name.</p>' : '<p>No parcel with that ID. IDs follow each county\'s own format.</p>'); return; }
      searchResults(f.map((x, i) => '<button type="button" data-i="' + i + '">' + esc(x.attributes.ownname || 'Owner not listed') + '<small>' +
        esc([x.attributes.siteadd, x.attributes.scity, (x.attributes.cntyname || '') + ' County', x.attributes.gisacres ? (Math.round(x.attributes.gisacres * 100) / 100) + ' ac' : ''].filter(Boolean).join(', ')) + '</small></button>').join('') +
        (f.length >= 40 ? '<p>Showing the first 40. Type more of the name to narrow it.</p>' : ''));
      $('#search-results').querySelectorAll('button').forEach(b => b.addEventListener('click', async () => {
        b.insertAdjacentHTML('beforeend', '<small>Opening…</small>');
        try {
          const g = await arc(purl, { objectIds: f[+b.dataset.i].attributes.objectid, outFields: '*', returnGeometry: true, outSR: 4326, geometryPrecision: 6 });
          const ft = g.features[0], bb = new google.maps.LatLngBounds();
          ft.geometry.rings.forEach(r => r.forEach(p => bb.extend({ lat: p[1], lng: p[0] })));
          if (!on.has('parcels')) setLayer('parcels', true);
          map.fitBounds(bb, 120);
          if (pin) { pin.setMap(null); pin = null; }
          state.clickSeq++;
          drawParcel(ft.geometry);
          showTab('here');
          $('#tab-here').innerHTML = '<div class="spot-head"><h2>' + esc(ft.attributes.siteadd || ft.attributes.ownname || 'Parcel') + '</h2><p>Found by ' + (mode === 'owner' ? 'owner' : 'parcel ID') + ' search. Click the map for zoning, flood and the surrounding population.</p></div>' +
            '<div class="sec"><h3>Parcel</h3>' + parcelHtml(ft.attributes) + '</div>';
        } catch (e) { b.insertAdjacentHTML('beforeend', '<small>The state server did not answer. Try again.</small>'); }
      }));
    } catch (e) { searchResults('<p>The parcel search did not answer. The state server is sometimes slow; try again in a moment.</p>'); }
  }

  // ------------------------------------------------------------------ measure
  function measureStart() {
    state.measure = { pts: [], line: new google.maps.Polyline({ map: map, strokeColor: '#E11D48', strokeWeight: 3, clickable: false }),
      poly: new google.maps.Polygon({ map: map, strokeOpacity: 0, fillColor: '#E11D48', fillOpacity: 0.12, clickable: false }), dots: [] };
    $('#measure').hidden = false; $('#t-measure').setAttribute('aria-pressed', 'true');
    map.setOptions({ draggableCursor: 'crosshair' });
    measureRead();
  }
  function measureStop() {
    const m = state.measure;
    if (!m) return;
    m.line.setMap(null); m.poly.setMap(null); m.dots.forEach(d => d.setMap(null));
    state.measure = null;
    $('#measure').hidden = true; $('#t-measure').setAttribute('aria-pressed', 'false');
    map.setOptions({ draggableCursor: null });
  }
  function measureAdd(latLng) {
    const m = state.measure;
    m.pts.push(latLng);
    m.dots.push(new HtmlMarker({ lat: latLng.lat(), lng: latLng.lng() }, 'mk-vertex', '', null, ''));
    measureRead();
  }
  function measureRead() {
    const m = state.measure, S = google.maps.geometry.spherical;
    m.line.setPath(m.pts); m.poly.setPaths(m.pts.length >= 3 ? [m.pts] : []);
    if (m.pts.length < 2) { $('#m-read').textContent = m.pts.length ? 'Click the next point.' : 'Click the map to start measuring.'; return; }
    const ft = S.computeLength(m.pts) * 3.28084;
    let t = num(ft) + ' ft' + (ft >= 1320 ? ' (' + (ft / 5280).toFixed(2) + ' mi)' : '');
    if (m.pts.length >= 3) { const ac = S.computeArea(m.pts) / 4046.8564224; t += ', enclosing ' + (ac >= 100 ? num(ac) : ac.toFixed(2)) + ' acres'; }
    $('#m-read').textContent = t;
  }

  // ------------------------------------------------------------------ start-up
  function defineHtmlMarker() {
    HtmlMarker = class extends google.maps.OverlayView {
      constructor(pos, cls, text, onClick, title) {
        super();
        this.pos = new google.maps.LatLng(pos.lat, pos.lng); this.cls = cls; this.text = text; this.onClick = onClick; this.title = title; this.color = null;
        this.setMap(map);
      }
      onAdd() {
        const d = this.div = document.createElement('div');
        d.className = 'mk ' + this.cls; d.textContent = this.text;
        if (this.title) d.title = this.title;
        if (this.color) d.style.background = this.color;
        if (this.onClick) { d.addEventListener('click', e => { e.stopPropagation(); this.onClick(); }); google.maps.OverlayView.preventMapHitsFrom(d); }
        else d.style.pointerEvents = 'none';
        this.getPanes()[this.onClick ? 'overlayMouseTarget' : 'overlayLayer'].appendChild(d);
      }
      draw() {
        const p = this.getProjection().fromLatLngToDivPixel(this.pos);
        if (p && this.div) { this.div.style.left = p.x + 'px'; this.div.style.top = p.y + 'px'; }
      }
      onRemove() { if (this.div) { this.div.remove(); this.div = null; } }
    };
  }

  window.sightInit = async function () {
    await Promise.all(['maps', 'geometry', 'geocoding'].map(l => google.maps.importLibrary(l)));
    const h = readHash(), c = (h.c || '').split(',').map(Number);
    if (h.v && DEMO[h.v]) state.demoVar = h.v;
    map = new google.maps.Map($('#map'), {
      center: c.length === 2 && isFinite(c[0]) && isFinite(c[1]) ? { lat: c[0], lng: c[1] } : { lat: CFG.home.lat, lng: CFG.home.lng },
      zoom: +h.z || CFG.home.zoom, minZoom: 7, mapTypeId: h.b === 'hybrid' ? 'hybrid' : 'roadmap',
      restriction: { latLngBounds: CFG.bounds, strictBounds: false },
      mapTypeControl: false, streetViewControl: true, fullscreenControl: false, clickableIcons: false, gestureHandling: 'greedy', tilt: 0,
      zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_TOP }, streetViewControlOptions: { position: google.maps.ControlPosition.RIGHT_TOP }
    });
    geocoder = new google.maps.Geocoder();
    defineHtmlMarker();
    $('#t-base').textContent = map.getMapTypeId() === 'hybrid' ? 'Street map' : 'Satellite';

    LAYERS.forEach(def => {
      if (def.type === 'arcgis' || def.type === 'image') H[def.id] = makeImageLayer(def);
      else if (def.type === 'features') H[def.id] = makeFeatureLayer(def);
      if (def.elev) H[def.id].identify = (lat, lng) => [{ local: () => elevationAt(lat, lng) }];
      else if (def.type === 'grid') H[def.id] = makeGridLayer(def);
    });
    buildLayerPanel();
    renderListings(); renderNews(); loadNews();

    fetch('data/planned_facilities.json').then(r => r.json()).then(d => { planned.items = d; if (!d.length) rowEls.planned.hidden = true; else if (on.has('planned')) H.planned.show(); })
      .catch(() => { rowEls.planned.hidden = true; });
    fetch('data/nc_outline.geojson').then(r => r.json()).then(gj => {
      const o = new google.maps.Data({ map: map });
      o.addGeoJson(gj);
      o.setStyle({ fillOpacity: 0, strokeColor: '#0B1A33', strokeWeight: 1.5, strokeOpacity: 0.7, clickable: false });
    }).catch(() => {});

    const start = Array.from(new Set((h.l != null ? h.l.split(',').filter(Boolean) : CFG.defaultLayers).map(id => /^zoning-/.test(id) ? 'zoning' : id === 'jc-contours' ? 'contours' : id === 'jc-hydro' ? 'hydro' : id === 'jc-sewer' ? 'sewer' : id)));
    const zAbout = rowEls.zoning && rowEls.zoning.querySelector('.about');
    if (zAbout) zAbout.textContent = ' Zoning from ' + ZSRC.length + ' city and county map services. It appears once you zoom in to a covered area, and each source uses its own colors, so click a spot for the district. Covered: ' + ZSRC.map(s => s.n).join('; ') + '.';
    google.maps.event.addListenerOnce(map, 'idle', () => {
      start.forEach(id => setLayer(id, true, true));
      refreshHints(); updateLegend();
      let t = null;
      map.addListener('idle', () => {
        clearTimeout(t);
        t = setTimeout(() => { on.forEach(id => H[id].refresh()); refreshHints(); writeHash(); }, 250);
      });
    });
    map.addListener('click', e => handleClick(e.latLng));

    document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
    $('#search').addEventListener('submit', e => { e.preventDefault(); runSearch($('#search-mode').value, $('#search-q').value); });
    $('#search-mode').addEventListener('change', e => {
      $('#search-q').placeholder = { address: 'Street address or place in NC', owner: 'Owner name, e.g. SMITH JOHN or ACME LLC', pin: 'County parcel ID (PIN)' }[e.target.value];
      searchResults('');
    });
    $('#panel-toggle').addEventListener('click', togglePanel);
    $('#t-base').addEventListener('click', () => {
      const sat = map.getMapTypeId() !== 'hybrid';
      map.setMapTypeId(sat ? 'hybrid' : 'roadmap');
      $('#t-base').textContent = sat ? 'Street map' : 'Satellite';
      writeHash();
    });
    $('#t-measure').addEventListener('click', () => state.measure ? measureStop() : measureStart());
    $('#m-undo').addEventListener('click', () => { const m = state.measure; if (m && m.pts.length) { m.pts.pop(); m.dots.pop().setMap(null); measureRead(); } });
    $('#m-clear').addEventListener('click', () => { measureStop(); measureStart(); });
    $('#m-done').addEventListener('click', measureStop);
    $('#t-share').addEventListener('click', () => {
      writeHash();
      const done = ok => { $('#t-share').textContent = ok ? 'Link copied' : 'Copy the address bar'; setTimeout(() => { $('#t-share').textContent = 'Copy link'; }, 2200); };
      if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(() => done(true), () => done(false)); else done(false);
    });
    $('#t-print').addEventListener('click', () => window.print());
    $('#t-home').addEventListener('click', () => { map.moveCamera({ center: { lat: CFG.home.lat, lng: CFG.home.lng }, zoom: CFG.home.zoom }); });
    if (window.matchMedia('(max-width:760px)').matches) { /* phone: start with the map tall */ }
    window.SIGHT = { map: map, on: on, setLayer: setLayer, handleClick: handleClick, H: H };
  };

  window.gm_authFailure = function () {
    $('#map').innerHTML = '<p style="padding:40px;color:#0B1A33;font-size:16px">The map could not start because the Google Maps key was rejected for this web address. Add this site to the key\'s allowed referrers in Google Cloud.</p>';
  };
  const s = document.createElement('script');
  s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(CFG.mapsKey) + '&v=weekly&loading=async&callback=sightInit';
  s.async = true;
  s.onerror = () => { $('#map').innerHTML = '<p style="padding:40px;color:#0B1A33">Google Maps did not load. Check the connection and reload.</p>'; };
  document.head.appendChild(s);
})();
