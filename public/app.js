// Application State
let pollingIntervalId = null;
let currentIntervalMs = 2000;
let isPollingActive = true;
let isFirstFetch = true;

// Session Statistics Tracking
const sessionStats = {
  rsrp: { best: -Infinity, worst: Infinity },
  sinr: { best: -Infinity, worst: Infinity },
  rsrq: { best: -Infinity, worst: Infinity },
  rssi: { best: -Infinity, worst: Infinity }
};

// Historical Data Log
const sessionLogs = [];

// Chart.js Configuration
let signalChart = null;
const MAX_CHART_POINTS = 30;

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize Lucide Icons
  lucide.createIcons();

  // Load existing configuration from server
  await fetchConfig();

  // Initialize the Line Chart
  initChart();

  // Start polling
  startPolling();

  // Event Listeners
  setupEventListeners();
});

// Fetch configuration (IP & Password existence) from server
async function fetchConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    if (data.success) {
      document.getElementById('header-router-ip').textContent = data.ip;
      document.getElementById('input-router-ip').value = data.ip;
    }
  } catch (err) {
    console.error('Error fetching config from server:', err);
  }
}

// Initialize Chart.js
function initChart() {
  const ctx = document.getElementById('signalChart').getContext('2d');
  
  // Custom font configurations
  Chart.defaults.font.family = 'Outfit, sans-serif';
  Chart.defaults.color = '#94a3b8';

  signalChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'RSRP (dBm)',
          data: [],
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.05)',
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 6,
          fill: true,
          yAxisID: 'y-rsrp',
          tension: 0.3
        },
        {
          label: 'SINR (dB)',
          data: [],
          borderColor: '#06b6d4',
          backgroundColor: 'rgba(6, 182, 212, 0.05)',
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 6,
          fill: true,
          yAxisID: 'y-sinr',
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false // We use our custom legend in HTML
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          backgroundColor: '#1e293b',
          titleColor: '#f8fafc',
          bodyColor: '#e2e8f0',
          borderColor: 'rgba(255, 255, 255, 0.08)',
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8
        }
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(255, 255, 255, 0.03)'
          },
          ticks: {
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 8
          }
        },
        'y-rsrp': {
          type: 'linear',
          position: 'left',
          min: -140,
          max: -40,
          grid: {
            color: 'rgba(255, 255, 255, 0.03)'
          },
          title: {
            display: true,
            text: 'RSRP (dBm)',
            font: { weight: '600' }
          }
        },
        'y-sinr': {
          type: 'linear',
          position: 'right',
          min: -10,
          max: 40,
          grid: {
            drawOnChartArea: false // prevent grid line overlap
          },
          title: {
            display: true,
            text: 'SINR (dB)',
            font: { weight: '600' }
          }
        }
      }
    }
  });
}

// Register event listeners
function setupEventListeners() {
  // Interval Dropdown Change
  document.getElementById('poll-interval').addEventListener('change', (e) => {
    const value = e.target.value;
    if (value === 'manual') {
      stopPolling();
      isPollingActive = false;
      document.getElementById('btn-toggle-poll').disabled = true;
      document.getElementById('btn-manual-poll').disabled = false;
      updatePollButtonUI(false, true);
    } else {
      currentIntervalMs = parseInt(value);
      document.getElementById('btn-toggle-poll').disabled = false;
      document.getElementById('btn-manual-poll').disabled = true;
      if (isPollingActive) {
        startPolling();
      }
    }
  });

  // Toggle Polling Play/Pause
  document.getElementById('btn-toggle-poll').addEventListener('click', () => {
    if (isPollingActive) {
      stopPolling();
      isPollingActive = false;
      updatePollButtonUI(false);
    } else {
      isPollingActive = true;
      startPolling();
      updatePollButtonUI(true);
    }
  });

  // Manual Poll Trigger
  document.getElementById('btn-manual-poll').addEventListener('click', () => {
    pollData();
  });

  // Config Form Submission
  document.getElementById('config-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ip = document.getElementById('input-router-ip').value.trim();
    const password = document.getElementById('input-password').value;

    const btn = document.getElementById('btn-save-config');
    const origContent = btn.innerHTML;
    btn.innerHTML = '<i class="animate-spin" data-lucide="loader"></i> Saving...';
    lucide.createIcons({ attrs: { class: ['animate-spin', 'icon-sm'] } });
    btn.disabled = true;

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip, password })
      });
      const data = await res.json();
      
      if (data.success) {
        document.getElementById('header-router-ip').textContent = ip;
        alert(data.message || 'Config updated successfully!');
        if (data.warning) {
          console.warn(data.warning);
        }
        // Force immediate fetch of new data
        pollData();
      } else {
        alert('Failed to update config: ' + data.error);
      }
    } catch (err) {
      alert('Error updating config: ' + err.message);
    } finally {
      btn.innerHTML = origContent;
      btn.disabled = false;
      lucide.createIcons();
    }
  });

  // Export CSV
  document.getElementById('btn-export-csv').addEventListener('click', exportToCSV);

  // Clear Session Log & Stats
  document.getElementById('btn-clear-session').addEventListener('click', clearSession);
}

