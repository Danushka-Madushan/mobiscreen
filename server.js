const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const stream = require('stream');
const dgram = require('dgram');
const { execSync } = require('child_process');
const { WebSocketServer } = require('ws');

// ============================================================================
// EDIT YOUR SCENES, VIDEO FILENAMES (inside ./media/), AND TELEPROMPTER SCRIPT
// ============================================================================
const SHOW_CONFIG = {
  title: 'Origins of Halloween',
  transitionMs: 1200,
  ambientAudio: 'ambient.mp3', // Optional: place in ./media/ or leave as ''
  ambientVolume: 0.55,
  introNote: 'Stand in position while screen is in BLACKOUT. Take a slow breath, start speaking your hook, then tap Scene 1.',
  scenes: [
    {
      file: 'scene1.mp4',
      title: 'Scene 1: Samhain Bonfires',
      script: `Two thousand years ago, long before plastic masks and candy wrappers, the ancient Celts marked October thirty-first as Samhain—the night summer died and the dark half of the year began.\n\nThey believed that on this single night, the boundary between the living world and the world of the dead dissolved into mist.`
    },
    {
      file: 'scene2.mp4',
      title: 'Scene 2: Spirits in the Mist',
      script: `Druids built towering sacred bonfires on hilltops to push back the creeping dark. Villagers extinguished their hearth fires and gathered in the smoke, wearing animal pelts and ash so wandering spirits would mistake them for one of their own.`
    },
    {
      file: 'scene3.mp4',
      title: 'Scene 3: Carved Turnip Lanterns',
      script: `Before pumpkins ever crossed the Atlantic, Irish folklore spoke of Stingy Jack—a trickster barred from both heaven and hell, doomed to roam the dark with a single burning coal inside a hollowed-out turnip.\n\nFamilies carved grotesque faces into turnips and set them on windowsills to ward him away.`
    },
    {
      file: 'scene4.mp4',
      title: 'Scene 4: All Hallows Eve',
      script: `Centuries later, as traditions merged into All Hallows' Evening—Halloween—the costumes, lanterns, and knocks in the dark survived.\n\nSo tonight, when the lights dim, remember why we wear disguises... just in case something in the dark is still looking back.`
    }
  ]
};

const PORT = 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MEDIA_DIR = path.join(__dirname, 'media');

if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4'
};

// Canonical server state (survives phone or Smartboard refreshes)
const state = {
  activeScene: -1,
  blackout: true,
  transitionMs: SHOW_CONFIG.transitionMs,
  audioPlaying: false,
  audioVolume: SHOW_CONFIG.ambientVolume,
  audioInitialized: false,
  seq: 0,
  boardConnected: false,
  boardArmed: false,
  preloadPercent: 0,
  preloadStatus: 'waiting',
  boardWarning: null
};

function buildManifest() {
  const scenes = SHOW_CONFIG.scenes.map((s, idx) => {
    const safeName = path.basename(s.file);
    const fullPath = path.join(MEDIA_DIR, safeName);
    const exists = fs.existsSync(fullPath);
    const size = exists ? fs.statSync(fullPath).size : 0;
    return { index: idx, file: safeName, title: s.title, script: s.script, exists, size };
  });

  let ambient = null;
  if (SHOW_CONFIG.ambientAudio) {
    const safeAudio = path.basename(SHOW_CONFIG.ambientAudio);
    const audioPath = path.join(MEDIA_DIR, safeAudio);
    const exists = fs.existsSync(audioPath);
    ambient = { file: safeAudio, exists, size: exists ? fs.statSync(audioPath).size : 0 };
  }

  return {
    title: SHOW_CONFIG.title,
    transitionMs: SHOW_CONFIG.transitionMs,
    introNote: SHOW_CONFIG.introNote,
    scenes,
    ambient
  };
}

function serveStaticHtml(res, filename) {
  const filePath = path.join(PUBLIC_DIR, filename);
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end(`Missing ${filename}`);
  }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate'
  });
  stream.pipeline(fs.createReadStream(filePath), res, () => {});
}

