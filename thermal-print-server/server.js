const express = require('express');
const cors = require('cors');
let SerialPort;

try { SerialPort = require('serialport').SerialPort; } catch { /* will be installed */ }

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

let currentPort = null;
let currentPortPath = null;

// ========== ESC/POS COMMANDS ==========
const ESC = '\x1B';
const GS = '\x1D';

function initPrinter() { return ESC + '@'; }
/** PC850 — byte 0x9F renders as peso (₱) on most Epson-compatible thermal printers. */
function selectCodePage850() { return ESC + 't' + '\x02'; }
function centerOn() { return ESC + 'a' + '\x01'; }
function centerOff() { return ESC + 'a' + '\x00'; }
function boldOn() { return ESC + 'E' + '\x01'; }
function boldOff() { return ESC + 'E' + '\x00'; }
function doubleOn() { return GS + '!' + '\x11'; }
function doubleOff() { return GS + '!' + '\x00'; }
function cutPaper() { return GS + 'V' + '\x01'; }
function lineFeed(n = 1) { return '\n'.repeat(n); }
function dashLine(n = 32) { return '-'.repeat(n) + '\n'; }

/** Unicode ₱ (UTF-8) prints as Chinese on GBK-default printers — use CP850 peso byte instead. */
const PESO_CP850 = '\x9F';
/** Set THERMAL_PESO=ascii to use plain "P" prefix if CP850 peso still looks wrong. */
const PESO_MODE = (process.env.THERMAL_PESO || 'cp850').toLowerCase();

function prepareThermalReceiptText(text) {
  const s = String(text);
  if (PESO_MODE === 'ascii') {
    return s.replace(/\u20B1/g, 'P');
  }
  return s.replace(/\u20B1/g, PESO_CP850);
}

function toLatin1Buffer(str) {
  return Buffer.from(str, 'latin1');
}

function buildReceiptPrintBuffer(text) {
  const body = prepareThermalReceiptText(text);
  const parts = [toLatin1Buffer(initPrinter())];
  if (PESO_MODE !== 'ascii') {
    parts.push(toLatin1Buffer(selectCodePage850()));
  }
  parts.push(toLatin1Buffer(body));
  parts.push(toLatin1Buffer(lineFeed(3)));
  parts.push(toLatin1Buffer(cutPaper()));
  return Buffer.concat(parts);
}

function sendCommand(cmd) {
  if (!currentPort || !currentPort.isOpen) return false;
  const buf = Buffer.isBuffer(cmd) ? cmd : toLatin1Buffer(cmd);
  currentPort.write(buf);
  currentPort.drain();
  return true;
}

// ========== API ENDPOINTS ==========

// Scan for available COM ports (Bluetooth SPP appears as COM port)
app.get('/scan', async (req, res) => {
  try {
    const { SerialPort: sp } = require('serialport');
    const ports = await sp.list();
    res.json(ports.map(p => ({ path: p.path, manufacturer: p.manufacturer || '', pnpId: p.pnpId || '', friendlyName: p.friendlyName || '' })));
  } catch (e) { res.json([]); }
});

// Connect to a specific COM port
app.post('/connect', async (req, res) => {
  try {
    const { portPath } = req.body;
    const { SerialPort: sp } = require('serialport');
    if (currentPort) {
      try { currentPort.close(); } catch {}
    }
    const port = new sp({ path: portPath, baudRate: 9600 });
    await new Promise((resolve, reject) => {
      port.on('open', resolve);
      port.on('error', reject);
      setTimeout(() => reject(new Error('Timeout')), 5000);
    });
    currentPort = port;
    currentPortPath = portPath;
    res.json({ connected: true, port: portPath });
  } catch (e) { res.json({ connected: false, error: e.message }); }
});

// Auto-connect: find the first available COM port and connect
app.post('/auto-connect', async (req, res) => {
  try {
    const { SerialPort: sp } = require('serialport');
    const ports = await sp.list();
    if (ports.length === 0) return res.json({ connected: false, error: 'No COM ports found' });

    if (currentPort) { try { currentPort.close(); } catch {} }

    // Try Bluetooth SPP ports first, then fall back to all COM ports
    const btPorts = ports.filter(p => p.friendlyName?.toLowerCase().includes('bluetooth'));
    const tryPorts = [...btPorts, ...ports];
    for (const p of tryPorts) {
      try {
        const port = new sp({ path: p.path, baudRate: 9600 });
        await new Promise((resolve, reject) => {
          port.on('open', resolve);
          port.on('error', reject);
          setTimeout(() => reject(new Error('Timeout')), 3000);
        });
        currentPort = port;
        currentPortPath = p.path;
        // Send init command to test
        port.write(initPrinter());
        port.drain();
        return res.json({ connected: true, port: p.path, manufacturer: p.manufacturer, friendlyName: p.friendlyName });
      } catch { /* try next port */ }
    }
    res.json({ connected: false, error: 'No responsive printer found on any COM port' });
  } catch (e) { res.json({ connected: false, error: e.message }); }
});

// Get current status
app.get('/status', (req, res) => {
  res.json({
    connected: currentPort && currentPort.isOpen,
    port: currentPortPath,
  });
});

// Disconnect
app.post('/disconnect', (req, res) => {
  if (currentPort) {
    try { currentPort.close(); } catch {}
    currentPort = null;
    currentPortPath = null;
  }
  res.json({ connected: false });
});

// Print receipt
app.post('/print', (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'No text provided' });
  if (!currentPort || !currentPort.isOpen) return res.status(503).json({ error: 'Printer not connected' });

  try {
    const buf = buildReceiptPrintBuffer(text);
    if (sendCommand(buf)) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'Failed to send to printer' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Test print
app.post('/test-print', (req, res) => {
  if (!currentPort || !currentPort.isOpen) return res.status(503).json({ error: 'Printer not connected' });

  try {
    let cmd = '';
    cmd += initPrinter();
    if (PESO_MODE !== 'ascii') cmd += selectCodePage850();
    cmd += centerOn() + doubleOn() + boldOn() + 'D METRAN TRADING\n' + boldOff() + doubleOff() + centerOff();
    cmd += centerOn() + 'General Merchandise\n' + centerOff();
    cmd += dashLine();
    cmd += centerOn() + 'TEST PRINT\n' + centerOff();
    cmd += 'Date: ' + new Date().toLocaleString() + '\n';
    cmd += 'Printer: ' + (currentPortPath || 'Unknown') + '\n';
    cmd += 'Peso test: ' + prepareThermalReceiptText('\u20B1123.45') + '\n';
    cmd += dashLine();
    cmd += centerOn() + 'PRINTER WORKING!\n' + centerOff();
    cmd += lineFeed(3);
    cmd += cutPaper();

    sendCommand(cmd);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = 9999;
app.listen(PORT, () => {
  console.log(`Thermal Print Server running on http://localhost:${PORT}`);
  console.log(`Peso mode: ${PESO_MODE} (set THERMAL_PESO=ascii if symbol still wrong)`);
  console.log('Endpoints:');
  console.log('  GET  /scan          - List available COM ports');
  console.log('  POST /auto-connect  - Auto-connect to first printer');
  console.log('  POST /connect       - Connect to specific port {portPath}');
  console.log('  GET  /status        - Check connection status');
  console.log('  POST /disconnect    - Disconnect printer');
  console.log('  POST /print         - Print receipt {text}');
  console.log('  POST /test-print    - Print test page');
});
