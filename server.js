require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration state
let routerIp = process.env.ROUTER_IP || '192.168.1.1';
let routerPassword = process.env.ROUTER_PASSWORD || '';
let cachedCookie = '';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to hash string to uppercase SHA256 hex
function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex').toUpperCase();
}

// Perform login handshake with ZTE router
async function loginToRouter() {
  const baseUrl = `http://${routerIp}`;
  
  console.log(`[Router Proxy] Attempting login to ${baseUrl}...`);
  
  // Step 1: Get the LD token (challenge)
  const ldUrl = `${baseUrl}/goform/goform_get_cmd_process?isTest=false&cmd=LD&multi_data=1&_=${Date.now()}`;
  const ldResponse = await fetch(ldUrl, {
    method: 'GET',
    headers: {
      'Referer': `${baseUrl}/index.html`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json, text/javascript, */*; q=0.01'
    }
  });

  let ldToken = '';
  if (ldResponse.ok) {
    try {
      const ldData = await ldResponse.json();
      ldToken = ldData.LD || '';
    } catch (e) {
      console.warn('[Router Proxy] Warning: Could not parse LD token response as JSON. Falling back to default authentication.');
    }
  }

  let finalHash = '';
  if (ldToken) {
    console.log(`[Router Proxy] Retrieved LD challenge token: ${ldToken}`);
    // Challenge-response hashing: SHA256(SHA256(password) + LD)
    const prefixHash = sha256(routerPassword);
    finalHash = sha256(prefixHash + ldToken);
    console.log(`[Router Proxy] Using challenge-response hash protocol.`);
  } else {
    console.log(`[Router Proxy] Challenge token (LD) is empty/missing. Falling back to SHA256(Base64(password)) protocol.`);
    // Base64 + SHA256 protocol (e.g. MF286D Elisa)
    const base64Password = Buffer.from(routerPassword).toString('base64');
    finalHash = sha256(base64Password);
  }

  console.log(`[Router Proxy] Sending authentication request...`);

  // Step 3: POST login command
  const loginUrl = `${baseUrl}/goform/goform_set_cmd_process`;
  const bodyParams = new URLSearchParams();
  bodyParams.append('isTest', 'false');
  bodyParams.append('goformId', 'LOGIN');
  bodyParams.append('password', finalHash);

  const loginResponse = await fetch(loginUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': `${baseUrl}/index.html`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    body: bodyParams.toString()
  });

  if (!loginResponse.ok) {
    throw new Error(`Login POST request failed: HTTP ${loginResponse.status}`);
  }

  const loginResult = await loginResponse.json();
  console.log(`[Router Proxy] Login result payload:`, loginResult);

  if (loginResult.result !== '0' && loginResult.result !== 'success') {
    throw new Error(`Login rejected by router: result code ${loginResult.result}`);
  }

  // Extract the zwsd cookie from Set-Cookie headers
  const setCookieHeaders = loginResponse.headers.getSetCookie();
  let zwsdCookie = '';
  
  if (setCookieHeaders && setCookieHeaders.length > 0) {
    for (const cookieStr of setCookieHeaders) {
      if (cookieStr.includes('zwsd=')) {
        // Extract zwsd="value" or zwsd=value
        const match = cookieStr.match(/zwsd=([^;]+)/);
        if (match) {
          zwsdCookie = `zwsd=${match[1]}`;
          break;
        }
      }
    }
  }

  if (!zwsdCookie) {
    // Fallback: Check if we can find any other indicator, or search in all headers
    console.warn('[Router Proxy] Warning: Set-Cookie header did not explicitly contain zwsd. Attempting to parse manually.');
    const rawCookie = loginResponse.headers.get('set-cookie');
    if (rawCookie && rawCookie.includes('zwsd=')) {
      const match = rawCookie.match(/zwsd=([^;]+)/);
      if (match) {
        zwsdCookie = `zwsd=${match[1]}`;
      }
    }
  }

  if (!zwsdCookie) {
    console.log('[Router Proxy] Could not extract new zwsd cookie from Set-Cookie header. Using session association.');
  } else {
    cachedCookie = zwsdCookie;
    console.log(`[Router Proxy] Successfully authenticated. Cached Cookie: ${cachedCookie}`);
  }

  return true;
}

// Fetch signal data from the router, with auto-login on failure
async function fetchSignalData(retryOnAuthError = true) {
  const baseUrl = `http://${routerIp}`;
  const signalCmds = [
    'network_type', 'rssi', 'rscp', 'lte_rsrp', 'wan_lte_ca',
    'lte_ca_pcell_band', 'lte_ca_pcell_bandwidth', 'lte_ca_scell_band',
    'lte_ca_scell_bandwidth', 'lte_ca_pcell_arfcn', 'lte_ca_scell_arfcn',
    'Z_SINR', 'Z_CELL_ID', 'Z_eNB_id', 'Z_rsrq', 'lte_ca_scell_info',
    'wan_ipaddr', 'ipv6_wan_ipaddr', 'static_wan_ipaddr',
    'opms_wan_mode', 'opms_wan_auto_mode', 'ppp_status'
  ];

  const queryUrl = `${baseUrl}/goform/goform_get_cmd_process?isTest=false&cmd=${signalCmds.join('%2C')}&multi_data=1&_=${Date.now()}`;
  
  const headers = {
    'Referer': `${baseUrl}/index.html`,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json, text/javascript, */*; q=0.01'
  };

  if (cachedCookie) {
    headers['Cookie'] = cachedCookie;
  }

  console.log(`[Router Proxy] Fetching signal data from ${baseUrl}...`);
  const response = await fetch(queryUrl, {
    method: 'GET',
    headers: headers
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch signal data: HTTP ${response.status}`);
  }

  const data = await response.json();
  
  // Check if response indicates we are not logged in
  const isNotLoggedIn = 
    data.result === 'not_login' || 
    data.result === 'not_login_user' || 
    data.result === '1' || 
    data.result === '3' ||
    (data.lte_rsrp === '' && data.rssi === '' && data.Z_CELL_ID === '');

  if (isNotLoggedIn) {
    if (retryOnAuthError) {
      console.log(`[Router Proxy] Session expired, invalid, or returned empty metrics. Re-authenticating...`);
      await loginToRouter();
      // Retry once after logging in
      return fetchSignalData(false);
    } else {
      throw new Error(`Authentication required (result: ${data.result || 'empty_metrics'})`);
    }
  }

  return data;
}

// API endpoint to fetch signal details
app.get('/api/signal', async (req, res) => {
  try {
    const data = await fetchSignalData();
    res.json({
      success: true,
      data: data
    });
  } catch (error) {
    console.error(`[API Error]`, error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API endpoint to update configuration (IP / Password)
app.post('/api/config', async (req, res) => {
  const { ip, password } = req.body;
  if (!ip) {
    return res.status(400).json({ success: false, error: 'Router IP is required' });
  }

  routerIp = ip;
  if (password !== undefined && password !== '') {
    routerPassword = password;
  }
  // Clear cached cookie to force new login handshake
  cachedCookie = '';

  console.log(`[Router Proxy] Config updated. IP: ${routerIp}. Cached session cleared.`);
  
  try {
    // Attempt login with new config immediately to verify
    await loginToRouter();
    res.json({ success: true, message: 'Configuration updated and verified successfully.' });
  } catch (error) {
    res.json({ 
      success: true, 
      warning: `Config updated, but verification login failed: ${error.message}. The app will retry on the next poll.` 
    });
  }
});

// API endpoint to manual login
app.post('/api/login', async (req, res) => {
  try {
    await loginToRouter();
    res.json({ success: true, message: 'Logged in successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// API endpoint to get current config
app.get('/api/config', (req, res) => {
  res.json({
    success: true,
    ip: routerIp,
    hasPassword: routerPassword.length > 0
  });
});

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`   ZTE Router Signal Analyzer Backend Running     `);
  console.log(`   URL: http://localhost:${PORT}                   `);
  console.log(`   Router IP: ${routerIp}                         `);
  console.log(`==================================================`);
});