function serveMedia(req, res, rawName) {
  const safeName = path.basename(decodeURIComponent(rawName));
  const filePath = path.join(MEDIA_DIR, safeName);

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Media file not found');
  }

  const stat = fs.statSync(filePath);
  const ext = path.extname(safeName).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;

    if (Number.isNaN(start) || Number.isNaN(end) || start >= stat.size || end >= stat.size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });
    if (req.method === 'HEAD') return res.end();
    stream.pipeline(fs.createReadStream(filePath, { start, end }), res, () => {});
  } else {
    res.writeHead(200, {
      'Accept-Ranges': 'bytes',
      'Content-Length': stat.size,
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });
    if (req.method === 'HEAD') return res.end();
    stream.pipeline(fs.createReadStream(filePath), res, () => {});
  }
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/' || url.pathname === '/stage' || url.pathname === '/index.html') {
      return serveStaticHtml(res, 'index.html');
    }
    if (url.pathname === '/remote' || url.pathname === '/remote.html') {
      return serveStaticHtml(res, 'remote.html');
    }
    if (url.pathname === '/api/config') {
      const payload = JSON.stringify(buildManifest());
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      return res.end(payload);
    }
    if (url.pathname.startsWith('/media/')) {
      return serveMedia(req, res, url.pathname.slice(7));
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch (err) {
    console.error('[HTTP Error]', err.message);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

const wss = new WebSocketServer({ server });

function broadcastState() {
  const msg = JSON.stringify({ type: 'state', state });
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(msg);
    }
  }
}

function syncBoardPresence() {
  let anyStage = false;
  let anyArmed = false;
  for (const client of wss.clients) {
    if (client.readyState === 1 && client.role === 'stage') {
      anyStage = true;
      if (client.boardArmed) anyArmed = true;
    }
  }
  state.boardConnected = anyStage;
  state.boardArmed = anyArmed;
  if (!anyStage) {
    state.preloadStatus = 'waiting';
    state.preloadPercent = 0;
  }
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.role = 'unknown';
  ws.boardArmed = false;

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    ws.isAlive = true;
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (data.type === 'ping') {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    if (data.type === 'hello') {
      ws.role = data.role === 'stage' ? 'stage' : 'remote';
      const rawIp = ws._socket && ws._socket.remoteAddress ? ws._socket.remoteAddress : '';
      const clientIp = rawIp.replace(/^.*:/, '') || 'unknown';
      if (ws.role === 'stage') {
        console.log(`\x1b[32m[SMARTBOARD CONNECTED]\x1b[0m Stage display active from ${clientIp}`);
      } else {
        console.log(`\x1b[36m[REMOTE CONNECTED]\x1b[0m Teleprompter connected from ${clientIp}`);
      }
      syncBoardPresence();
      broadcastState();
      return;
    }

    if (data.type === 'board_status' && ws.role === 'stage') {
      ws.boardArmed = Boolean(data.armed);
      if (typeof data.preloadPercent === 'number') state.preloadPercent = data.preloadPercent;
      if (data.preloadStatus) state.preloadStatus = data.preloadStatus;
      state.boardWarning = data.warning || null;
      syncBoardPresence();
      broadcastState();
      return;
    }

    if (data.type === 'cue_scene') {
      const idx = Number(data.index);
      if (idx >= 0 && idx < SHOW_CONFIG.scenes.length) {
        state.activeScene = idx;
        state.blackout = false;
        if (!state.audioInitialized) {
          state.audioPlaying = true;
          state.audioInitialized = true;
        }
        state.seq += 1;
        broadcastState();
      }
      return;
    }

    if (data.type === 'toggle_blackout') {
      state.blackout = !state.blackout;
      state.seq += 1;
      broadcastState();
      return;
    }

    if (data.type === 'toggle_audio') {
      state.audioPlaying = !state.audioPlaying;
      state.audioInitialized = true;
      state.seq += 1;
      broadcastState();
      return;
    }

    if (data.type === 'reset_show') {
      state.activeScene = -1;
      state.blackout = true;
      state.audioPlaying = false;
      state.audioInitialized = false;
      state.seq += 1;
      broadcastState();
    }
  });

  ws.on('close', () => {
    syncBoardPresence();
    broadcastState();
  });

  ws.on('error', () => {});
});

// Detect dead Wi-Fi sockets within 10 seconds
setInterval(() => {
  let changed = false;
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      changed = true;
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
  if (changed) {
    syncBoardPresence();
    broadcastState();
  }
}, 5000);

function runShellCmd(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 1500 }) || '';
  } catch {
    return '';
  }
}