// Start polling timer
function startPolling() {
  stopPolling();
  pollData(); // Poll once immediately
  pollingIntervalId = setInterval(pollData, currentIntervalMs);
}

// Stop polling timer
function stopPolling() {
  if (pollingIntervalId) {
    clearInterval(pollingIntervalId);
    pollingIntervalId = null;
  }
}

// Update the toggle button text & icons
function updatePollButtonUI(active, isManual = false) {
  const icon = document.getElementById('poll-icon');
  const text = document.getElementById('poll-btn-text');
  
  if (isManual) {
    icon.setAttribute('data-lucide', 'refresh-cw');
    text.textContent = 'Manual Mode';
  } else if (active) {
    icon.setAttribute('data-lucide', 'pause');
    text.textContent = 'Pause Monitor';
  } else {
    icon.setAttribute('data-lucide', 'play');
    text.textContent = 'Resume Monitor';
  }
  lucide.createIcons();
}

// Fetch single payload from proxy API and update layout
async function pollData() {
  const statusPill = document.getElementById('connection-status-pill');
  const statusText = document.getElementById('connection-status-text');

  // Show retrieving state
  if (isFirstFetch) {
    statusPill.className = 'status-pill status-connecting';
    statusText.textContent = 'Fetching...';
  }

  try {
    const response = await fetch('/api/signal');
    const result = await response.json();

    if (result.success && result.data) {
      statusPill.className = 'status-pill status-connected';
      statusText.textContent = 'Connected';
      
      updateDashboard(result.data);
      isFirstFetch = false;
    } else {
      statusPill.className = 'status-pill status-offline';
      statusText.textContent = 'Auth Error';
      console.error('Backend returned error:', result.error);
    }
  } catch (error) {
    statusPill.className = 'status-pill status-offline';
    statusText.textContent = 'Offline';
    console.error('Fetch error:', error);
  }
}

// Process data payload & update all UI cards
function updateDashboard(data) {
  const timestamp = new Date().toLocaleTimeString();

  // Extract variables with default fallback
  const rsrp = (data.lte_rsrp !== undefined && data.lte_rsrp !== '') ? parseInt(data.lte_rsrp) : null;
  const sinr = (data.Z_SINR !== undefined && data.Z_SINR !== '') ? parseFloat(data.Z_SINR) : null;
  const rsrq = (data.Z_rsrq !== undefined && data.Z_rsrq !== '') ? parseInt(data.Z_rsrq) : null;
  let rssi = (data.rssi !== undefined && data.rssi !== '') ? parseInt(data.rssi) : null;

  // Normalize positive RSSI (e.g. 53 -> -53 dBm)
  if (rssi !== null && rssi > 0) {
    rssi = -rssi;
  }

  // 1. Update Core Metric Cards
  updateMetricCard('rsrp', rsrp, -140, -40, 'dBm', getRSRPQuality);
  updateMetricCard('sinr', sinr, -10, 40, 'dB', getSINRQuality);
  updateMetricCard('rsrq', rsrq, -30, -3, 'dB', getRSRQQuality);
  updateMetricCard('rssi', rssi, -120, -30, 'dBm', getRSSIQuality);

  // 2. Track & Update Session Min/Max Stats
  trackSessionStats('rsrp', rsrp);
  trackSessionStats('sinr', sinr);
  trackSessionStats('rsrq', rsrq);
  trackSessionStats('rssi', rssi);

  // 3. Update Chart
  updateChartData(timestamp, rsrp, sinr);

  // 4. Update Quick Stats
  document.getElementById('val-net-type').textContent = data.network_type || 'N/A';
  document.getElementById('val-ppp-status').textContent = data.ppp_status || 'N/A';
  document.getElementById('val-pcell-band').textContent = data.lte_ca_pcell_band || 'N/A';
  document.getElementById('val-ca-status').textContent = data.wan_lte_ca === 'active' ? 'Active' : 'Inactive';

  // 5. Update Expanded Stats table
  document.getElementById('det-enb-id').textContent = data.Z_eNB_id || '-';
  document.getElementById('det-cell-id').textContent = data.Z_CELL_ID || '-';
  document.getElementById('det-pcell-arfcn').textContent = data.lte_ca_pcell_arfcn || '-';
  document.getElementById('det-pcell-bw').textContent = data.lte_ca_pcell_bandwidth ? `${data.lte_ca_pcell_bandwidth} MHz` : '-';
  document.getElementById('det-ipv4').textContent = data.wan_ipaddr || '-';
  document.getElementById('det-ipv6').textContent = data.ipv6_wan_ipaddr || '-';
  document.getElementById('det-rscp').textContent = data.rscp ? `${data.rscp} dBm` : '-';
  document.getElementById('det-static-ip').textContent = data.static_wan_ipaddr || 'Disabled';
  document.getElementById('det-scell-band').textContent = data.lte_ca_scell_band || 'None';
  document.getElementById('det-scell-info').textContent = data.lte_ca_scell_info || '-';

  // 6. Log Values to Session Log Table
  logToTable(timestamp, rsrp, sinr, rsrq, rssi, data.network_type, data.Z_CELL_ID);
}

