// Application State
let pollingIntervalId = null;
let currentIntervalMs = 2000;
let isPollingActive = true;
let isFirstFetch = true;

// Positioning Aids State
let audioCtx = null;
let isAudioToneActive = false;
let isSpeechActive = false;
let lastTtsTime = 0;

// Rolling queue for delta calculations (5-second window)
const deltaWindowQueue = [];

let prevMetrics = {
  rsrp: null,
  sinr: null,
  rsrq: null,
  rssi: null,
  cellId: null
};

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

  // Load historical signals from database
  await fetchHistory();

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

// Fetch database historical logs from server to populate the interface
async function fetchHistory(limit = 100) {
  try {
    const res = await fetch(`/api/history?limit=${limit}`);
    const data = await res.json();
    if (data.success && data.history) {
      // Clear existing UI data to prevent duplicates
      sessionLogs.length = 0;

      // Reset best/worst stats in memory to recalculate over the history window
      sessionStats.rsrp = { best: -Infinity, worst: Infinity };
      sessionStats.sinr = { best: -Infinity, worst: Infinity };
      sessionStats.rsrq = { best: -Infinity, worst: Infinity };
      sessionStats.rssi = { best: -Infinity, worst: Infinity };

      // Reset best/worst UI text indicators
      const metrics = ['rsrp', 'sinr', 'rsrq', 'rssi'];
      metrics.forEach(m => {
        document.getElementById(`${m}-best`).textContent = '-';
        document.getElementById(`${m}-worst`).textContent = '-';
      });

      if (signalChart) {
        signalChart.data.labels = [];
        signalChart.data.datasets[0].data = [];
        signalChart.data.datasets[1].data = [];
      }

      // Loop through and load historical records
      data.history.forEach(row => {
        const timestamp = new Date(row.timestamp).toLocaleTimeString();
        
        sessionLogs.unshift({
          timestamp: timestamp,
          rsrp: row.rsrp !== null ? row.rsrp : '-',
          sinr: row.sinr !== null ? row.sinr : '-',
          rsrq: row.rsrq !== null ? row.rsrq : '-',
          rssi: row.rssi !== null ? row.rssi : '-',
          network: row.network_type || '-',
          cellId: row.cell_id || '-'
        });

        trackSessionStats('rsrp', row.rsrp);
        trackSessionStats('sinr', row.sinr);
        trackSessionStats('rsrq', row.rsrq);
        trackSessionStats('rssi', row.rssi);

        if (signalChart) {
          signalChart.data.labels.push(timestamp);
          signalChart.data.datasets[0].data.push(row.rsrp);
          signalChart.data.datasets[1].data.push(row.sinr);
        }
      });

      // Set prevMetrics for delta tracking
      if (data.history.length > 0) {
        const lastRow = data.history[data.history.length - 1];
        prevMetrics = {
          rsrp: lastRow.rsrp,
          sinr: lastRow.sinr,
          rsrq: lastRow.rsrq,
          rssi: lastRow.rssi,
          cellId: lastRow.cell_id
        };
        evaluatePlacement(lastRow.rsrp, lastRow.sinr, lastRow.rsrq);
      }

      if (signalChart) {
        signalChart.update();
      }

      rebuildLogTableUI();
    }
  } catch (err) {
    console.error('Error loading history from database:', err);
  }
}