function getUdpLocalIp(dest, port = 53, timeoutMs = 250) {
  return new Promise((resolve) => {
    let resolved = false;
    let s;
    const finish = (ip) => {
      if (resolved) return;
      resolved = true;
      try { if (s) s.close(); } catch {}
      resolve(ip);
    };
    try {
      s = dgram.createSocket('udp4');
      const timer = setTimeout(() => finish(null), timeoutMs);
      s.on('error', () => { clearTimeout(timer); finish(null); });
      s.connect(port, dest, () => {
        clearTimeout(timer);
        try {
          const addr = s.address().address;
          if (addr && !addr.startsWith('127.')) finish(addr);
          else finish(null);
        } catch {
          finish(null);
        }
      });
    } catch {
      finish(null);
    }
  });
}

function parseIfconfig(text) {
  const results = [];
  const blocks = text.split(/(?=^[a-zA-Z0-9_-]+[:\s])/m);
  for (const block of blocks) {
    const headerMatch = block.match(/^([a-zA-Z0-9_-]+)/);
    if (!headerMatch) continue;
    const iface = headerMatch[1];
    if (iface.startsWith('lo')) continue;
    const ipMatch = block.match(/inet\s+(?:addr:)?(\d+\.\d+\.\d+\.\d+)/);
    if (ipMatch && !ipMatch[1].startsWith('127.')) {
      results.push({ iface, ip: ipMatch[1] });
    }
  }
  return results;
}

function parseIpAddr(text) {
  const results = [];
  const lines = text.split('\n');
  let currentIface = '';
  for (const line of lines) {
    const ifaceMatch = line.match(/^\d+:\s+([a-zA-Z0-9_-]+):/);
    if (ifaceMatch) currentIface = ifaceMatch[1];
    const ipMatch = line.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/);
    if (ipMatch && currentIface && !currentIface.startsWith('lo') && !ipMatch[1].startsWith('127.')) {
      results.push({ iface: currentIface, ip: ipMatch[1] });
    }
  }
  return results;
}

function parseIpRoute(text) {
  const results = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const defaultMatch = line.match(/default\s+via\s+(\d+\.\d+\.\d+\.\d+)\s+dev\s+([a-zA-Z0-9_-]+)/);
    if (defaultMatch) {
      results.push({ iface: defaultMatch[2], ip: defaultMatch[1], isGateway: true });
    }
    const srcMatch = line.match(/dev\s+([a-zA-Z0-9_-]+).+?src\s+(\d+\.\d+\.\d+\.\d+)/);
    if (srcMatch && !srcMatch[1].startsWith('lo') && !srcMatch[2].startsWith('127.')) {
      results.push({ iface: srcMatch[1], ip: srcMatch[2] });
    }
  }
  return results;
}

async function detectNetworkInfo() {
  const found = new Map();

  function addTarget(ip, iface, forcedType) {
    if (!ip || ip.startsWith('127.') || ip === '0.0.0.0') return;
    const lowerIface = (iface || '').toLowerCase();
    let type = forcedType;
    if (!type) {
      if (/ap|softap|swlan/i.test(lowerIface) || ip.startsWith('192.168.43.')) {
        type = 'hotspot';
      } else if (/wlan/i.test(lowerIface)) {
        type = 'wifi';
      } else if (/rndis|usb|bnep/i.test(lowerIface)) {
        type = 'tether';
      } else if (/rmnet|ccmni|pdp/i.test(lowerIface)) {
        type = 'cellular';
      } else {
        type = 'other';
      }
    }
    if (!found.has(ip) || (type === 'hotspot' && found.get(ip).type !== 'hotspot')) {
      found.set(ip, { ip, iface: iface || 'unknown', type });
    }
  }

  // Tier 1: os.networkInterfaces()
  try {
    const nets = os.networkInterfaces();
    for (const [name, list] of Object.entries(nets)) {
      for (const info of list || []) {
        if (info.family === 'IPv4' && !info.internal) {
          addTarget(info.address, name);
        }
      }
    }
  } catch {}

  // Tier 2: ifconfig (works on Android 11-14 non-root via ioctl)
  const ifconfigOut = runShellCmd('ifconfig 2>/dev/null || /system/bin/ifconfig 2>/dev/null');
  if (ifconfigOut) {
    for (const item of parseIfconfig(ifconfigOut)) {
      addTarget(item.ip, item.iface);
    }
  }

  // Tier 3: ip addr / route (works on older Android or rooted)
  const ipAddrOut = runShellCmd('ip -4 addr show 2>/dev/null || /system/bin/ip -4 addr show 2>/dev/null');
  if (ipAddrOut) {
    for (const item of parseIpAddr(ipAddrOut)) {
      addTarget(item.ip, item.iface);
    }
  }

  const ipRouteOut = runShellCmd('ip -4 route show 2>/dev/null || /system/bin/ip -4 route show 2>/dev/null');
  if (ipRouteOut) {
    for (const item of parseIpRoute(ipRouteOut)) {
      if (!item.isGateway) addTarget(item.ip, item.iface);
    }
  }

  // Tier 4: Android getprop
  const getpropWlan = runShellCmd('getprop dhcp.wlan0.ipaddress').trim();
  if (getpropWlan) addTarget(getpropWlan, 'wlan0', 'wifi');
  const getpropAp = runShellCmd('getprop dhcp.ap0.ipaddress').trim();
  if (getpropAp) addTarget(getpropAp, 'ap0', 'hotspot');

  // Tier 5: UDP route lookups (pure Node.js)
  const [udpInternet, udpHotspot] = await Promise.all([
    getUdpLocalIp('8.8.8.8'),
    getUdpLocalIp('192.168.43.254')
  ]);
  if (udpInternet) addTarget(udpInternet, 'udp_route');
  if (udpHotspot && udpHotspot.startsWith('192.168.43.')) addTarget(udpHotspot, 'ap0', 'hotspot');

  const targets = Array.from(found.values());
  const hotspotTarget = targets.find((t) => t.type === 'hotspot');
  const wifiTarget = targets.find((t) => t.type === 'wifi') || targets.find((t) => t.type === 'other');

  // Android standard Hotspot gateway IP is 192.168.43.1
  const hotspotGatewayIp = hotspotTarget ? hotspotTarget.ip : '192.168.43.1';
  const wifiIp = wifiTarget && wifiTarget.ip !== hotspotGatewayIp ? wifiTarget.ip : null;

  return {
    all: targets,
    hotspotGatewayIp,
    wifiIp,
    hasDetectedHotspot: Boolean(hotspotTarget)
  };
}