// Render individual signal strength cards with correct color bands
function updateMetricCard(name, val, min, max, unit, qualityFn) {
  const numElem = document.getElementById(`${name}-val`);
  const barElem = document.getElementById(`${name}-bar`);
  const badgeElem = document.getElementById(`${name}-quality`);

  if (val === null || isNaN(val)) {
    numElem.textContent = '-';
    barElem.className = `progress-bar-fill fill-unknown`;
    barElem.style.width = '0%';
    badgeElem.textContent = 'Unknown';
    badgeElem.className = 'metric-badge quality-unknown';
    return;
  }

  // Calculate percentage range
  const range = max - min;
  const clampedVal = Math.max(min, Math.min(max, val));
  const percentage = ((clampedVal - min) / range) * 100;
  
  // Set value and bar percentage
  numElem.textContent = val;
  barElem.style.width = `${percentage}%`;

  // Set Quality Classification
  const quality = qualityFn(val);
  badgeElem.textContent = quality;
  badgeElem.className = `metric-badge quality-${quality.toLowerCase()}`;
  barElem.className = `progress-bar-fill fill-${quality.toLowerCase()}`;
}

// Track Best and Worst values for the session
function trackSessionStats(metric, val) {
  if (val === null || isNaN(val)) return;

  const stats = sessionStats[metric];
  
  // Update worst (lowest quality value)
  // For RSRP, RSRQ, RSSI: lower (more negative) is worst.
  // For SINR: lower is worst.
  if (val < stats.worst) {
    stats.worst = val;
    document.getElementById(`${metric}-worst`).textContent = `${val}`;
  }

  // Update best (highest quality value)
  // For RSRP, RSRQ, RSSI: higher (less negative / closer to 0) is best.
  // For SINR: higher is best.
  if (val > stats.best) {
    stats.best = val;
    document.getElementById(`${metric}-best`).textContent = `${val}`;
  }
}

