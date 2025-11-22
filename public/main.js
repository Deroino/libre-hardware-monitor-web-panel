const DEFAULT_DATA_ENDPOINT = 'http://localhost:8085/data.json';
let dataEndpoint = DEFAULT_DATA_ENDPOINT;
const THEME_CLASSES = ['theme-cyber', 'theme-midnight', 'theme-orbit'];

let refreshMs = 5000;
let refreshHandle = null;

const refs = {
  slider: document.getElementById('refreshSlider'),
  sliderLabel: document.getElementById('refreshSliderValue'),
  numeric: document.getElementById('refreshInput'),
  refreshBtn: document.getElementById('refreshNow'),
  themeToggle: document.getElementById('themeToggle'),
  themePanel: document.getElementById('themePanel'),
  settingsToggle: document.getElementById('settingsToggle'),
  settingsPanel: document.getElementById('settingsPanel'),
  dataUrlInput: document.getElementById('dataUrlInput'),
  dataUrlApply: document.getElementById('applyDataUrl'),
  themeSelect: document.getElementById('themeSelect'),
  nicSelect: document.getElementById('nicSelect')
};

const networkState = {
  devices: [],
  selected: ''
};
const popovers = [];

const detailConfig = {
  cpu: [
    { label: 'Core Max Temp', includes: ['intel', 'temperatures', 'core max'] },
    { label: 'Core Avg Temp', includes: ['intel', 'temperatures', 'core average'] },
    { label: 'Package Power', includes: ['intel', 'powers', 'cpu package'] },
    { label: 'Platform Power', includes: ['intel', 'powers', 'cpu platform'] },
    { label: 'Core Voltage', includes: ['intel', 'voltages', 'cpu core'], type: 'Voltage' },
    { label: 'Total Load', includes: ['intel', 'load', 'cpu total'] },
    { label: 'Core Max Load', includes: ['intel', 'load', 'cpu core max'] },
    { label: 'Bus Speed', includes: ['intel', 'clocks', 'bus speed'] }
  ],
  gpu: [
    { label: 'Core Temp', includes: ['nvidia', 'temperatures', 'gpu core'] },
    { label: 'Hot Spot', includes: ['nvidia', 'temperatures', 'gpu hot spot'] },
    { label: 'Package Power', includes: ['nvidia', 'powers', 'gpu package'] },
    { label: 'Core Clock', includes: ['nvidia', 'clocks', 'gpu core'] },
    { label: 'Memory Clock', includes: ['nvidia', 'clocks', 'gpu memory'] },
    { label: 'Memory Controller', includes: ['nvidia', 'load', 'gpu memory controller'] },
    { label: 'Video Engine', includes: ['nvidia', 'load', 'gpu video engine'] },
    { label: 'PCIe Rx', includes: ['nvidia', 'throughput', 'gpu pcie rx'] },
    { label: 'PCIe Tx', includes: ['nvidia', 'throughput', 'gpu pcie tx'] }
  ]
};

function flattenSensors(node, parents = []) {
  if (!node) {
    return [];
  }

  const currentLabel = node.Text || node.text || '';
  const nextParents = currentLabel ? [...parents, currentLabel] : parents;
  const deviceName = nextParents[2] || nextParents[nextParents.length - 1] || '';
  let sensors = [];

  if (node.SensorId) {
    const path = nextParents.join(' / ');
    sensors.push({
      path,
      pathLower: path.toLowerCase(),
      text: node.Text,
      value: node.Value,
      type: node.Type,
      min: node.Min,
      max: node.Max,
      sensorId: node.SensorId,
      device: deviceName
    });
  }

  if (Array.isArray(node.Children)) {
    node.Children.forEach((child) => {
      sensors = sensors.concat(flattenSensors(child, nextParents));
    });
  }

  return sensors;
}

function findSensor(sensors, criteria = {}) {
  const includes = (criteria.includes || []).map((token) => token.toLowerCase());
  return sensors.find((sensor) => {
    if (!sensor) {
      return false;
    }
    if (criteria.type && sensor.type !== criteria.type) {
      return false;
    }
    if (criteria.text && (sensor.text || '').toLowerCase() !== criteria.text.toLowerCase()) {
      return false;
    }
    return includes.every((token) => sensor.pathLower.includes(token));
  });
}

function parseValueToNumber(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const match = value.match(/-?[\d.]+/);
  return match ? Number(match[0]) : null;
}

function updateField(name, text) {
  document.querySelectorAll(`[data-field="${name}"]`).forEach((el) => {
    el.textContent = text ?? '--';
  });
}

function closeAllPopovers() {
  popovers.forEach(({ panel }) => panel.classList.remove('is-open'));
}