// Prevent unexpected exceptions from killing live show
process.on('uncaughtException', (err) => console.error('[Uncaught]', err.message));
process.on('unhandledRejection', (err) => console.error('[Unhandled]', err));

server.listen(PORT, '0.0.0.0', async () => {
  console.log('\n====================================================');
  console.log('            🎃 HALLOWEEN STAGE SERVER 🎃            ');
  console.log('====================================================');
  const manifest = buildManifest();
  for (const s of manifest.scenes) {
    const tag = s.exists ? `\x1b[32m[OK ${(s.size / 1048576).toFixed(1)} MB]\x1b[0m` : '\x1b[31m[MISSING!]\x1b[0m';
    console.log(`  ${tag} ${s.file} -> ${s.title}`);
  }
  if (manifest.ambient) {
    const tag = manifest.ambient.exists
      ? `\x1b[32m[OK ${(manifest.ambient.size / 1048576).toFixed(1)} MB]\x1b[0m`
      : '\x1b[33m[NOT FOUND - running silent]\x1b[0m';
    console.log(`  ${tag} ${manifest.ambient.file} (Ambient Audio)`);
  }

  const net = await detectNetworkInfo();

  console.log('\n----------------------------------------------------');
  console.log('1. ON THIS PHONE (Teleprompter & Show Controls):');
  console.log(`   👉 \x1b[36mhttp://127.0.0.1:${PORT}/remote\x1b[0m`);
  console.log('----------------------------------------------------');
  console.log('2. ON SMARTBOARD / TV SCREEN (Type in TV Browser):');

  if (net.hasDetectedHotspot) {
    console.log(`   ⭐ \x1b[1;33mHOST GATEWAY IP (Hotspot Mode):\x1b[0m`);
    console.log(`      👉 \x1b[1;32mhttp://${net.hotspotGatewayIp}:${PORT}/stage\x1b[0m`);
  } else {
    console.log(`   ⭐ \x1b[1;33mHOST GATEWAY IP (Android Hotspot):\x1b[0m`);
    console.log(`      👉 \x1b[1;32mhttp://${net.hotspotGatewayIp}:${PORT}/stage\x1b[0m`);
    console.log(`      \x1b[90m(Connect Smartboard to phone Hotspot & type URL above)\x1b[0m`);
  }

  if (net.wifiIp) {
    console.log(`\n   🌐 \x1b[1;36mLOCAL WI-FI (Shared Router Mode):\x1b[0m`);
    console.log(`      👉 \x1b[1;32mhttp://${net.wifiIp}:${PORT}/stage\x1b[0m`);
    console.log(`      \x1b[90m(If phone & Smartboard share the same Wi-Fi router)\x1b[0m`);
  }
  console.log('====================================================\n');
});
