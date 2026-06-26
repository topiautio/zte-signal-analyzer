# ZTE Router Signal Analyzer & Monitor

A premium, responsive web-based RF Signal Analyzer and Logger for ZTE LTE/5G routers (such as MF286, MF297D, MC801A, MC888, etc.). 

This application connects to your ZTE router's API, manages the session cookie (`zwsd`), automatically authenticates using challenge-response hashing, and visualizes the signal performance in real-time.

## Key Features

- 📊 **Real-time Signal Dashboard**: Displays key RF metrics: RSRP, SINR, RSRQ, and RSSI with color-coded signal quality indicators.
- 📈 **Live Scrolling Chart**: Renders a live timeline of RSRP and SINR to help you position your router or antennas.
- ⏱️ **Configurable Polling Rate**: Choose from multiple polling speeds (1s, 2s, 5s, 10s, 30s) or manual trigger.
- 💾 **Session Statistics & History Log**:
  - Automatically calculates and logs the **Best** and **Worst** values for RSRP, SINR, RSRQ, and RSSI during the session.
  - Keeps a scrolling history of all polls with timestamps.
  - Export session logs to a CSV file.
- 🔐 **Auto-Authenticating Proxy**: The backend server manages the authentication state. If the session cookie expires, it automatically fetches a new challenge token (`LD`), performs the dual-SHA256 handshake using your router's password, and resumes monitoring.
- ⚙️ **On-the-fly Config**: Change the Router IP and Admin Password directly from the web interface without restarting the server.

## Installation & Running

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Start the application**:
   ```bash
   npm start
   ```

3. **Open the web dashboard**:
   Go to **[http://localhost:3000](http://localhost:3000)** in your browser.

## Configuration Defaults

- **Router IP**: `192.168.1.1` (configurable in `.env` or settings panel)
- **Admin Password**: Configurable in `.env` or settings panel (used to sign in and generate the session cookies)

## Project Structure

- `server.js` - Express backend proxy which implements the ZTE challenge-response login and fetches signal metrics.
- `public/` - Web frontend assets.
  - `index.html` - Dashboard HTML skeleton.
  - `style.css` - Custom dark mode, glassmorphism design system.
  - `app.js` - Frontend polling logic, Chart.js visualization, and CSV logger.