function registerPopover(toggle, panel) {
  if (!toggle || !panel) return;
  popovers.push({ toggle, panel });
  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    const isOpen = panel.classList.contains('is-open');
    closeAllPopovers();
    if (!isOpen) {
      panel.classList.add('is-open');
    }
  });
  panel.addEventListener('click', (event) => event.stopPropagation());
}

document.addEventListener('click', closeAllPopovers);

function setGaugeValue(name, percent) {
  const gauge = document.querySelector(`[data-gauge="${name}"]`);
  if (!gauge) return;
  const clamped = Math.max(0, Math.min(Number(percent) || 0, 100));
  gauge.style.setProperty('--value', clamped);
}

function setBarWidth(field, percent) {
  const el = document.querySelector(`[data-field="${field}"]`);
  if (!el) return;
  const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
  el.style.width = `${clamped}%`;
}

function collectNetworkDevices(sensors) {
  const nicSensors = sensors.filter((sensor) => sensor.sensorId && sensor.sensorId.includes('/nic/'));
  const map = new Map();
  nicSensors.forEach((sensor) => {
    const match = sensor.sensorId.match(/\/nic\/([^/]+)/i);
    const key = (match && match[1]) || sensor.device || sensor.pathLower;
    const name = sensor.device || key || 'NIC';
    if (!map.has(key)) {
      map.set(key, {
        key,
        name,
        upload: '--',
        download: '--',
        utilization: '--'
      });
    }
    const entry = map.get(key);
    const label = sensor.pathLower || '';
    if (label.includes('upload speed')) {
      entry.upload = sensor.value;
    } else if (label.includes('download speed')) {
      entry.download = sensor.value;
    } else if (label.includes('network utilization')) {
      entry.utilization = sensor.value;
    }
  });
  return Array.from(map.values());
}

function syncNicDevices(devices) {
  networkState.devices = devices;
  const select = refs.nicSelect;
  if (!select) return;
  select.innerHTML = '';
  if (!devices.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No interface';
    select.appendChild(option);
    select.disabled = true;
    updateField('nicUpload', '--');
    updateField('nicDownload', '--');
    updateField('nicUtil', '--');
    return;
  }

  select.disabled = false;
  if (!networkState.selected || !devices.some((device) => device.key === networkState.selected)) {
    networkState.selected = devices[0].key;
  }

  devices.forEach((device) => {
    const option = document.createElement('option');
    option.value = device.key;
    option.textContent = device.name;
    if (device.key === networkState.selected) {
      option.selected = true;
    }
    select.appendChild(option);
  });

  renderNetworkCard();
}

function renderNetworkCard() {
  const active = networkState.devices.find((device) => device.key === networkState.selected);
  updateField('nicUpload', active?.upload ?? '--');
  updateField('nicDownload', active?.download ?? '--');
  updateField('nicUtil', active?.utilization ?? '--');
}

function computeStatus(load, temp) {
  if (load == null && temp == null) {
    return { label: 'Offline', level: '' };
  }
  if ((temp ?? 0) >= 90 || (load ?? 0) >= 95) {
    return { label: 'Critical', level: 'danger' };
  }
  if ((temp ?? 0) >= 80 || (load ?? 0) >= 80) {
    return { label: 'Hot', level: 'warn' };
  }
  if ((temp ?? 0) >= 65 || (load ?? 0) >= 60) {
    return { label: 'Pushing', level: 'warn' };
  }
  return { label: 'Nominal', level: 'ok' };
}

function applyStatus(field, status) {
  document.querySelectorAll(`[data-field="${field}"]`).forEach((el) => {
    el.textContent = status.label;
    el.classList.remove('ok', 'warn', 'danger');
    if (status.level) {
      el.classList.add(status.level);
    }
  });
}

function renderDetailList(containerId, entries) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  const fragment = document.createDocumentFragment();
  entries.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'detail-row';
    const label = document.createElement('span');
    label.textContent = entry.label;
    const value = document.createElement('span');
    value.textContent = entry.value ?? '--';
    row.append(label, value);
    fragment.appendChild(row);
  });
  container.appendChild(fragment);
}

function toGB(mbValue) {
  if (!Number.isFinite(mbValue)) return null;
  return mbValue / 1024;
}

