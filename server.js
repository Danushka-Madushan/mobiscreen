const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const stream = require('stream');
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
    if (url.pathname === '/' || url.pathname === '/stage') {
      return serveStaticHtml(res, 'stage.html');
    }
    if (url.pathname === '/remote') {
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

function detectLocalIPs() {
  const ips = new Set();
  try {
    const nets = os.networkInterfaces();
    for (const list of Object.values(nets)) {
      for (const info of list || []) {
        if (info.family === 'IPv4' && !info.internal) ips.add(info.address);
      }
    }
  } catch {
    // Android 14+ SELinux may block uv_interface_addresses; fallback to shell
    try {
      const out = execSync('ip -4 addr show 2>/dev/null || true', { encoding: 'utf8' });
      const matches = out.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/g) || [];
      for (const m of matches) {
        const ip = m.replace(/inet\s+/, '');
        if (!ip.startsWith('127.')) ips.add(ip);
      }
    } catch {}
  }
  return [...ips];
}

// Prevent unexpected exceptions from killing live show
process.on('uncaughtException', (err) => console.error('[Uncaught]', err.message));
process.on('unhandledRejection', (err) => console.error('[Unhandled]', err));

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n=== HALLOWEEN STAGE SERVER READY ===');
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

  const ips = detectLocalIPs();
  console.log('\n1. Open on YOUR PHONE (Localhost unlocks Screen WakeLock):');
  console.log(`   http://127.0.0.1:${PORT}/remote`);
  console.log('\n2. Open on SMARTBOARD Browser:');
  if (ips.length > 0) {
    ips.forEach((ip) => console.log(`   http://${ip}:${PORT}/stage`));
  } else {
    console.log(`   http://<YOUR-HOTSPOT-GATEWAY-IP>:${PORT}/stage`);
    console.log('   (Check Smartboard Wi-Fi details -> "Gateway/Router" for exact IP)');
  }
  console.log('====================================\n');
});
