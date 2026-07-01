/* app.js — lógica principal de la extensión */

(function () {
  'use strict';

  /* ── Estado de la aplicación ────────────────────────────── */

  const STYLE_DEFAULTS = {
    title:        'Tabla de Autoservicio',
    headerBg:     '#f0f2f8',
    headerColor:  '#1e2330',
    headerSize:   11,
    headerBold:   true,
    cellBg:       '#ffffff',
    cellColor:    '#1e2330',
    cellSize:     12,
    metricsBold:  false,
    zebra:        false,
    zebraColor:   '#f5f6fa',
    totalBg:      '#e8eaf4',
    totalColor:   '#1e2330',
  };

  const state = {
    worksheet:  null,
    dimensions: [],
    metrics:    [],
    zones: { rows: [], columns: [], metrics: [] },
    selected:   null,
    lastPivot:  null,
    showRowTotals: true,
    showColTotals: true,
    style: { ...STYLE_DEFAULTS },
  };

  /* ── Inicialización ─────────────────────────────────────── */

  tableau.extensions.initializeAsync({ configure: openConfigPanel }).then(() => {
    loadConfiguration();
  }).catch(err => showState('error', 'Error al inicializar la extensión: ' + err.message));

  document.getElementById('btn-config').addEventListener('click', openConfigPanel);
  document.getElementById('btn-config-close').addEventListener('click', closeConfigPanel);
  document.getElementById('btn-config-cancel').addEventListener('click', closeConfigPanel);
  document.getElementById('btn-config-save').addEventListener('click', saveConfig);

  // Tabs
  document.querySelectorAll('.config-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.config-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-fields').style.display     = tab.dataset.tab === 'fields'     ? 'flex' : 'none';
      document.getElementById('tab-appearance').style.display = tab.dataset.tab === 'appearance' ? 'flex' : 'none';
    });
  });

  // Apariencia: preview en tiempo real al cambiar cualquier control
  const APPEAR_IDS = ['ap-title',
                      'ap-header-bg','ap-header-color','ap-header-size','ap-header-bold',
                      'ap-cell-bg','ap-cell-color','ap-cell-size','ap-metrics-bold',
                      'ap-zebra','ap-zebra-color','ap-total-bg','ap-total-color'];
  APPEAR_IDS.forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      syncStyleFromInputs();
      applyTableStyles();
    });
  });

  function openConfigPanel() {
    const panel = document.getElementById('config-panel');
    panel.style.display = 'flex';
    syncInputsFromStyle();
    loadConfigFields();
  }

  function closeConfigPanel() {
    document.getElementById('config-panel').style.display = 'none';
  }

  /* ── Cargar campos en el panel de config ────────────────── */

  async function loadConfigFields() {
    const loadingMsg   = document.getElementById('config-loading-msg');
    const errorMsg     = document.getElementById('config-error-msg');
    const fieldsPanel  = document.getElementById('config-fields-panel');
    const saveBtn      = document.getElementById('btn-config-save');
    const wsSelect     = document.getElementById('worksheet-select');

    loadingMsg.style.display  = 'block';
    errorMsg.style.display    = 'none';
    fieldsPanel.style.display = 'none';
    saveBtn.disabled          = true;

    try {
      const dashboard  = tableau.extensions.dashboardContent.dashboard;
      const worksheets = dashboard.worksheets;

      if (!worksheets.length) throw new Error('No hay worksheets en este dashboard.');

      // Poblar selector de worksheets (solo la primera vez)
      if (!wsSelect.options.length) {
        worksheets.forEach(ws => {
          const opt = document.createElement('option');
          opt.value = ws.name;
          opt.textContent = ws.name;
          wsSelect.appendChild(opt);
        });
        const savedWs = tableau.extensions.settings.get('worksheetName');
        if (savedWs) wsSelect.value = savedWs;
        wsSelect.addEventListener('change', loadConfigFields);
      }

      const ws = worksheets.find(w => w.name === wsSelect.value) || worksheets[0];

      // Obtener datasource directamente — no necesitamos que el worksheet tenga todos los campos
      const datasources = await ws.getDataSourcesAsync();
      if (!datasources.length) throw new Error('No hay datasources conectados a este worksheet.');
      const ds = datasources[0];

      // datasource.fields es una propiedad síncrona con todos los campos del datasource
      const fields = ds.fields
        .filter(f => !f.isHidden)
        .map(f => ({ name: f.name, dataType: f.dataType, role: f.role }));

      const savedDims    = JSON.parse(tableau.extensions.settings.get('dimensions') || '[]');
      const savedMetrics = JSON.parse(tableau.extensions.settings.get('metrics')    || '[]');

      renderConfigFieldLists(fields, savedDims, savedMetrics);

      // Limpiar buscador al recargar campos
      const searchInput = document.getElementById('field-search');
      if (searchInput) searchInput.value = '';

      loadingMsg.style.display  = 'none';
      fieldsPanel.style.display = 'block';
      saveBtn.disabled          = false;

    } catch (err) {
      loadingMsg.style.display = 'none';
      errorMsg.textContent     = err.message;
      errorMsg.style.display   = 'block';
    }
  }

  function renderConfigFieldLists(fields, savedDims, savedMetrics) {
    const dimList    = document.getElementById('dimensions-list');
    const metricList = document.getElementById('metrics-list');
    dimList.innerHTML = '';
    metricList.innerHTML = '';

    fields.forEach(field => {
      const inDims    = savedDims.includes(field.name);
      const inMetrics = savedMetrics.includes(field.name);
      const safeId    = field.name.replace(/[^a-zA-Z0-9]/g, '_');

      // Solo marcar si estaba guardado previamente — nunca auto-check
      dimList.appendChild(buildConfigFieldItem(field, 'dim_' + safeId, inDims));
      metricList.appendChild(buildConfigFieldItem(field, 'met_' + safeId, inMetrics));
    });

    // Buscador: filtrar items en ambas listas
    const searchInput = document.getElementById('field-search');
    if (searchInput) {
      searchInput.oninput = () => {
        const q = searchInput.value.toLowerCase();
        document.querySelectorAll('#config-fields-panel .field-item').forEach(item => {
          const label = item.querySelector('label').textContent.toLowerCase();
          item.style.display = label.includes(q) ? '' : 'none';
        });
      };
    }
  }

  function buildConfigFieldItem(field, inputId, checked) {
    const div = document.createElement('div');
    div.className = 'field-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.id = inputId;
    cb.dataset.fieldName = field.name; cb.checked = checked;
    const label = document.createElement('label');
    label.htmlFor = inputId; label.textContent = field.name;
    const tag = document.createElement('span');
    tag.className = 'field-type'; tag.textContent = field.dataType;
    div.append(cb, label, tag);
    return div;
  }

  function syncStyleFromInputs() {
    state.style = {
      title:       document.getElementById('ap-title').value || 'Tabla de Autoservicio',
      headerBg:    document.getElementById('ap-header-bg').value,
      headerColor: document.getElementById('ap-header-color').value,
      headerSize:  parseInt(document.getElementById('ap-header-size').value) || 11,
      headerBold:  document.getElementById('ap-header-bold').checked,
      cellBg:      document.getElementById('ap-cell-bg').value,
      cellColor:   document.getElementById('ap-cell-color').value,
      cellSize:    parseInt(document.getElementById('ap-cell-size').value) || 12,
      metricsBold: document.getElementById('ap-metrics-bold').checked,
      zebra:       document.getElementById('ap-zebra').checked,
      zebraColor:  document.getElementById('ap-zebra-color').value,
      totalBg:     document.getElementById('ap-total-bg').value,
      totalColor:  document.getElementById('ap-total-color').value,
    };
  }

  function syncInputsFromStyle() {
    const s = state.style;
    document.getElementById('ap-title').value            = s.title || 'Tabla de Autoservicio';
    document.getElementById('ap-header-bg').value        = s.headerBg;
    document.getElementById('ap-header-color').value     = s.headerColor;
    document.getElementById('ap-header-size').value      = s.headerSize;
    document.getElementById('ap-header-bold').checked    = s.headerBold;
    document.getElementById('ap-cell-bg').value          = s.cellBg;
    document.getElementById('ap-cell-color').value       = s.cellColor;
    document.getElementById('ap-cell-size').value        = s.cellSize;
    document.getElementById('ap-metrics-bold').checked   = s.metricsBold;
    document.getElementById('ap-zebra').checked          = s.zebra;
    document.getElementById('ap-zebra-color').value      = s.zebraColor;
    document.getElementById('ap-total-bg').value         = s.totalBg;
    document.getElementById('ap-total-color').value      = s.totalColor;
  }

  function applyTableStyles() {
    let el = document.getElementById('dynamic-table-styles');
    if (!el) {
      el = document.createElement('style');
      el.id = 'dynamic-table-styles';
      document.head.appendChild(el);
    }
    const s = state.style;
    document.querySelector('.app-title').textContent = s.title || 'Tabla de Autoservicio';
    el.textContent = `
      .pivot-table thead th {
        background: ${s.headerBg} !important;
        color: ${s.headerColor} !important;
        font-size: ${s.headerSize}px !important;
        font-weight: ${s.headerBold ? '700' : '400'} !important;
      }
      .pivot-table tbody td {
        background: ${s.cellBg};
        color: ${s.cellColor} !important;
        font-size: ${s.cellSize}px !important;
      }
      ${s.metricsBold ? '.pivot-table tbody .cell-metric { font-weight: 700 !important; }' : ''}
      ${s.zebra ? `.pivot-table tbody tr:nth-child(even) td { background: ${s.zebraColor} !important; }` : ''}
      .pivot-table .cell-total, .pivot-table tfoot td {
        background: ${s.totalBg} !important;
        color: ${s.totalColor} !important;
      }
    `;
  }

  async function saveConfig() {
    const wsSelect = document.getElementById('worksheet-select');
    const dims = Array.from(
      document.querySelectorAll('#dimensions-list input:checked')
    ).map(cb => cb.dataset.fieldName);
    const metrics = Array.from(
      document.querySelectorAll('#metrics-list input:checked')
    ).map(cb => cb.dataset.fieldName);

    syncStyleFromInputs();
    tableau.extensions.settings.set('worksheetName', wsSelect.value);
    tableau.extensions.settings.set('dimensions',    JSON.stringify(dims));
    tableau.extensions.settings.set('metrics',       JSON.stringify(metrics));
    tableau.extensions.settings.set('tableStyle',    JSON.stringify(state.style));
    await tableau.extensions.settings.saveAsync();

    closeConfigPanel();
    loadConfiguration();
  }

  /* ── Cargar configuración guardada ─────────────────────── */

  function loadConfiguration() {
    const dims    = JSON.parse(tableau.extensions.settings.get('dimensions')  || '[]');
    const metrics = JSON.parse(tableau.extensions.settings.get('metrics')    || '[]');
    const wsName  = tableau.extensions.settings.get('worksheetName');
    const saved   = JSON.parse(tableau.extensions.settings.get('tableStyle') || 'null');
    if (saved) state.style = { ...STYLE_DEFAULTS, ...saved };
    applyTableStyles();

    if (!dims.length && !metrics.length) {
      showState('unconfigured');
      openConfigPanel();
      return;
    }

    const dashboard  = tableau.extensions.dashboardContent.dashboard;
    const worksheet  = wsName
      ? dashboard.worksheets.find(ws => ws.name === wsName)
      : dashboard.worksheets[0];

    if (!worksheet) {
      showState('error', 'Worksheet no encontrada. Reconfigura la extensión.');
      return;
    }

    state.worksheet  = worksheet;
    state.dimensions = dims;
    state.metrics    = metrics;

    // Resetear zonas cuando reconfiguramos
    state.zones = { rows: [], columns: [], metrics: [] };

    showState('main');
    renderSidebar();
    renderDropZones();
    renderTable();
  }

  /* ── Render del sidebar (chips disponibles) ─────────────── */

  function renderSidebar() {
    const dimContainer    = document.getElementById('available-dimensions');
    const metricContainer = document.getElementById('available-metrics');
    dimContainer.innerHTML    = '';
    metricContainer.innerHTML = '';

    // Solo mostrar los campos que NO están ya en alguna zona
    const usedNames = getAllUsedNames();

    state.dimensions.forEach(name => {
      if (!usedNames.has(name)) {
        dimContainer.appendChild(buildChip(name, 'dimension', 'sidebar'));
      }
    });

    state.metrics.forEach(name => {
      if (!usedNames.has(name)) {
        metricContainer.appendChild(buildChip(name, 'metric', 'sidebar'));
      }
    });
  }

  /* ── Render de zonas (chips en cada zona) ───────────────── */

  function renderDropZones() {
    ['rows', 'columns', 'metrics'].forEach(zone => {
      const zoneEl = document.getElementById('zone-' + zone);
      // Mantener el hint, eliminar chips anteriores
      const hint = zoneEl.querySelector('.drop-hint');
      zoneEl.innerHTML = '';
      if (hint) zoneEl.appendChild(hint);

      state.zones[zone].forEach(item => {
        zoneEl.appendChild(buildChip(item.name, item.type, zone));
      });

      // Mostrar/ocultar hint
      if (hint) hint.style.display = state.zones[zone].length ? 'none' : 'inline';
    });
  }

  /* ── Construcción de chips ──────────────────────────────── */

  function buildChip(name, type, fromZone) {
    const chip = document.createElement('div');
    chip.className = `chip chip-${type}`;
    chip.dataset.name     = name;
    chip.dataset.type     = type;
    chip.dataset.fromZone = fromZone;
    chip.textContent      = name;
    chip.title            = fromZone === 'sidebar' ? 'Clic para seleccionar, luego clic en la zona destino' : '';

    chip.addEventListener('click', e => onChipClick(e, name, type, fromZone));

    if (fromZone !== 'sidebar') {
      const removeBtn = document.createElement('button');
      removeBtn.className   = 'chip-remove';
      removeBtn.textContent = '×';
      removeBtn.title       = 'Quitar';
      removeBtn.addEventListener('click', e => {
        e.stopPropagation();
        removeFromZone(name, fromZone);
      });
      chip.appendChild(removeBtn);
    }

    return chip;
  }

  /* ── Selección por clic ─────────────────────────────────── */

  function onChipClick(e, name, type, fromZone) {
    e.stopPropagation();

    // Si ya está seleccionado, deseleccionar
    if (state.selected && state.selected.name === name && state.selected.fromZone === fromZone) {
      clearSelection();
      return;
    }
    state.selected = { name, type, fromZone };
    updateSelectionUI();
  }

  function clearSelection() {
    state.selected = null;
    updateSelectionUI();
  }

  function updateSelectionUI() {
    const sel = state.selected;

    // Resaltar chip seleccionado
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
    if (sel) {
      document.querySelectorAll('.chip').forEach(c => {
        if (c.dataset.name === sel.name && c.dataset.fromZone === sel.fromZone) {
          c.classList.add('selected');
        }
      });
    }

    // Resaltar zonas compatibles
    ['rows', 'columns', 'metrics'].forEach(zone => {
      const el = document.getElementById('zone-' + zone);
      el.classList.remove('zone-ready', 'zone-incompatible');
      if (!sel) return;

      const compatible =
        (zone === 'metrics' && sel.type === 'metric') ||
        (zone === 'rows'    && sel.type === 'dimension') ||
        (zone === 'columns' && sel.type === 'dimension');

      el.classList.add(compatible ? 'zone-ready' : 'zone-incompatible');
    });
  }

  // Clic en zona para colocar el chip seleccionado
  ['rows', 'columns', 'metrics'].forEach(zone => {
    const el = document.getElementById('zone-' + zone);
    el.addEventListener('click', () => {
      const sel = state.selected;
      if (!sel) return;

      const { name, type, fromZone } = sel;

      // Validar compatibilidad
      if (zone === 'metrics' && type !== 'metric')    return;
      if (zone === 'rows'    && type !== 'dimension') return;
      if (zone === 'columns' && type !== 'dimension') return;

      // Columnas solo admite 1 dimensión
      if (zone === 'columns' && state.zones.columns.length >= 1) return;

      // Quitar de zona origen si venía de una zona
      if (fromZone !== 'sidebar') {
        state.zones[fromZone] = state.zones[fromZone].filter(i => i.name !== name);
      }

      // Añadir a destino (evitar duplicados)
      if (!state.zones[zone].find(i => i.name === name)) {
        state.zones[zone].push({ name, type });
      }

      clearSelection();
      refresh();
    });
  });

  // Clic fuera de chips/zonas → deseleccionar
  document.addEventListener('click', clearSelection);

  /* ── Reordenar chips en zonas por arrastre (pointer events) ─── */
  (function initZoneReorder() {
    let drag = null;
    let lastWasDrag = false;

    document.addEventListener('pointerdown', e => {
      const chip = e.target.closest('.chip');
      if (!chip || chip.dataset.fromZone === 'sidebar' || !chip.dataset.fromZone) return;
      if (e.target.closest('button')) return;
      const rect = chip.getBoundingClientRect();
      drag = {
        chip, zone: chip.dataset.fromZone, name: chip.dataset.name,
        startX: e.clientX, startY: e.clientY,
        ox: e.clientX - rect.left, oy: e.clientY - rect.top,
        ghost: null, moved: false,
      };
    });

    document.addEventListener('pointermove', e => {
      if (!drag) return;
      if (!drag.moved) {
        if (Math.abs(e.clientX - drag.startX) < 5 && Math.abs(e.clientY - drag.startY) < 5) return;
        drag.moved = true;
        const rect = drag.chip.getBoundingClientRect();
        const g = drag.chip.cloneNode(true);
        g.id = 'drag-ghost';
        g.style.cssText = `position:fixed;pointer-events:none;opacity:.8;z-index:9999;top:${rect.top}px;left:${rect.left}px;margin:0;transform:scale(1.06);box-shadow:0 4px 12px rgba(0,0,0,.2);transition:none;`;
        document.body.appendChild(g);
        drag.ghost = g;
        drag.chip.style.opacity = '.25';
      }
      drag.ghost.style.top  = (e.clientY - drag.oy) + 'px';
      drag.ghost.style.left = (e.clientX - drag.ox) + 'px';
      updateDropIndicator(e.clientX, drag.zone);
    });

    document.addEventListener('pointerup', e => {
      if (!drag) return;
      if (drag.moved) {
        lastWasDrag = true;
        const zone = drag.zone;
        const arr  = state.zones[zone];
        const zoneEl  = document.getElementById('zone-' + zone);
        const chipEls = Array.from(zoneEl.querySelectorAll('.chip')).filter(c => c !== drag.chip);

        // Encontrar el chip antes del cual insertar (por nombre, evita problemas de índice)
        let insertBeforeName = null;
        for (const c of chipEls) {
          const cr = c.getBoundingClientRect();
          if (e.clientX < cr.left + cr.width / 2) { insertBeforeName = c.dataset.name; break; }
        }

        const fromIdx = arr.findIndex(i => i.name === drag.name);
        const [item]  = arr.splice(fromIdx, 1);
        if (insertBeforeName) {
          const toIdx = arr.findIndex(i => i.name === insertBeforeName);
          arr.splice(toIdx, 0, item);
        } else {
          arr.push(item);
        }
        cleanup(); refresh();
      } else {
        cleanup();
      }
      drag = null;
    });

    document.addEventListener('pointercancel', () => { if (drag) { cleanup(); drag = null; } });

    function cleanup() {
      if (drag?.ghost) drag.ghost.remove();
      if (drag?.chip)  drag.chip.style.opacity = '';
      removeDropIndicator();
    }

    function updateDropIndicator(x, zone) {
      removeDropIndicator();
      const zoneEl  = document.getElementById('zone-' + zone);
      const chipEls = Array.from(zoneEl.querySelectorAll('.chip')).filter(c => c !== drag?.chip);
      const el = document.createElement('div');
      el.id = 'drop-indicator';
      el.style.cssText = 'width:2px;min-height:24px;background:var(--color-primary);border-radius:2px;align-self:center;pointer-events:none;flex-shrink:0;';
      let ref = null;
      for (const c of chipEls) {
        const cr = c.getBoundingClientRect();
        if (x < cr.left + cr.width / 2) { ref = c; break; }
      }
      if (ref) zoneEl.insertBefore(el, ref); else zoneEl.appendChild(el);
    }

    function removeDropIndicator() {
      const el = document.getElementById('drop-indicator');
      if (el) el.remove();
    }

    // Suprimir el click que dispara el navegador justo después de soltar el drag
    document.addEventListener('click', e => {
      if (lastWasDrag) { lastWasDrag = false; e.stopPropagation(); }
    }, { capture: true });
  })();

  /* ── Botón reset ────────────────────────────────────────── */

  document.getElementById('btn-reset').addEventListener('click', () => {
    state.zones = { rows: [], columns: [], metrics: [] };
    refresh();
  });

  document.getElementById('chk-row-totals').addEventListener('change', e => {
    state.showRowTotals = e.target.checked;
    renderTable();
  });
  document.getElementById('chk-col-totals').addEventListener('change', e => {
    state.showColTotals = e.target.checked;
    renderTable();
  });

  /* ── Quitar chip de zona ────────────────────────────────── */

  function removeFromZone(name, zone) {
    state.zones[zone] = state.zones[zone].filter(i => i.name !== name);
    refresh();
  }

  /* ── Refresh completo ───────────────────────────────────── */

  function refresh() {
    renderSidebar();
    renderDropZones();
    renderTable();
  }

  /* ── Obtener datos y renderizar tabla ───────────────────── */

  async function renderTable() {
    const rowDims  = state.zones.rows.map(i => i.name);
    const colDim   = state.zones.columns[0]?.name || null;
    const metrics  = state.zones.metrics.map(i => i.name);

    const placeholder = document.getElementById('table-placeholder');
    const wrapper     = document.getElementById('table-wrapper');

    if (!rowDims.length || !metrics.length) {
      placeholder.style.display = 'flex';
      wrapper.style.display     = 'none';
      return;
    }

    placeholder.style.display = 'none';
    showState('loading');

    try {
      const allRequired = [...rowDims, ...(colDim ? [colDim] : []), ...metrics];
      let columns, rows;

      // Intento 1: underlying table data — pide solo las columnas seleccionadas al datasource
      let usedUnderlying = false;
      try {
        const datasources = await state.worksheet.getDataSourcesAsync();
        if (datasources.length) {
          const ds       = datasources[0];
          const fieldMap = new Map(ds.fields.map(f => [f.name, f.id]));
          const colIds   = allRequired.map(n => fieldMap.get(n)).filter(Boolean);

          if (colIds.length === allRequired.length) {
            const tables = await state.worksheet.getUnderlyingTablesAsync();
            if (tables.length) {
              const dt = await state.worksheet.getUnderlyingTableDataAsync(tables[0].id, {
                maxRows:              0,
                ignoreAliases:        false,
                ignoreSelection:      true,
                includeAllColumns:    false,
                columnsToIncludeById: colIds,
              });
              columns = dt.columns;
              rows    = dt.data;
              usedUnderlying = true;
            }
          }
        }
      } catch (_) { /* continuar con fallback */ }

      // Fallback: summary data del worksheet (siempre disponible)
      if (!usedUnderlying) {
        const sd = await state.worksheet.getSummaryDataAsync({ maxRows: 0, ignoreAliases: false, includeAllColumns: true });
        columns  = sd.columns;
        rows     = sd.data;

        const idx = {};
        columns.forEach((c, i) => { idx[c.fieldName] = i; });
        const missing = allRequired.filter(f => idx[f] === undefined);
        if (missing.length) {
          showState('error', `Campos no encontrados: ${missing.join(', ')}. Añádelos al worksheet o reconfigura.`);
          return;
        }
      }

      showState('main');

      const colIndex = buildColIndex(columns);

      const pivotData = buildPivot(rows, colIndex, rowDims, colDim, metrics);
      state.lastPivot = { pivotData, rowDims, colDim, metrics };
      renderPivotTable(pivotData, rowDims, colDim, metrics, state.showRowTotals, state.showColTotals);
      makeColumnsResizable(document.getElementById('pivot-table'));
      wrapper.style.display = 'block';

    } catch (err) {
      showState('error', 'Error al obtener datos: ' + err.message);
    }
  }

  /* ── Índice de columnas (tolerante a prefijos de agregación) ── */

  function buildColIndex(columns) {
    const idx = {};
    const AGG = /^(SUM|AVG|MIN|MAX|CNT|CNTD|COUNT|AGG|ATTR|MEDIAN|STDEV?|VAR)\((.+)\)$/i;
    columns.forEach((c, i) => {
      idx[c.fieldName] = i;
      const m = AGG.exec(c.fieldName);
      if (m) idx[m[2]] = i; // nombre sin prefijo como alias
    });
    return idx;
  }

  /* ── Lógica de pivot ────────────────────────────────────── */

  function buildPivot(rows, colIndex, rowDims, colDim, metrics) {
    const groupMap = new Map();  // clave de fila → { dims, colValues: { colVal → { metric → sum } } }
    const colValues = new Set(); // valores únicos de la dimensión de columnas

    rows.forEach(row => {
      const cell = (name) => row[colIndex[name]];
      const fv   = (name) => { const c = cell(name); return c != null ? c.formattedValue : ''; };
      const nv   = (name) => { const c = cell(name); if (!c) return 0; return typeof c.value === 'number' ? c.value : parseFloat(c.value) || 0; };

      const rowKey = rowDims.map(d => String(fv(d))).join('|||');

      if (!groupMap.has(rowKey)) {
        const dims = {};
        rowDims.forEach(d => { dims[d] = fv(d); });
        groupMap.set(rowKey, { dims, colValues: new Map() });
      }

      const group = groupMap.get(rowKey);
      const colVal = colDim ? String(fv(colDim)) : '__total__';

      if (colDim) colValues.add(colVal);

      if (!group.colValues.has(colVal)) {
        const acc = {};
        metrics.forEach(m => { acc[m] = 0; });
        group.colValues.set(colVal, acc);
      }

      const acc = group.colValues.get(colVal);
      metrics.forEach(m => {
        acc[m] += nv(m);
      });
    });

    return { groupMap, colValues: [...colValues].sort() };
  }

  /* ── Render HTML de la tabla ────────────────────────────── */

  function renderPivotTable({ groupMap, colValues }, rowDims, colDim, metrics, showRowTotals, showColTotals) {
    const table = document.getElementById('pivot-table');
    table.innerHTML = '';

    const thead = table.createTHead();
    const tbody = table.createTBody();
    const tfoot = table.createTFoot();

    // ── Headers ──
    if (colDim && colValues.length) {
      // Fila 1: dim labels vacíos + grupos de colVal
      const row1 = thead.insertRow();
      rowDims.forEach(() => row1.insertCell()); // celdas vacías para las dimensiones de fila

      colValues.forEach(cv => {
        const th = document.createElement('th');
        th.textContent = cv;
        th.colSpan     = metrics.length;
        th.className   = 'header-colgroup';
        row1.appendChild(th);
      });

      // Total column group
      if (showRowTotals) {
        const thTotal = document.createElement('th');
        thTotal.textContent = 'Total';
        thTotal.colSpan     = metrics.length;
        thTotal.className   = 'header-colgroup';
        row1.appendChild(thTotal);
      }

      // Fila 2: nombres de dimensiones de fila + nombres de métricas repetidos
      const row2 = thead.insertRow();
      rowDims.forEach(d => {
        const th = document.createElement('th');
        th.textContent = d;
        row2.appendChild(th);
      });
      const colGroups = showRowTotals ? [...colValues, 'Total'] : colValues;
      colGroups.forEach(() => {
        metrics.forEach(m => {
          const th = document.createElement('th');
          th.textContent = m;
          th.className   = 'header-metric';
          row2.appendChild(th);
        });
      });

    } else {
      // Sin dimensión de columnas: fila única de headers
      const row1 = thead.insertRow();
      rowDims.forEach(d => {
        const th = document.createElement('th');
        th.textContent = d;
        row1.appendChild(th);
      });
      metrics.forEach(m => {
        const th = document.createElement('th');
        th.textContent = m;
        th.className   = 'header-metric';
        row1.appendChild(th);
      });
    }

    // ── Totales globales (para footer) ──
    const grandTotal = {};
    metrics.forEach(m => { grandTotal[m] = 0; });
    const grandColTotals = {}; // colVal → { metric → sum }

    // ── Filas de datos ──
    groupMap.forEach(({ dims, colValues: cvMap }) => {
      const tr = tbody.insertRow();

      rowDims.forEach(d => {
        const td = tr.insertCell();
        td.textContent = dims[d];
      });

      // Acumular totales por fila
      const rowTotal = {};
      metrics.forEach(m => { rowTotal[m] = 0; });

      if (colDim && colValues.length) {
        colValues.forEach(cv => {
          const acc = cvMap.get(cv) || {};
          if (!grandColTotals[cv]) {
            grandColTotals[cv] = {};
            metrics.forEach(m => { grandColTotals[cv][m] = 0; });
          }
          metrics.forEach(m => {
            const val = acc[m] || 0;
            rowTotal[m]           += val;
            grandColTotals[cv][m] += val;
            grandTotal[m]         += val;
            const td = tr.insertCell();
            td.className   = 'cell-metric';
            td.textContent = formatNumber(val);
          });
        });
        // Total de la fila
        if (showRowTotals) {
          metrics.forEach(m => {
            const td = tr.insertCell();
            td.className   = 'cell-metric cell-total';
            td.textContent = formatNumber(rowTotal[m]);
          });
        }

      } else {
        const acc = cvMap.get('__total__') || {};
        metrics.forEach(m => {
          const val = acc[m] || 0;
          grandTotal[m] += val;
          const td = tr.insertCell();
          td.className   = 'cell-metric';
          td.textContent = formatNumber(val);
        });
      }
    });

    // ── Footer con totales ──
    if (!showColTotals) return;
    const footerRow = tfoot.insertRow();
    const tdLabel   = footerRow.insertCell();
    tdLabel.textContent = 'Total';
    tdLabel.colSpan     = rowDims.length;
    tdLabel.className   = 'cell-total';

    if (colDim && colValues.length) {
      colValues.forEach(cv => {
        const ct = grandColTotals[cv] || {};
        metrics.forEach(m => {
          const td = footerRow.insertCell();
          td.className   = 'cell-metric cell-total';
          td.textContent = formatNumber(ct[m] || 0);
        });
      });
      // Gran total esquina: solo si ambos totales están activos
      if (showRowTotals) {
        metrics.forEach(m => {
          const td = footerRow.insertCell();
          td.className   = 'cell-metric cell-total';
          td.textContent = formatNumber(grandTotal[m] || 0);
        });
      }
    } else {
      metrics.forEach(m => {
        const td = footerRow.insertCell();
        td.className   = 'cell-metric cell-total';
        td.textContent = formatNumber(grandTotal[m] || 0);
      });
    }
  }

  /* ── Exportar a Excel (ExcelJS) ─────────────────────────── */

  document.getElementById('btn-export').addEventListener('click', exportToExcel);

  function hexToARGB(hex) {
    return 'FF' + hex.replace('#', '').toUpperCase().padStart(6, '0');
  }

  function applyHeaderStyle(cell, s) {
    cell.font = { bold: s.headerBold, size: s.headerSize, color: { argb: hexToARGB(s.headerColor) } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hexToARGB(s.headerBg) } };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
      right:  { style: 'thin', color: { argb: 'FFCCCCCC' } },
    };
  }

  function applyDataStyle(cell, s, isMetric, isEven) {
    cell.font = { bold: isMetric && s.metricsBold, size: s.cellSize, color: { argb: hexToARGB(s.cellColor) } };
    const bg  = isEven && s.zebra ? s.zebraColor : s.cellBg;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hexToARGB(bg) } };
    cell.border = { right: { style: 'thin', color: { argb: 'FFCCCCCC' } } };
    if (isMetric) cell.alignment = { horizontal: 'right' };
  }

  function applyTotalStyle(cell, s, isMetric) {
    cell.font   = { bold: true, size: s.cellSize, color: { argb: hexToARGB(s.totalColor) } };
    cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: hexToARGB(s.totalBg) } };
    cell.border = {
      top:   { style: 'medium', color: { argb: 'FFAAAAAA' } },
      right: { style: 'thin',   color: { argb: 'FFCCCCCC' } },
    };
    if (isMetric) cell.alignment = { horizontal: 'right' };
  }

  async function exportToExcel() {
    if (!state.lastPivot) return;
    const { pivotData, rowDims, colDim, metrics } = state.lastPivot;
    const { groupMap, colValues } = pivotData;
    const s   = state.style;
    const wb  = new ExcelJS.Workbook();
    const ws  = wb.addWorksheet('Tabla');
    let curRow = 1;
    const nDim = rowDims.length;

    // ── Headers ──
    if (colDim && colValues.length) {
      // Fila 1: celdas vacías + grupos de colVal + Total
      let col = nDim + 1;
      for (let i = 1; i <= nDim; i++) applyHeaderStyle(ws.getRow(curRow).getCell(i), s);
      colValues.forEach(cv => {
        const cell = ws.getRow(curRow).getCell(col);
        cell.value = cv;
        applyHeaderStyle(cell, s);
        cell.alignment = { horizontal: 'center' };
        if (metrics.length > 1) ws.mergeCells(curRow, col, curRow, col + metrics.length - 1);
        col += metrics.length;
      });
      if (state.showRowTotals) {
        const cell = ws.getRow(curRow).getCell(col);
        cell.value = 'Total';
        applyHeaderStyle(cell, s);
        cell.alignment = { horizontal: 'center' };
        if (metrics.length > 1) ws.mergeCells(curRow, col, curRow, col + metrics.length - 1);
      }
      curRow++;

      // Fila 2: nombres dim + métricas repetidas
      const groups = state.showRowTotals ? [...colValues, '__total__'] : colValues;
      let col2 = nDim + 1;
      rowDims.forEach((d, i) => {
        const cell = ws.getRow(curRow).getCell(i + 1);
        cell.value = d; applyHeaderStyle(cell, s);
      });
      groups.forEach(() => metrics.forEach(m => {
        const cell = ws.getRow(curRow).getCell(col2++);
        cell.value = m; applyHeaderStyle(cell, s); cell.alignment = { horizontal: 'right' };
      }));
      curRow++;

    } else {
      rowDims.forEach((d, i) => {
        const cell = ws.getRow(curRow).getCell(i + 1);
        cell.value = d; applyHeaderStyle(cell, s);
      });
      metrics.forEach((m, i) => {
        const cell = ws.getRow(curRow).getCell(nDim + i + 1);
        cell.value = m; applyHeaderStyle(cell, s); cell.alignment = { horizontal: 'right' };
      });
      curRow++;
    }

    // ── Filas de datos ──
    let rowIdx = 0;
    const grandTotal = {}; const grandColTotals = {};
    metrics.forEach(m => { grandTotal[m] = 0; });

    groupMap.forEach(({ dims, colValues: cvMap }) => {
      const isEven = rowIdx % 2 === 1;
      let col = nDim + 1;
      rowDims.forEach((d, i) => {
        const cell = ws.getRow(curRow).getCell(i + 1);
        cell.value = dims[d]; applyDataStyle(cell, s, false, isEven);
      });

      if (colDim && colValues.length) {
        const rowTotal = {}; metrics.forEach(m => { rowTotal[m] = 0; });
        colValues.forEach(cv => {
          if (!grandColTotals[cv]) { grandColTotals[cv] = {}; metrics.forEach(m => { grandColTotals[cv][m] = 0; }); }
          const acc = cvMap.get(cv) || {};
          metrics.forEach(m => {
            const val = acc[m] || 0;
            rowTotal[m] += val; grandColTotals[cv][m] += val; grandTotal[m] += val;
            const cell = ws.getRow(curRow).getCell(col++);
            cell.value = val; applyDataStyle(cell, s, true, isEven);
          });
        });
        if (state.showRowTotals) {
          metrics.forEach(m => {
            const cell = ws.getRow(curRow).getCell(col++);
            cell.value = rowTotal[m]; applyTotalStyle(cell, s, true);
          });
        }
      } else {
        const acc = cvMap.get('__total__') || {};
        metrics.forEach(m => {
          const val = acc[m] || 0; grandTotal[m] += val;
          const cell = ws.getRow(curRow).getCell(col++);
          cell.value = val; applyDataStyle(cell, s, true, isEven);
        });
      }
      curRow++; rowIdx++;
    });

    // ── Footer ──
    if (state.showColTotals) {
      let col = nDim + 1;
      const lc = ws.getRow(curRow).getCell(1);
      lc.value = 'Total'; applyTotalStyle(lc, s, false);
      if (nDim > 1) ws.mergeCells(curRow, 1, curRow, nDim);

      if (colDim && colValues.length) {
        colValues.forEach(cv => {
          metrics.forEach(m => {
            const cell = ws.getRow(curRow).getCell(col++);
            cell.value = (grandColTotals[cv] || {})[m] || 0; applyTotalStyle(cell, s, true);
          });
        });
        if (state.showRowTotals) {
          metrics.forEach(m => {
            const cell = ws.getRow(curRow).getCell(col++);
            cell.value = grandTotal[m] || 0; applyTotalStyle(cell, s, true);
          });
        }
      } else {
        metrics.forEach(m => {
          const cell = ws.getRow(curRow).getCell(col++);
          cell.value = grandTotal[m] || 0; applyTotalStyle(cell, s, true);
        });
      }
    }

    // ── Anchos de columna ──
    const table  = document.getElementById('pivot-table');
    const colEls = table.querySelectorAll('colgroup col');
    const ths    = table.querySelectorAll('thead tr:last-child th');
    const src    = colEls.length ? Array.from(colEls) : Array.from(ths);
    src.forEach((el, i) => {
      ws.getColumn(i + 1).width = Math.max(8, Math.round((parseInt(el.style.width) || el.offsetWidth) / 7));
    });

    // ── Descargar ──
    const buffer = await wb.xlsx.writeBuffer();
    const blob   = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url    = URL.createObjectURL(blob);
    const a      = document.createElement('a');
    const now    = new Date();
    const date   = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    a.download   = `${state.zones.rows.map(i => i.name).join('_') || 'tabla'}_${date}.xlsx`;
    a.href = url;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  /* ── Redimensionar columnas ─────────────────────────────── */

  function makeColumnsResizable(table) {
    const lastRowThs = Array.from(table.querySelectorAll('thead tr:last-child th'));

    // Crear colgroup con una <col> por columna hoja (sin colspan)
    let colgroup = table.querySelector('colgroup');
    if (colgroup) colgroup.remove();
    colgroup = document.createElement('colgroup');
    table.insertBefore(colgroup, table.firstChild);

    const cols = lastRowThs.map(th => {
      const col = document.createElement('col');
      col.style.width = Math.max(60, th.offsetWidth) + 'px';
      colgroup.appendChild(col);
      return col;
    });

    // Añadir handle a cada th de la última fila
    lastRowThs.forEach((th, i) => {
      // Evitar duplicados al re-renderizar
      if (th.querySelector('.col-resizer')) return;
      const handle = document.createElement('div');
      handle.className = 'col-resizer';
      th.appendChild(handle);

      let startX, startW;
      handle.addEventListener('mousedown', e => {
        e.preventDefault();
        startX = e.clientX;
        startW = parseInt(cols[i].style.width) || th.offsetWidth;
        handle.classList.add('resizing');

        const onMove = e => {
          const newW = Math.max(40, startW + (e.clientX - startX));
          cols[i].style.width = newW + 'px';
        };
        const onUp = () => {
          handle.classList.remove('resizing');
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });
  }

  /* ── Utilidades ─────────────────────────────────────────── */

  function getAllUsedNames() {
    const used = new Set();
    Object.values(state.zones).forEach(arr => arr.forEach(i => used.add(i.name)));
    return used;
  }

  function formatNumber(val) {
    if (val === null || val === undefined || isNaN(val)) return '—';
    if (Number.isInteger(val)) return val.toLocaleString('es-ES');
    return val.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function showState(name, errorMsg) {
    ['unconfigured', 'loading', 'error', 'main'].forEach(s => {
      document.getElementById('state-' + s).style.display = 'none';
    });
    // 'main' ocupa todo el espacio con flex column; las demás son pantallas centradas
    document.getElementById('state-' + name).style.display = 'flex';
    if (name === 'error' && errorMsg) {
      document.getElementById('error-msg').textContent = errorMsg;
    }
  }

})();