function renderTelemetry(payload) {
  const sensors = flattenSensors(payload);

  const cpuLoadSensor = findSensor(sensors, { includes: ['intel', 'load', 'cpu total'] });
  const cpuTempSensor = findSensor(sensors, { includes: ['intel', 'temperatures', 'core max'] });
  const cpuPowerSensor = findSensor(sensors, { includes: ['intel', 'powers', 'cpu package'] });

  const cpuLoadValue = parseValueToNumber(cpuLoadSensor?.value);
  const cpuTempValue = parseValueToNumber(cpuTempSensor?.value);
  const cpuPowerValue = parseValueToNumber(cpuPowerSensor?.value);

  updateField('cpuLoadValue', cpuLoadValue != null ? `${cpuLoadValue.toFixed(0)}%` : '--');
  updateField('cpuTemp', cpuTempSensor?.value ?? '--');
  updateField('cpuPower', cpuPowerSensor?.value ?? '--');
  setGaugeValue('cpu', cpuLoadValue ?? 0);

  const gpuLoadSensor = findSensor(sensors, { includes: ['nvidia', 'load', 'gpu core'] });
  const gpuTempSensor = findSensor(sensors, { includes: ['nvidia', 'temperatures', 'gpu core'] });
  const gpuPowerSensor = findSensor(sensors, { includes: ['nvidia', 'powers', 'gpu package'] });

  const gpuLoadValue = parseValueToNumber(gpuLoadSensor?.value);
  const gpuTempValue = parseValueToNumber(gpuTempSensor?.value);
  const gpuPowerValue = parseValueToNumber(gpuPowerSensor?.value);

  updateField('gpuLoadValue', gpuLoadValue != null ? `${gpuLoadValue.toFixed(0)}%` : '--');
  updateField('gpuTemp', gpuTempSensor?.value ?? '--');
  updateField('gpuPower', gpuPowerSensor?.value ?? '--');
  setGaugeValue('gpu', gpuLoadValue ?? 0);

  const totalPowerValue = (cpuPowerValue || 0) + (gpuPowerValue || 0);
  updateField('totalPower', totalPowerValue ? `${totalPowerValue.toFixed(1)} W` : '--');

  const cpuShare = totalPowerValue ? (cpuPowerValue / totalPowerValue) * 100 : 0;
  const gpuShare = totalPowerValue ? (gpuPowerValue / totalPowerValue) * 100 : 0;
  setBarWidth('cpuPowerBar', cpuShare);
  setBarWidth('gpuPowerBar', gpuShare);

  const gpuMemoryUsedSensor = findSensor(sensors, { includes: ['nvidia', 'data', 'gpu memory used'] });
  const gpuMemoryTotalSensor = findSensor(sensors, { includes: ['nvidia', 'data', 'gpu memory total'] });
  const gpuMemoryFreeSensor = findSensor(sensors, { includes: ['nvidia', 'data', 'gpu memory free'] });

  const memUsed = toGB(parseValueToNumber(gpuMemoryUsedSensor?.value));
  const memTotal = toGB(parseValueToNumber(gpuMemoryTotalSensor?.value));
  const memFree = toGB(parseValueToNumber(gpuMemoryFreeSensor?.value));
  const memPercent = memTotal ? (memUsed / memTotal) * 100 : 0;

  updateField('gpuMemoryUsed', memUsed != null ? `${memUsed.toFixed(1)} GB` : gpuMemoryUsedSensor?.value ?? '--');
  updateField('gpuMemoryTotal', memTotal != null ? `${memTotal.toFixed(1)} GB` : gpuMemoryTotalSensor?.value ?? '--');
  updateField('gpuMemoryFree', memFree != null ? `${memFree.toFixed(1)} GB` : gpuMemoryFreeSensor?.value ?? '--');
  setBarWidth('gpuMemoryBar', memPercent);

  const memoryUsedSensor = findSensor(sensors, { includes: ['generic memory', 'data', 'memory used'] });
  const memoryFreeSensor = findSensor(sensors, { includes: ['generic memory', 'data', 'memory available'] });
  const memoryLoadSensor = findSensor(sensors, { includes: ['generic memory', 'load', 'memory'] });

  const memoryLoadValue = parseValueToNumber(memoryLoadSensor?.value);
  const memoryUsedValue = parseValueToNumber(memoryUsedSensor?.value);
  const memoryFreeValue = parseValueToNumber(memoryFreeSensor?.value);
  const memoryTotalValue =
    Number.isFinite(memoryUsedValue) && Number.isFinite(memoryFreeValue) ? memoryUsedValue + memoryFreeValue : null;

  updateField('memoryUsed', memoryUsedSensor?.value ?? '--');
  updateField('memoryFree', memoryFreeSensor?.value ?? '--');
  updateField('memoryLoad', memoryLoadSensor?.value ?? '--');
  updateField('memoryTotal', memoryTotalValue != null ? `${memoryTotalValue.toFixed(1)} GB` : '--');
  setBarWidth('memoryBar', memoryLoadValue ?? 0);

  const storageUsedSensor = findSensor(sensors, { includes: ['nvme', 'load', 'used space'] });
  const storageTempSensor = findSensor(sensors, { includes: ['nvme', 'temperatures', 'temperature'] });
  const storageReadSensor = findSensor(sensors, { includes: ['nvme', 'throughput', 'read rate'] });
  const storageWriteSensor = findSensor(sensors, { includes: ['nvme', 'throughput', 'write rate'] });

  updateField('storageUsedPercent', storageUsedSensor?.value ?? '--');
  updateField('storageTemp', storageTempSensor?.value ?? '--');
  updateField('storageRead', storageReadSensor?.value ?? '--');
  updateField('storageWrite', storageWriteSensor?.value ?? '--');

  const networkDevices = collectNetworkDevices(sensors);
  syncNicDevices(networkDevices);

  const cpuStatus = computeStatus(cpuLoadValue, cpuTempValue);
  const gpuStatus = computeStatus(gpuLoadValue, gpuTempValue);
  applyStatus('cpuStatus', cpuStatus);
  applyStatus('gpuStatus', gpuStatus);

  const cpuDetails = detailConfig.cpu.map((item) => {
    const sensor = findSensor(sensors, item);
    return { label: item.label, value: sensor?.value ?? '--' };
  });
  const gpuDetails = detailConfig.gpu.map((item) => {
    const sensor = findSensor(sensors, item);
    return { label: item.label, value: sensor?.value ?? '--' };
  });
  renderDetailList('cpuDetailList', cpuDetails);
  renderDetailList('gpuDetailList', gpuDetails);
}