// Rebuilds the DOM log table with session logs array
function rebuildLogTableUI() {
  const tableBody = document.getElementById('log-table-body');
  if (!tableBody) return;

  tableBody.innerHTML = '';
  
  if (sessionLogs.length === 0) {
    tableBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="7">No polling history recorded in this session yet.</td>
      </tr>
    `;
    return;
  }

  // Display all loaded history records
  sessionLogs.forEach(log => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="text-mono">${log.timestamp}</td>
      <td class="text-mono font-semibold">${log.rsrp !== null ? log.rsrp : '-'}</td>
      <td class="text-mono font-semibold">${log.sinr !== null ? log.sinr : '-'}</td>
      <td class="text-mono">${log.rsrq !== null ? log.rsrq : '-'}</td>
      <td class="text-mono">${log.rssi !== null ? log.rssi : '-'}</td>
      <td>${log.network || '-'}</td>
      <td class="text-mono">${log.cellId || '-'}</td>
    `;
    tableBody.appendChild(tr);
  });
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
        },
        annotation: {
          annotations: {
            rsrpExcellent: {
              type: 'box',
              yScaleID: 'y-rsrp',
              yMin: -80,
              yMax: -40,
              backgroundColor: 'rgba(16, 185, 129, 0.03)',
              borderWidth: 0
            },
            rsrpGood: {
              type: 'box',
              yScaleID: 'y-rsrp',
              yMin: -90,
              yMax: -80,
              backgroundColor: 'rgba(132, 204, 22, 0.02)',
              borderWidth: 0
            },
            rsrpFair: {
              type: 'box',
              yScaleID: 'y-rsrp',
              yMin: -100,
              yMax: -90,
              backgroundColor: 'rgba(234, 179, 8, 0.02)',
              borderWidth: 0
            },
            rsrpPoor: {
              type: 'box',
              yScaleID: 'y-rsrp',
              yMin: -140,
              yMax: -100,
              backgroundColor: 'rgba(239, 68, 68, 0.02)',
              borderWidth: 0
            }
          }
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

  // Change History Limit Selector
  document.getElementById('select-history-limit').addEventListener('change', (e) => {
    const limit = parseInt(e.target.value) || 100;
    fetchHistory(limit);
  });

  // Toggle Audio Beep Finder
  document.getElementById('toggle-audio-beep').addEventListener('change', (e) => {
    isAudioToneActive = e.target.checked;
    if (isAudioToneActive && !audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
  });

  // Toggle Speech TTS Finder
  document.getElementById('toggle-speech').addEventListener('change', (e) => {
    isSpeechActive = e.target.checked;
  });
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

  // Update Deltas using a rolling 5-second window to prevent rapid flickering
  updateRollingDeltas(rsrp, sinr, rsrq, rssi);

  // Check for Cell Tower handoffs
  const cellId = data.Z_CELL_ID || null;
  if (prevMetrics.cellId !== null && cellId !== null && prevMetrics.cellId !== cellId) {
    handleCellSwitch(timestamp, cellId, data.Z_eNB_id || 'N/A');
  }

  // Store for next time
  prevMetrics = { rsrp, sinr, rsrq, rssi, cellId };

  // Trigger Positioning Audio Finder Tone
  if (isAudioToneActive) {
    playAcousticBeep(rsrp);
  }

  // Trigger TTS voice readout
  if (isSpeechActive) {
    speakSignal(rsrp, sinr);
  }

  // Evaluate Positioning Advice
  evaluatePlacement(rsrp, sinr, rsrq);

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
async function clearSession() {
  if (!confirm('Are you sure you want to reset all session statistics and logs?')) {
    return;
  }

  // Clear server SQLite database logs
  try {
    await fetch('/api/history/clear', { method: 'POST' });
  } catch (err) {
    console.error('Failed to clear database logs:', err);
  }

  // Reset stats in memory
  sessionStats.rsrp = { best: -Infinity, worst: Infinity };
  sessionStats.sinr = { best: -Infinity, worst: Infinity };
  sessionStats.rsrq = { best: -Infinity, worst: Infinity };
  sessionStats.rssi = { best: -Infinity, worst: Infinity };

  // Clear memory log
  sessionLogs.length = 0;
  deltaWindowQueue.length = 0;

  // Clear UI text indicators
  const metrics = ['rsrp', 'sinr', 'rsrq', 'rssi'];
  metrics.forEach(m => {
    document.getElementById(`${m}-best`).textContent = '-';
    document.getElementById(`${m}-worst`).textContent = '-';
    const deltaElem = document.getElementById(`${m}-delta`);
    if (deltaElem) {
      deltaElem.style.display = 'none';
      deltaElem.textContent = '';
    }
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
    
    // Clear handoff annotations
    if (signalChart.options.plugins.annotation && signalChart.options.plugins.annotation.annotations) {
      const annotations = signalChart.options.plugins.annotation.annotations;
      for (const key in annotations) {
        if (key.startsWith('switch-')) {
          delete annotations[key];
        }
      }
    }
    
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

    // Prune out-of-view handoff annotations
    if (signalChart.options.plugins.annotation && signalChart.options.plugins.annotation.annotations) {
      const annotations = signalChart.options.plugins.annotation.annotations;
      for (const key in annotations) {
        if (key.startsWith('switch-') && !labels.includes(annotations[key].value)) {
          delete annotations[key];
        }
      }
    }
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

// Updates and displays deltas relative to a 5-second rolling window
function updateRollingDeltas(rsrp, sinr, rsrq, rssi) {
  const now = Date.now();

  // Push current values to the rolling window queue
  deltaWindowQueue.push({
    time: now,
    rsrp,
    sinr,
    rsrq,
    rssi
  });

  // Prune entries older than 5 seconds
  while (deltaWindowQueue.length > 0 && (now - deltaWindowQueue[0].time > 5000)) {
    // Keep at least one element for reference
    if (deltaWindowQueue.length === 1) break;
    deltaWindowQueue.shift();
  }

  // The reference values are the oldest ones in our 5-second window
  const ref = deltaWindowQueue[0];

  updateDelta('rsrp', rsrp, ref.rsrp);
  updateDelta('sinr', sinr, ref.sinr, 1);
  updateDelta('rsrq', rsrq, ref.rsrq);
  updateDelta('rssi', rssi, ref.rssi);
}

// Calculate delta relative to reference baseline (sticky: retains last non-zero change)
function updateDelta(name, currentVal, prevVal, decimals = 0) {
  const deltaElem = document.getElementById(`${name}-delta`);
  if (!deltaElem) return;

  if (currentVal === null || prevVal === null || isNaN(currentVal) || isNaN(prevVal)) {
    return;
  }

  const diff = currentVal - prevVal;
  if (diff !== 0) {
    const formattedDiff = diff > 0 ? `+${diff.toFixed(decimals)}` : `${diff.toFixed(decimals)}`;
    const arrow = diff > 0 ? '▲' : '▼';
    deltaElem.textContent = `${formattedDiff} ${arrow}`;
    deltaElem.className = `metric-delta ${diff > 0 ? 'delta-plus' : 'delta-minus'}`;
    deltaElem.style.display = 'inline-block';
  }
}

// Plays a soft locator beep whose frequency maps to RSRP
function playAcousticBeep(rsrp) {
  if (rsrp === null || isNaN(rsrp)) return;

  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    // Map RSRP (-120 to -50) to sound frequency (220 Hz to 880 Hz)
    const minRsrp = -120;
    const maxRsrp = -50;
    const clamped = Math.max(minRsrp, Math.min(maxRsrp, rsrp));
    const pct = (clamped - minRsrp) / (maxRsrp - minRsrp); // 0.0 to 1.0
    const frequency = 220 + (pct * pct * 660); // quadratic pitch scale for better resolution

    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);

    // Fade curve to prevent pops or clicks
    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.08, audioCtx.currentTime + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.15);

    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);
  } catch (e) {
    console.error('Audio tone error:', e);
  }
}

// Periodically read out the current signal metrics via Speech Synthesis
function speakSignal(rsrp, sinr) {
  if (!('speechSynthesis' in window)) return;
  if (rsrp === null || isNaN(rsrp)) return;

  const now = Date.now();
  if (now - lastTtsTime < 4000) return; // speak at most once every 4 seconds
  lastTtsTime = now;

  window.speechSynthesis.cancel(); // clear previous speech queue

  let text = `R S R P is ${rsrp} decibels`;
  if (sinr !== null && !isNaN(sinr)) {
    text += `, S I N R is ${sinr.toFixed(0)} decibels`;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.15; // slightly fast for responsive positioning feel
  utterance.volume = 0.75;
  window.speechSynthesis.speak(utterance);
}

// Analyzes the signal metrics to offer physical positioning suggestions
function evaluatePlacement(rsrp, sinr, rsrq) {
  const cardAdvice = document.getElementById('card-advice');
  const adviceContent = cardAdvice.querySelector('.advice-content');
  const adviceTitle = document.getElementById('advice-title');
  const adviceMessage = document.getElementById('advice-message');

  if (rsrp === null || isNaN(rsrp)) {
    cardAdvice.style.display = 'none';
    return;
  }

  cardAdvice.style.display = 'block';
  adviceContent.className = 'advice-content'; // reset severity styles

  const rsrpQual = getRSRPQuality(rsrp);
  const sinrQual = getSINRQuality(sinr);

  if (rsrpQual === 'Excellent' && sinrQual === 'Excellent') {
    adviceContent.classList.add('severity-excellent');
    adviceTitle.textContent = 'Perfect Placement!';
    adviceMessage.textContent = 'Both signal strength (RSRP) and quality (SINR) are optimal. Your router/antenna is in an ideal location.';
  } else if (rsrpQual === 'Poor') {
    adviceContent.classList.add('severity-poor');
    adviceTitle.textContent = 'Critically Weak Signal';
    adviceMessage.textContent = 'Signal strength (RSRP) is very weak. Elevate the router, move it near an exterior window facing open spaces, or point your outdoor antenna toward the cell tower.';
  } else if (rsrpQual === 'Excellent' && sinrQual === 'Poor') {
    adviceContent.classList.add('severity-poor');
    adviceTitle.textContent = 'High Interference / Noise';
    adviceMessage.textContent = 'Signal strength is excellent, but signal quality (SINR) is extremely low. Move the router away from large electronic devices, metallic surfaces, or low-E coated glass windows.';
  } else if (rsrpQual === 'Fair' && sinrQual === 'Excellent') {
    adviceContent.classList.add('severity-good');
    adviceTitle.textContent = 'Clean but Distant Signal';
    adviceMessage.textContent = 'Signal quality is excellent, indicating a clean line-of-sight, but power is low. Elevating the router or pointing directional antennas slightly higher can capture more signal.';
  } else if (sinrQual === 'Fair' || sinrQual === 'Poor') {
    adviceContent.classList.add('severity-fair');
    adviceTitle.textContent = 'Optimize Antenna Alignment';
    adviceMessage.textContent = 'Signal quality is the current bottleneck. Slowly rotate your router or antenna by 5-10 degrees at a time and wait 5 seconds to observe if the SINR value increases.';
  } else {
    adviceContent.classList.add('severity-good');
    adviceTitle.textContent = 'Stable Connection';
    adviceMessage.textContent = 'Your signal parameters are stable. Minor height adjustments or moving the router to a higher floor might help push the signal into the Excellent category.';
  }
}

// Handles cell tower handoffs by reading it via TTS and marking it on the live chart
function handleCellSwitch(timestamp, cellId, enbId) {
  console.log(`[Tower Switch] Tower changed. Timestamp: ${timestamp}, Cell ID: ${cellId}, eNodeB ID: ${enbId}`);

  // 1. Text-To-Speech announcement if active
  if (isSpeechActive && ('speechSynthesis' in window)) {
    window.speechSynthesis.cancel();
    // Spell out or speak last 4 characters of cell ID for clarity
    const speakCell = cellId.length > 4 ? cellId.slice(-4) : cellId;
    const utterance = new SpeechSynthesisUtterance(`Tower handoff. Now connected to cell ${speakCell.split('').join(' ')}.`);
    utterance.rate = 1.1;
    utterance.volume = 0.85;
    window.speechSynthesis.speak(utterance);
  }

  // 2. Draw a vertical line marker on the chart at the current timestamp
  if (signalChart && signalChart.options.plugins.annotation && signalChart.options.plugins.annotation.annotations) {
    const annotations = signalChart.options.plugins.annotation.annotations;
    const shortCell = cellId.length > 5 ? cellId.slice(-5) : cellId;
    
    annotations[`switch-${timestamp}`] = {
      type: 'line',
      scaleID: 'x',
      value: timestamp,
      borderColor: '#eab308', // amber color
      borderWidth: 2,
      borderDash: [5, 5],
      label: {
        display: true,
        content: `Handoff: ${shortCell}`,
        position: 'start',
        backgroundColor: 'rgba(234, 179, 8, 0.85)',
        color: '#0a0e1a',
        font: { size: 9, weight: 'bold', family: 'Outfit' },
        padding: { top: 4, bottom: 4, left: 6, right: 6 }
      }
    };
    
    signalChart.update();
  }
}
