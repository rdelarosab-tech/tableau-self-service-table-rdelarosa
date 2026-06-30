/* config.js — lógica del popup de configuración */

(function () {
  'use strict';

  const NUMERIC_DATA_TYPES = new Set(['float', 'integer', 'real']);

  let allFields = [];
  let currentWorksheet = null;

  tableau.extensions.initializeDialogAsync().then(() => {
    populateWorksheetSelector();
  }).catch(err => showError('Error al inicializar: ' + err.message));

  /* ── Selector de worksheet ──────────────────────────────── */

  function populateWorksheetSelector() {
    const dashboard = tableau.extensions.dashboardContent.dashboard;
    const worksheets = dashboard.worksheets;
    const select = document.getElementById('worksheet-select');

    if (worksheets.length === 0) {
      showError('No se encontraron worksheets en este dashboard.');
      return;
    }

    worksheets.forEach((ws, i) => {
      const opt = document.createElement('option');
      opt.value = ws.name;
      opt.textContent = ws.name;
      select.appendChild(opt);
    });

    // Restaurar worksheet guardada si existe
    const savedWs = tableau.extensions.settings.get('worksheetName');
    if (savedWs) select.value = savedWs;

    select.addEventListener('change', () => loadFields(select.value));
    loadFields(select.value);
  }

  /* ── Carga de campos ────────────────────────────────────── */

  async function loadFields(worksheetName) {
    document.getElementById('config-loading').style.display = 'block';
    document.getElementById('config-fields').style.display = 'none';
    document.getElementById('config-error').style.display = 'none';

    try {
      const dashboard = tableau.extensions.dashboardContent.dashboard;
      currentWorksheet = dashboard.worksheets.find(ws => ws.name === worksheetName);

      if (!currentWorksheet) throw new Error('Worksheet no encontrada: ' + worksheetName);

      const datasources = await currentWorksheet.getDataSourcesAsync();
      if (datasources.length === 0) throw new Error('No hay datasources en este worksheet.');

      // Cargar campos de todos los datasources
      const fieldArrays = await Promise.all(datasources.map(ds => ds.getFieldsAsync()));
      allFields = fieldArrays.flat().filter(f => !f.isHidden);

      // Cargar configuración guardada
      const savedDims    = JSON.parse(tableau.extensions.settings.get('dimensions') || '[]');
      const savedMetrics = JSON.parse(tableau.extensions.settings.get('metrics')    || '[]');

      renderFieldLists(allFields, savedDims, savedMetrics);

      document.getElementById('config-loading').style.display = 'none';
      document.getElementById('config-fields').style.display = 'block';
      document.getElementById('btn-save').disabled = false;

    } catch (err) {
      document.getElementById('config-loading').style.display = 'none';
      showError(err.message);
    }
  }

  /* ── Render de listas de campos ─────────────────────────── */

  function renderFieldLists(fields, savedDims, savedMetrics) {
    const dimList    = document.getElementById('dimensions-list');
    const metricList = document.getElementById('metrics-list');
    dimList.innerHTML = '';
    metricList.innerHTML = '';

    fields.forEach(field => {
      const isNumeric = NUMERIC_DATA_TYPES.has(field.dataType);
      const defaultList = isNumeric ? 'metric' : 'dimension';

      const inDims    = savedDims.includes(field.name);
      const inMetrics = savedMetrics.includes(field.name);

      const dimItem    = buildFieldItem(field, 'dim-'    + encodeId(field.name), inDims);
      const metricItem = buildFieldItem(field, 'metric-' + encodeId(field.name), inMetrics);

      dimList.appendChild(dimItem);
      metricList.appendChild(metricItem);

      // Si no hay configuración previa, pre-marcar por tipo de dato
      if (!inDims && !inMetrics) {
        if (defaultList === 'dimension') dimItem.querySelector('input').checked = true;
        else                             metricItem.querySelector('input').checked = true;
      }
    });
  }

  function buildFieldItem(field, inputId, checked) {
    const div = document.createElement('div');
    div.className = 'field-item';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = inputId;
    cb.dataset.fieldName = field.name;
    cb.checked = checked;

    const label = document.createElement('label');
    label.htmlFor = inputId;
    label.textContent = field.name;

    const typeTag = document.createElement('span');
    typeTag.className = 'field-type';
    typeTag.textContent = field.dataType;

    div.appendChild(cb);
    div.appendChild(label);
    div.appendChild(typeTag);
    return div;
  }

  function encodeId(name) {
    return name.replace(/[^a-zA-Z0-9]/g, '_');
  }

  /* ── Guardar ────────────────────────────────────────────── */

  document.getElementById('btn-save').addEventListener('click', async () => {
    const select = document.getElementById('worksheet-select');

    const checkedDims = Array.from(
      document.querySelectorAll('#dimensions-list input[type=checkbox]:checked')
    ).map(cb => cb.dataset.fieldName);

    const checkedMetrics = Array.from(
      document.querySelectorAll('#metrics-list input[type=checkbox]:checked')
    ).map(cb => cb.dataset.fieldName);

    tableau.extensions.settings.set('worksheetName', select.value);
    tableau.extensions.settings.set('dimensions',    JSON.stringify(checkedDims));
    tableau.extensions.settings.set('metrics',       JSON.stringify(checkedMetrics));

    await tableau.extensions.settings.saveAsync();
    tableau.extensions.ui.closeDialog('saved');
  });

  /* ── Cancelar ───────────────────────────────────────────── */

  document.getElementById('btn-cancel').addEventListener('click', () => {
    tableau.extensions.ui.closeDialog('cancelled');
  });

  /* ── Util ───────────────────────────────────────────────── */

  function showError(msg) {
    const el = document.getElementById('config-error');
    el.textContent = msg;
    el.style.display = 'block';
  }

})();