async function fetchTelemetry() {
  try {
    const target = dataEndpoint;
    const response = await fetch(target, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }
    const payload = await response.json();
    renderTelemetry(payload);
  } catch (error) {
    console.error('Telemetry fetch failed', error);
    applyStatus('cpuStatus', { label: 'Awaiting', level: '' });
    applyStatus('gpuStatus', { label: 'Awaiting', level: '' });
  }
}

function scheduleRefresh() {
  if (refreshHandle) {
    clearInterval(refreshHandle);
  }
  refreshHandle = setInterval(fetchTelemetry, refreshMs);
}

function setRefreshInterval(seconds, syncInputs = true) {
  const sanitized = Math.max(1, Number(seconds) || 5);
  refreshMs = sanitized * 1000;
  if (syncInputs) {
    if (refs.slider) refs.slider.value = String(sanitized);
    if (refs.numeric) refs.numeric.value = String(sanitized);
    if (refs.sliderLabel) refs.sliderLabel.textContent = `${sanitized}s`;
  }
  scheduleRefresh();
}

function setDataEndpoint(url) {
  const trimmed = (url || '').trim();
  const target = trimmed || DEFAULT_DATA_ENDPOINT;
  dataEndpoint = target;
  if (refs.dataUrlInput) {
    refs.dataUrlInput.value = target;
  }
  closeAllPopovers();
  fetchTelemetry();
}

function initControls() {
  registerPopover(refs.themeToggle, refs.themePanel);
  registerPopover(refs.settingsToggle, refs.settingsPanel);

  if (refs.slider) {
    refs.slider.addEventListener('input', (event) => {
      const seconds = Number(event.target.value);
      if (refs.sliderLabel) {
        refs.sliderLabel.textContent = `${seconds}s`;
      }
    });
    refs.slider.addEventListener('change', (event) => {
      setRefreshInterval(Number(event.target.value), true);
    });
  }

  if (refs.numeric) {
    refs.numeric.addEventListener('change', (event) => {
      const seconds = Number(event.target.value);
      setRefreshInterval(seconds, true);
    });
  }

  if (refs.refreshBtn) {
    refs.refreshBtn.addEventListener('click', () => {
      fetchTelemetry();
    });
  }

  if (refs.dataUrlInput) {
    refs.dataUrlInput.value = dataEndpoint;
    refs.dataUrlInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        setDataEndpoint(event.target.value);
      }
    });
  }

  if (refs.dataUrlApply) {
    refs.dataUrlApply.addEventListener('click', () => {
      setDataEndpoint(refs.dataUrlInput ? refs.dataUrlInput.value : dataEndpoint);
    });
  }

  if (refs.themeSelect) {
    refs.themeSelect.addEventListener('change', (event) => {
      const theme = event.target.value;
      if (!theme) return;
      document.body.classList.remove(...THEME_CLASSES);
      document.body.classList.add(`theme-${theme}`);
      closeAllPopovers();
    });
  }

  if (refs.nicSelect) {
    refs.nicSelect.addEventListener('change', (event) => {
      networkState.selected = event.target.value;
      renderNetworkCard();
    });
  }

  document.querySelectorAll('.collapsible').forEach((panel) => {
    const toggle = panel.querySelector('.collapsible-toggle');
    if (!toggle) return;
    toggle.addEventListener('click', () => {
      panel.classList.toggle('is-open');
    });
  });
}

function init() {
  initControls();
  setRefreshInterval(5, true);
  fetchTelemetry();
}

document.addEventListener('DOMContentLoaded', init);
