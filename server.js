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
  transitionMs: 1000,
  ambientAudio: 'ambient.mp3', // In ./media/
  ambientVolume: 0.2,
  introNote: 'Stage is in STANDBY LOOP. When ready to start, tap SCREEN GO BLACK to fade out. Take a slow breath, start speaking, then cue Scene 1.',
  extras: {
    loop: 'loop.mp4',
    fadeOut: 'fade_out.mp4',
    fadeIn: 'fade_in.mp4'
  },
  scenes: [
    {
      file: '01.mp4',
      title: 'Scene 1: Samhain Bonfires',
      script: `Two thousand years ago, long before plastic masks and candy wrappers, the ancient Celts marked October thirty-first as Samhain—the night summer died and the dark half of the year began.\n\nThey believed that on this single night, the boundary between the living world and the world of the dead dissolved into mist.`,
      transitionToNext: '01_02_T.mp4'
    },
    {
      file: '02.mp4',
      title: 'Scene 2: Spirits in the Mist',
      script: `Druids built towering sacred bonfires on hilltops to push back the creeping dark. Villagers extinguished their hearth fires and gathered in the smoke, wearing animal pelts and ash so wandering spirits would mistake them for one of their own.`,
      transitionToNext: '02_03_T.mp4'
    },
    {
      file: '03.mp4',
      title: 'Scene 3: Carved Turnip Lanterns',
      script: `Before pumpkins ever crossed the Atlantic, Irish folklore spoke of Stingy Jack—a trickster barred from both heaven and hell, doomed to roam the dark with a single burning coal inside a hollowed-out turnip.\n\nFamilies carved grotesque faces into turnips and set them on windowsills to ward him away.`,
      transitionToNext: '03_04_T.mp4'
    },
    {
      file: '04.mp4',
      title: 'Scene 4: The Guisers & Mummers',
      script: `In the medieval shadows, young villagers took to the dark lanes in disguise. Disguised as spirits, they went door to door performing songs and verses in exchange for food and ale—promising fortune to generous hearths and misfortune to the greedy.`,
      transitionToNext: '04_05_T.mp4'
    },
    {
      file: '05.mp4',
      title: 'Scene 5: Soul Cakes & The Dead',
      script: `With the rise of All Hallows' Eve, Christian traditions intertwined with ancient lore. Bakers baked spiced soul cakes marked with crosses. For every sweet cake eaten, a prayer was whispered to release a trapped soul from the fires of purgatory.`,
      transitionToNext: '05_06_T.mp4'
    },
    {
      file: '06.mp4',
      title: 'Scene 6: The Witching Hour',
      script: `Midnight approaches. In ancient villages, mirrors were covered with black cloth and knives turned blade-downward. Folk believed that gazing into water at the stroke of midnight would reveal a future spouse—or a shroud of death.`,
      transitionToNext: '06_07_T.mp4'
    },
    {
      file: '07.mp4',
      title: 'Scene 7: Crossing the Atlantic',
      script: `When waves of Irish and Scottish immigrants crossed the Atlantic in the nineteenth century, their ancient lore crossed with them. In the New World, they encountered native American pumpkins—larger, softer, and glowing like celestial lanterns in the autumn dusk.`,
      transitionToNext: '07_08_T.mp4'
    },
    {
      file: '08.mp4',
      title: 'Scene 8: The Golden Harvest',
      script: `Across the prairie and woodlands, harvest festivals gave birth to the modern Jack-o'-lantern. Carved with glowing triangular eyes and jagged grins, they lit every doorstep from Boston to the frontier.`,
      transitionToNext: '08_09_T.mp4'
    },
    {
      file: '09.mp4',
      title: 'Scene 9: The Modern Masquerade',
      script: `By the twentieth century, trick-or-treating became a communal celebration. Millions of children donned costumes of ghouls, heroes, and wanderers, stepping into the night to tame the darkness with laughter and sweet treats.`,
      transitionToNext: '09_10_T.mp4'
    },
    {
      file: '10.mp4',
      title: 'Scene 10: All Hallows Eve (Finale)',
      script: `Centuries have passed, continents have shifted, but the bonfire still smolders within us all. Tonight, when the autumn wind stirs the dry leaves and lights flicker on the porch, remember why we wear disguises...\n\nJust in case something in the dark is still looking back.`,
      transitionToNext: null
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
  stageMode: 'standby_loop', // 'standby_loop' | 'transitioning_black' | 'blackout' | 'scene' | 'scene_transition' | 'transitioning_home'
  activeScene: -1,
  targetScene: -1,
  transitionFile: null,
  blackout: false,
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

let transitionSafetyTimer = null;
function clearSafetyTimer() {
  if (transitionSafetyTimer) {
    clearTimeout(transitionSafetyTimer);
    transitionSafetyTimer = null;
  }
}

function getFileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function buildManifest() {
  const scenes = SHOW_CONFIG.scenes.map((s, idx) => {
    const safeName = path.basename(s.file);
    const fullPath = path.join(MEDIA_DIR, safeName);
    const exists = fs.existsSync(fullPath);
    const size = exists ? getFileSize(fullPath) : 0;

    let transition = null;
    if (s.transitionToNext) {
      const transName = path.basename(s.transitionToNext);
      const transPath = path.join(MEDIA_DIR, transName);
      const transExists = fs.existsSync(transPath);
      transition = {
        file: transName,
        exists: transExists,
        size: transExists ? getFileSize(transPath) : 0
      };
    }

    return {
      index: idx,
      file: safeName,
      title: s.title,
      script: s.script,
      transitionToNext: s.transitionToNext || null,
      transition,
      exists,
      size
    };
  });

  const extras = {};
  for (const [key, filename] of Object.entries(SHOW_CONFIG.extras || {})) {
    const safe = path.basename(filename);
    const full = path.join(MEDIA_DIR, safe);
    const exists = fs.existsSync(full);
    extras[key] = {
      file: safe,
      exists,
      size: exists ? getFileSize(full) : 0
    };
  }

  let ambient = null;
  if (SHOW_CONFIG.ambientAudio) {
    const safeAudio = path.basename(SHOW_CONFIG.ambientAudio);
    const audioPath = path.join(MEDIA_DIR, safeAudio);
    const exists = fs.existsSync(audioPath);
    ambient = { file: safeAudio, exists, size: exists ? getFileSize(audioPath) : 0 };
  }

  return {
    title: SHOW_CONFIG.title,
    transitionMs: SHOW_CONFIG.transitionMs,
    introNote: SHOW_CONFIG.introNote,
    scenes,
    extras,
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
    const raw = range.replace(/bytes=/, '').trim();
    const parts = raw.split('-');
    let start, end;

    if (parts[0] === '') {
      // Suffix byte range: bytes=-N (requesting last N bytes of file)
      const suffix = parseInt(parts[1], 10);
      if (Number.isNaN(suffix) || suffix <= 0) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        return res.end();
      }
      start = Math.max(0, stat.size - suffix);
      end = stat.size - 1;
    } else {
      start = parseInt(parts[0], 10);
      end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    }

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
      if (ws.boardArmed && state.activeScene < 0 && state.stageMode !== 'blackout' && state.stageMode !== 'transitioning_black') {
        state.stageMode = 'standby_loop';
        state.blackout = false;
      }
      syncBoardPresence();
      broadcastState();
      return;
    }

    if (data.type === 'cue_scene') {
      const idx = Number(data.index);
      if (idx >= 0 && idx < SHOW_CONFIG.scenes.length) {
        if (state.stageMode === 'scene_transition' && state.targetScene === idx) {
          return; // Ignore rapid duplicate cue for the scene already transitioning
        }
        clearSafetyTimer();
        const prevScene = state.activeScene;
        const currentMode = state.stageMode;

        // Check if a transition clip exists from prevScene to target idx
        let transitionFile = null;
        if (currentMode === 'scene' && prevScene >= 0 && SHOW_CONFIG.scenes[prevScene]) {
          const cfg = SHOW_CONFIG.scenes[prevScene];
          if (cfg.transitionToNext && idx === prevScene + 1) {
            transitionFile = cfg.transitionToNext;
          }
        }

        state.targetScene = idx;
        if (transitionFile) {
          state.stageMode = 'scene_transition';
          state.transitionFile = transitionFile;
          state.blackout = false;
          // Fallback watchdog if client drops or network hangs
          transitionSafetyTimer = setTimeout(() => {
            if (state.stageMode === 'scene_transition' && state.targetScene === idx) {
              state.stageMode = 'scene';
              state.activeScene = idx;
              state.targetScene = -1;
              state.transitionFile = null;
              state.seq += 1;
              broadcastState();
            }
          }, 15000);
        } else {
          state.stageMode = 'scene';
          state.activeScene = idx;
          state.transitionFile = null;
          state.blackout = false;
        }

        if (!state.audioInitialized) {
          state.audioPlaying = true;
          state.audioInitialized = true;
        }
        state.seq += 1;
        broadcastState();
      }
      return;
    }

    if (data.type === 'scene_transition_done') {
      clearSafetyTimer();
      state.stageMode = 'scene';
      state.activeScene = Number(data.index);
      state.targetScene = -1;
      state.transitionFile = null;
      state.blackout = false;
      state.seq += 1;
      broadcastState();
      return;
    }

    if (data.type === 'screen_go_black') {
      clearSafetyTimer();
      if (state.stageMode === 'standby_loop') {
        state.stageMode = 'transitioning_black';
        state.blackout = false; // fade_out.mp4 starts playing
        transitionSafetyTimer = setTimeout(() => {
          if (state.stageMode === 'transitioning_black') {
            state.stageMode = 'blackout';
            state.blackout = true;
            state.activeScene = -1;
            state.targetScene = -1;
            state.transitionFile = null;
            state.seq += 1;
            broadcastState();
          }
        }, 15000);
      } else {
        // Direct CSS fade to black (e.g. from Scene 10 or during any scene)
        state.stageMode = 'blackout';
        state.blackout = true;
      }
      state.seq += 1;
      broadcastState();
      return;
    }

    if (data.type === 'fade_out_done') {
      clearSafetyTimer();
      state.stageMode = 'blackout';
      state.blackout = true;
      state.activeScene = -1;
      state.targetScene = -1;
      state.transitionFile = null;
      state.seq += 1;
      broadcastState();
      return;
    }

    if (data.type === 'fade_home_in') {
      clearSafetyTimer();
      state.stageMode = 'transitioning_home';
      state.blackout = false; // fade_in.mp4 starts playing
      transitionSafetyTimer = setTimeout(() => {
        if (state.stageMode === 'transitioning_home') {
          state.stageMode = 'standby_loop';
          state.blackout = false;
          state.activeScene = -1;
          state.targetScene = -1;
          state.transitionFile = null;
          state.seq += 1;
          broadcastState();
        }
      }, 15000);
      state.seq += 1;
      broadcastState();
      return;
    }

    if (data.type === 'fade_in_done') {
      clearSafetyTimer();
      state.stageMode = 'standby_loop';
      state.blackout = false;
      state.activeScene = -1;
      state.targetScene = -1;
      state.transitionFile = null;
      state.seq += 1;
      broadcastState();
      return;
    }

    if (data.type === 'toggle_blackout') {
      clearSafetyTimer();
      if (state.stageMode === 'standby_loop') {
        state.stageMode = 'transitioning_black';
        state.blackout = false;
      } else if (state.blackout) {
        state.blackout = false;
        state.stageMode = state.activeScene >= 0 ? 'scene' : 'standby_loop';
      } else {
        state.stageMode = 'blackout';
        state.blackout = true;
      }
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
      clearSafetyTimer();
      state.stageMode = 'standby_loop';
      state.activeScene = -1;
      state.targetScene = -1;
      state.transitionFile = null;
      state.blackout = false;
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
  console.log('\n[SCENES & TRANSITIONS]');
  for (const s of manifest.scenes) {
    const tag = s.exists ? `\x1b[32m[OK ${(s.size / 1048576).toFixed(1)} MB]\x1b[0m` : '\x1b[31m[MISSING!]\x1b[0m';
    const transTag = s.transition
      ? (s.transition.exists ? ` + \x1b[36m[T: ${(s.transition.size / 1048576).toFixed(1)} MB]\x1b[0m` : ' + \x1b[31m[T MISSING]\x1b[0m')
      : '';
    console.log(`  ${tag} ${s.file}${transTag} -> ${s.title}`);
  }
  if (manifest.extras) {
    console.log('\n[STANDBY & FADE ASSETS]');
    for (const [k, v] of Object.entries(manifest.extras)) {
      const tag = v.exists ? `\x1b[32m[OK ${(v.size / 1048576).toFixed(1)} MB]\x1b[0m` : '\x1b[31m[MISSING!]\x1b[0m';
      console.log(`  ${tag} ${v.file} (${k})`);
    }
  }
  if (manifest.ambient) {
    const tag = manifest.ambient.exists
      ? `\x1b[32m[OK ${(manifest.ambient.size / 1048576).toFixed(1)} MB]\x1b[0m`
      : '\x1b[33m[NOT FOUND - running silent]\x1b[0m';
    console.log(`\n  ${tag} ${manifest.ambient.file} (Ambient Audio)`);
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