// Add a row to the log table
function logToTable(time, rsrp, sinr, rsrq, rssi, network, cellId) {
  const tableBody = document.getElementById('log-table-body');
  
  // Remove empty row indicator if present
  const emptyRow = tableBody.querySelector('.empty-row');
  if (emptyRow) {
    emptyRow.remove();
  }

  // Add data object to historical logs memory
  sessionLogs.unshift({
    timestamp: time,
    rsrp: rsrp !== null ? rsrp : '-',
    sinr: sinr !== null ? sinr : '-',
    rsrq: rsrq !== null ? rsrq : '-',
    rssi: rssi !== null ? rssi : '-',
    network: network || '-',
    cellId: cellId || '-'
  });

  // Limit logs to keep DOM size healthy (e.g. max 100 rows visible, but keep full array in memory)
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td class="text-mono">${time}</td>
    <td class="text-mono font-semibold">${rsrp !== null ? rsrp : '-'}</td>
    <td class="text-mono font-semibold">${sinr !== null ? sinr : '-'}</td>
    <td class="text-mono">${rsrq !== null ? rsrq : '-'}</td>
    <td class="text-mono">${rssi !== null ? rssi : '-'}</td>
    <td>${network || '-'}</td>
    <td class="text-mono">${cellId || '-'}</td>
  `;
  
  // Insert at top of table
  tableBody.insertBefore(tr, tableBody.firstChild);

  // Trim table UI if exceeds 100 rows (performance)
  if (tableBody.children.length > 100) {
    tableBody.removeChild(tableBody.lastChild);
  }
}

// Export logs database to CSV format
function exportToCSV() {
  if (sessionLogs.length === 0) {
    alert('No data to export.');
    return;
  }

  let csvContent = 'data:text/csv;charset=utf-8,';
  csvContent += 'Timestamp,RSRP (dBm),SINR (dB),RSRQ (dB),RSSI (dBm),Network Type,Cell ID\n';

  // Reverse list to preserve oldest -> newest order in CSV export
  const orderedLogs = [...sessionLogs].reverse();

  orderedLogs.forEach(log => {
    csvContent += `"${log.timestamp}","${log.rsrp}","${log.sinr}","${log.rsrq}","${log.rssi}","${log.network}","${log.cellId}"\n`;
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `zte_signal_log_${new Date().toISOString().slice(0,10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Clear Session Log & Stats
function clearSession() {
  if (!confirm('Are you sure you want to reset all session statistics and logs?')) {
    return;
  }

  // Reset stats in memory
  sessionStats.rsrp = { best: -Infinity, worst: Infinity };
  sessionStats.sinr = { best: -Infinity, worst: Infinity };
  sessionStats.rsrq = { best: -Infinity, worst: Infinity };
  sessionStats.rssi = { best: -Infinity, worst: Infinity };

  // Clear memory log
  sessionLogs.length = 0;

  // Clear UI text indicators
  const metrics = ['rsrp', 'sinr', 'rsrq', 'rssi'];
  metrics.forEach(m => {
    document.getElementById(`${m}-best`).textContent = '-';
    document.getElementById(`${m}-worst`).textContent = '-';
  });

  // Clear table UI
  const tableBody = document.getElementById('log-table-body');
  tableBody.innerHTML = `
    <tr class="empty-row">
      <td colspan="7">No polling history recorded in this session yet.</td>
    </tr>
  `;

  // Clear Chart
  if (signalChart) {
    signalChart.data.labels = [];
    signalChart.data.datasets[0].data = [];
    signalChart.data.datasets[1].data = [];
    signalChart.update();
  }
}

// Update line chart datasets
function updateChartData(label, rsrp, sinr) {
  if (!signalChart) return;

  const labels = signalChart.data.labels;
  const rsrpData = signalChart.data.datasets[0].data;
  const sinrData = signalChart.data.datasets[1].data;

  labels.push(label);
  rsrpData.push(rsrp);
  sinrData.push(sinr);

  // Shift older data if max capacity reached
  if (labels.length > MAX_CHART_POINTS) {
    labels.shift();
    rsrpData.shift();
    sinrData.shift();
  }

  signalChart.update('none'); // Update without full animation frame reset (smoother performance)
}

// Quality Classifiers
// RSRP Levels: >=-80 Excellent (emerald), -80 to -90 Good (lime), -90 to -100 Fair (amber), <-100 Poor (rose)
function getRSRPQuality(val) {
  if (val >= -80) return 'Excellent';
  if (val >= -90) return 'Good';
  if (val >= -100) return 'Fair';
  return 'Poor';
}

// SINR Levels: >=20 Excellent, 13 to 20 Good, 0 to 13 Fair, <0 Poor
function getSINRQuality(val) {
  if (val >= 20) return 'Excellent';
  if (val >= 13) return 'Good';
  if (val >= 0) return 'Fair';
  return 'Poor';
}

// RSRQ Levels: >=-10 Excellent, -10 to -15 Good, -15 to -20 Fair, <-20 Poor
function getRSRQQuality(val) {
  if (val >= -10) return 'Excellent';
  if (val >= -15) return 'Good';
  if (val >= -20) return 'Fair';
  return 'Poor';
}

// RSSI Levels: >=-65 Excellent, -65 to -75 Good, -75 to -85 Fair, <-85 Poor
function getRSSIQuality(val) {
  if (val >= -65) return 'Excellent';
  if (val >= -75) return 'Good';
  if (val >= -85) return 'Fair';
  return 'Poor';
}
