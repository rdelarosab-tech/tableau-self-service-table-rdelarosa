/* app.js — lógica principal de la extensión */

(function () {
  'use strict';

  /* ── Estado de la aplicación ────────────────────────────── */

  const state = {
    worksheet:  null,
    dimensions: [],   // campos disponibles (dimensiones)
    metrics:    [],   // campos disponibles (métricas)
    zones: {
      rows:    [],    // chips en zona Filas
      columns: [],    // chips en zona Columnas (máx. 1)
      metrics: [],    // chips en zona Métricas
    },
    dragging: null,   // { name, type, fromZone } del chip en vuelo
  };

  /* ── Inicialización ─────────────────────────────────────── */

  tableau.extensions.initializeAsync({ configure: openConfigPanel }).then(() => {
    loadConfiguration();
  }).catch(err => showState('error', 'Error al inicializar la extensión: ' + err.message));

  document.getElementById('btn-config').addEventListener('click', openConfigPanel);
  document.getElementById('btn-config-close').addEventListener('click', closeConfigPanel);
  document.getElementById('btn-config-cancel').addEventListener('click', closeConfigPanel);
  document.getElementById('btn-config-save').addEventListener('click', saveConfig);

  function openConfigPanel() {
    const panel = document.getElementById('config-panel');
    panel.style.display = 'flex';
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
      const datasources = await ws.getDataSourcesAsync();
      if (!datasources.length) throw new Error('No hay datasources en este worksheet.');

      const fieldArrays = await Promise.all(datasources.map(ds => ds.getFieldsAsync()));
      const fields = fieldArrays.flat().filter(f => !f.isHidden);

      const savedDims    = JSON.parse(tableau.extensions.settings.get('dimensions') || '[]');
      const savedMetrics = JSON.parse(tableau.extensions.settings.get('metrics')    || '[]');

      renderConfigFieldLists(fields, savedDims, savedMetrics);

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
    const NUMERIC = new Set(['float', 'integer', 'real']);
    const dimList    = document.getElementById('dimensions-list');
    const metricList = document.getElementById('metrics-list');
    dimList.innerHTML = '';
    metricList.innerHTML = '';

    fields.forEach(field => {
      const isNumeric  = NUMERIC.has(field.dataType);
      const inDims     = savedDims.includes(field.name);
      const inMetrics  = savedMetrics.includes(field.name);
      const safeId     = field.name.replace(/[^a-zA-Z0-9]/g, '_');

      dimList.appendChild(buildConfigFieldItem(field, 'dim_' + safeId,
        inDims || (!inDims && !inMetrics && !isNumeric)));
      metricList.appendChild(buildConfigFieldItem(field, 'met_' + safeId,
        inMetrics || (!inDims && !inMetrics && isNumeric)));
    });
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

  async function saveConfig() {
    const wsSelect = document.getElementById('worksheet-select');
    const dims = Array.from(
      document.querySelectorAll('#dimensions-list input:checked')
    ).map(cb => cb.dataset.fieldName);
    const metrics = Array.from(
      document.querySelectorAll('#metrics-list input:checked')
    ).map(cb => cb.dataset.fieldName);

    tableau.extensions.settings.set('worksheetName', wsSelect.value);
    tableau.extensions.settings.set('dimensions',    JSON.stringify(dims));
    tableau.extensions.settings.set('metrics',       JSON.stringify(metrics));
    await tableau.extensions.settings.saveAsync();

    closeConfigPanel();
    loadConfiguration();
  }

  /* ── Cargar configuración guardada ─────────────────────── */

  function loadConfiguration() {
    const dims    = JSON.parse(tableau.extensions.settings.get('dimensions')    || '[]');
    const metrics = JSON.parse(tableau.extensions.settings.get('metrics')       || '[]');
    const wsName  = tableau.extensions.settings.get('worksheetName');

    if (!dims.length && !metrics.length) {
      showState('unconfigured');
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
    chip.draggable = true;
    chip.dataset.name     = name;
    chip.dataset.type     = type;
    chip.dataset.fromZone = fromZone;
    chip.textContent      = name;

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

    chip.addEventListener('dragstart', onDragStart);
    chip.addEventListener('dragend',   onDragEnd);
    return chip;
  }

  /* ── Drag & Drop ────────────────────────────────────────── */

  function onDragStart(e) {
    state.dragging = {
      name:     e.currentTarget.dataset.name,
      type:     e.currentTarget.dataset.type,
      fromZone: e.currentTarget.dataset.fromZone,
    };
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    state.dragging = null;
  }

  // Registrar listeners en las zonas drop
  ['rows', 'columns', 'metrics'].forEach(zone => {
    const el = document.getElementById('zone-' + zone);
    el.addEventListener('dragover',  e => { e.preventDefault(); el.classList.add('drag-over'); });
    el.addEventListener('dragleave', ()  => el.classList.remove('drag-over'));
    el.addEventListener('drop',      e  => onDrop(e, zone));
  });

  function onDrop(e, targetZone) {
    e.preventDefault();
    document.getElementById('zone-' + targetZone).classList.remove('drag-over');

    const { name, type, fromZone } = state.dragging || {};
    if (!name) return;

    // Validaciones de zona
    if (targetZone === 'metrics'          && type !== 'metric')    return;
    if (targetZone === 'rows'             && type !== 'dimension') return;
    if (targetZone === 'columns'          && type !== 'dimension') return;

    // Columnas solo admite 1 dimensión
    if (targetZone === 'columns' && state.zones.columns.length >= 1) return;

    // Si ya está en esa zona, no hacer nada
    if (fromZone === targetZone) return;

    // Quitar de origen
    if (fromZone !== 'sidebar') {
      state.zones[fromZone] = state.zones[fromZone].filter(i => i.name !== name);
    }

    // Añadir a destino (evitar duplicados)
    if (!state.zones[targetZone].find(i => i.name === name)) {
      state.zones[targetZone].push({ name, type });
    }

    refresh();
  }

  /* ── Botón reset ────────────────────────────────────────── */

  document.getElementById('btn-reset').addEventListener('click', () => {
    state.zones = { rows: [], columns: [], metrics: [] };
    refresh();
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
      const summaryData = await state.worksheet.getSummaryDataAsync({ maxRows: 0, ignoreAliases: false });
      showState('main');

      const columns = summaryData.columns;
      const rows    = summaryData.data;

      // Mapear nombres de columna → índice
      const colIndex = {};
      columns.forEach((c, i) => { colIndex[c.fieldName] = i; });

      // Campos requeridos deben existir en los datos
      const allRequired = [...rowDims, ...(colDim ? [colDim] : []), ...metrics];
      const missing = allRequired.filter(f => colIndex[f] === undefined);
      if (missing.length) {
        showState('error', `Campos no encontrados en los datos: ${missing.join(', ')}. ¿Está el worksheet correcto seleccionado?`);
        return;
      }

      const pivotData = buildPivot(rows, colIndex, rowDims, colDim, metrics);
      renderPivotTable(pivotData, rowDims, colDim, metrics);
      wrapper.style.display = 'block';

    } catch (err) {
      showState('error', 'Error al obtener datos: ' + err.message);
    }
  }

  /* ── Lógica de pivot ────────────────────────────────────── */

  function buildPivot(rows, colIndex, rowDims, colDim, metrics) {
    const groupMap = new Map();  // clave de fila → { dims, colValues: { colVal → { metric → sum } } }
    const colValues = new Set(); // valores únicos de la dimensión de columnas

    rows.forEach(row => {
      const rowKey = rowDims.map(d => String(row[colIndex[d]].formattedValue)).join('|||');

      if (!groupMap.has(rowKey)) {
        const dims = {};
        rowDims.forEach(d => { dims[d] = row[colIndex[d]].formattedValue; });
        groupMap.set(rowKey, { dims, colValues: new Map() });
      }

      const group = groupMap.get(rowKey);
      const colVal = colDim ? String(row[colIndex[colDim]].formattedValue) : '__total__';

      if (colDim) colValues.add(colVal);

      if (!group.colValues.has(colVal)) {
        const acc = {};
        metrics.forEach(m => { acc[m] = 0; });
        group.colValues.set(colVal, acc);
      }

      const acc = group.colValues.get(colVal);
      metrics.forEach(m => {
        const raw = row[colIndex[m]].value;
        acc[m] += typeof raw === 'number' ? raw : parseFloat(raw) || 0;
      });
    });

    return { groupMap, colValues: [...colValues].sort() };
  }

  /* ── Render HTML de la tabla ────────────────────────────── */

  function renderPivotTable({ groupMap, colValues }, rowDims, colDim, metrics) {
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
      const thTotal = document.createElement('th');
      thTotal.textContent = 'Total';
      thTotal.colSpan     = metrics.length;
      thTotal.className   = 'header-colgroup';
      row1.appendChild(thTotal);

      // Fila 2: nombres de dimensiones de fila + nombres de métricas repetidos
      const row2 = thead.insertRow();
      rowDims.forEach(d => {
        const th = document.createElement('th');
        th.textContent = d;
        row2.appendChild(th);
      });
      [...colValues, 'Total'].forEach(() => {
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
        metrics.forEach(m => {
          const td = tr.insertCell();
          td.className   = 'cell-metric cell-total';
          td.textContent = formatNumber(rowTotal[m]);
        });

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
    }

    metrics.forEach(m => {
      const td = footerRow.insertCell();
      td.className   = 'cell-metric cell-total';
      td.textContent = formatNumber(grandTotal[m] || 0);
    });
  }

  /* ── Exportar a Excel ───────────────────────────────────── */

  document.getElementById('btn-export').addEventListener('click', () => {
    const table = document.getElementById('pivot-table');
    const wb    = XLSX.utils.table_to_book(table, { sheet: 'Tabla' });

    // Nombre de archivo con fecha
    const now  = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const rows = state.zones.rows.map(i => i.name).join('_') || 'tabla';
    XLSX.writeFile(wb, `${rows}_${date}.xlsx`);
  });

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
    document.getElementById('state-' + name).style.display = name === 'main' ? 'block' : 'flex';
    if (name === 'error' && errorMsg) {
      document.getElementById('error-msg').textContent = errorMsg;
    }
  }

})();
