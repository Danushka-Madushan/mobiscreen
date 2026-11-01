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
  introNote: 'Stage is in STANDBY LOOP. When ready to start, tap SCREEN GO BLACK to fade out to blackout, read the Intro story, then cue Scene 1.',
  intoBlackout: {
    title: 'Intro: Into Blackout',
    note: 'Told before Scene 1. Tap SCREEN GO BLACK to fade out the screen, then speak into the dark.',
    script: `ඔයාලට අද දවස ගැන අමුත්තක් දැනිල නැතිද..\n\nමනුස්සයො විසින් නිර්මාණය කරපු අනිත් හැම හොලිඩේ එකකදිම අපි මොනම හරි දෙයක් පිලිගන්නව.. ඒ දවස අපි අලෝකමත් කරන්න හදනව.. අපි අපිව අඳුන්වල දෙන්න හදනව..\n\nබට්, හැලෝවීන් ඉස් දි ඔන්ලි නයිට්.. අපි හැමදේම අනිත් පැත්තට කරන...\nඅපි වෙනත් මුහුණතකින් එලියට එනව... වෙනත් නමකින් හඳුන්වගන්නව.. අලෝකමත් රාත්‍රීන් අඳුරෙන් වහල දානව..\nමේ හැමදේම විනෝදෙට බිහිවුනා වෙන්න බැ.. අන්ලෙස්ස්.. ඒ දවස ඇතුලත අපිව අඳුරගන්නවට අපි හුඟක් අකමැතිනම් විතරක්...\n\nඉතින් මේ රාත්‍රිය ගැන දැනගන්න අපිට පොඩ්ඩක් අතීතයට යන්න වෙනව.. ටිකක් නෙමේ.. හුඟක් ඈත අතීතයට..\nසෝ බකල් අප් පීපල්.. යූ ආර් අබවුට් ටු විට්නස් හිස්ටරි...`
  },
  postBlackout: {
    title: 'Outro: Post Blackout',
    note: 'Told after Scene 10 in blackout. Speak lines below, cue Fade Home In, then deliver the final line.',
    scriptPart1: `අන්න ඒ විදිහට ඒ අතීත කතාව වර්තමානයටම ඇදිල ආව.. කැන්ඩ්ල්ස් ලයිට් බල්බ්ස් උනා.. ඒ උනාට ඒ දවස අපි අතරින් ගියේ නෑ.. මොකද අදටත් මේ 31 වෙනි රාත්‍රියට.. මලවුන්ගෙ ලෝකයට දොරවල් ඇරෙනව..\n\nමතකතියාගන්න.. අද දවස තියෙන්නෙ ඔයාට බේරිල ඉන්න...\n\nසෝ බ්‍රදර්ස් ඇන්ඩ් සිස්ටර්ස්..`,
    cueMarker: '-FadeIN-',
    scriptPart2: `වෙල්කම් ටු හැලෝවීන්...`
  },
  extras: {
    loop: 'loop.mp4',
    fadeOut: 'fade_out.mp4',
    fadeIn: 'fade_in.mp4'
  },
  scenes: [
    {
      file: '01.mp4',
      title: 'Scene 1: Ancient Ireland',
      script: `මේ හැමදේම ඇරඹුනේ මීට අවුරුදු දෙදාහකට කලින් අයර්ලන්තයේ එක්තරා පෙදෙසක.. මිනිස්සු සාමාන්‍ය ජීවිත ගතකලා.. ඒත් එක රාත්‍රියක් තිබුන එයාල හැමදාම බයෙන් උන්න..`,
      transitionToNext: '01_02_T.mp4'
    },
    {
      file: '02.mp4',
      title: 'Scene 2: Samhain (Summer\'s End)',
      script: `ඒ කාලෙ අද වගේ කැලැන්ඩර්ස් තිබුනෙ නෑ.. ඒ වෙනුවට ඔක් 31 වෙනිදට එයාලගෙ ලඟ තිබුන වෙනම නමක්.. "සම්හෙයින්.." එහෙම නැත්නම් සමර්ස් එන්ඩ්...`,
      transitionToNext: '02_03_T.mp4'
    },
    {
      file: '03.mp4',
      title: 'Scene 3: The Dying Sun',
      script: `ඒ දවස උදාවෙනකොට.. අහසෙන් ඉර හැංගෙන්න ගන්නව, පරිසරය සීතලට බරවෙනව... වගාවන් මියයන්න ගන්නව..`,
      transitionToNext: '03_04_T.mp4'
    },
    {
      file: '04.mp4',
      title: 'Scene 4: The Nameless Mist',
      script: `එයාල විශ්වාසකලා මේ හැමදේම සිද්දවෙන්නෙ මනුශ්‍ය ලෝකයත් මලවුන්ගේ ලෝකයත් අතර තියෙන බැම්ම හීනවෙලා යන නිසා කියල.. ඉර බැහැල ගියාම, ඔයා තව දුරටත් තනියම නෙමේ කියල.. ඉර බැහැල ගියාම ඒ ගම් ඝන මීදුමෙන් වැහිල යනව, ශබ්ද වලට විතරයි දුර පෙනුනෙ.. එයාල විශ්වාස කලා ඒ අඳුරෙ තමන්ගෙ ඇත්ත නම් කිවුවොත්.. ඒ නොපෙනෙන අමනුශ්‍යයන් එයාලව හොයන් ඒවි කියල..`,
      transitionToNext: '04_05_T.mp4'
    },
    {
      file: '05.mp4',
      title: 'Scene 5: The First Costumes',
      script: `ඉතින් මේ රැය ගතකරන්න ඒ කාලෙ මිනිස්සු  අසාමාන්‍ය දේවල් කරන්න ගත්ත.. වෙනත් සතුන්ගෙ හම් ඇටසැකිලි අලු වලින් එයාල එයාලගෙම ඇඳුම් නිර්මාණය කලා.. මෙතන තිබුනෙ හරි සරල නීතියක්.. තමනුත් මලවුන්ගේ කොටසක් වගේ හිටියොත් කරදරයක් නොවේවි කියන එක.. මේ තමයි හැලෝවින් කොස්ටියුම්ස් වල මූලාරම්බය...`,
      transitionToNext: '05_06_T.mp4'
    },
    {
      file: '06.mp4',
      title: 'Scene 6: Acting Dead',
      script: `මේ හැමදේම එයාල කලේ මේ 31 වෙනි රාත්‍රිය ගතකරල ඉවරකරගන්න..  ඉතින් එයාලට සිද්දවුනා ඒ රාත්‍රිය ඇතුලෙ මලවුන් එක්ක එකට වාසය කරන්න.`,
      transitionToNext: '06_07_T.mp4'
    },
    {
      file: '07.mp4',
      title: 'Scene 7: The Turnip Decoys',
      script: `ඒත් මේ දේවල් එතනින් ඉවර උනේ නෑ.. මේ හැමදේම අස්සෙ ඒ මිනිස්සුන්ට තවත් එක ප්‍රශ්නයක් තිබුන.. මේ හැමදේම අස්සෙත් මලවුන් තමන්ව හොයාගෙන පස්සෙන් ඒවිද කියල.. ඒ කාලෙ අද වගේ පම්කින්ස් තිබුනෙ නෑ ඒ වෙනුවට ඒ කාලෙ තිබුන ටර්නිප් අල වලින් ඒ මනුස්සයො මලවුන්ගේ මූනු හදල ගෙවල් වල පේන්න තිබ්බ.. හදිස්සියෙවත් මලවුන් තමන්ව හොයාගෙන ආවොත් මේ ගෙදර මේ වෙනකොටත් මලවුන් අයිති කරන් ඉවරයි කියල පෙන්නන්නයි ඒ දේ සිද්දකලේ..`,
      transitionToNext: '07_08_T.mp4'
    },
    {
      file: '08.mp4',
      title: 'Scene 8: The Primal Ritual',
      script: `වසර අවුරුදු ගානකට පස්සෙත් මේ බය මිනිස්සුන්ගෙන් ගියේ නෑ.. ශතවර්ශ ගානකට පස්සෙ ඒ ටර්නිප් අල කාලයේ ඇවෑමෙන් ජැකෝ ලැන්ටර්න්ස් බවට පත් වුනා..`,
      transitionToNext: '08_09_T.mp4'
    },
    {
      file: '09.mp4',
      title: 'Scene 9: Modern Evolution',
      script: `මලවුන්ගෙන් බේරෙන්න හදාගතපු ඒ රූප මෝස්තර.. නවීකරනය උනා..`,
      transitionToNext: '09_10_T.mp4'
    },
    {
      file: '10.mp4',
      title: 'Scene 10: The Jack-o\'-lantern Icon',
      script: `ඒ විතරක් නෙමේ, මලවුන් එක්ක ගතවුන ඒ රාත්‍රියත් කාලයත් එක්ක උත්සවයක් බවට පත්වුනා..`,
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
  audioOutput: 'phone', // 'phone' (default, Bluetooth speaker) | 'screen' (Smartboard TV)
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

function syncScriptFromMarkdown() {
  const scriptPath = path.join(__dirname, 'script.md');
  if (!fs.existsSync(scriptPath)) return;
  try {
    const content = fs.readFileSync(scriptPath, 'utf8');
    const lines = content.split(/\r?\n/);
    let section = 'intro';
    let introLines = [];
    let sceneLines = {};
    let currentScene = 0;
    let outroLines = [];

    for (const line of lines) {
      const m = line.match(/^(\d+)\.\s*(.*)/);
      if (m) {
        currentScene = parseInt(m[1], 10);
        section = 'scene';
        sceneLines[currentScene] = [m[2]];
      } else if (section === 'intro') {
        introLines.push(line);
      } else if (section === 'scene') {
        if (currentScene === 10 && line.trim() && !line.match(/^\d+\./)) {
          section = 'outro';
          outroLines.push(line);
        } else if (line.trim()) {
          sceneLines[currentScene].push(line);
        }
      } else if (section === 'outro') {
        outroLines.push(line);
      }
    }

    const introText = introLines.join('\n').trim();
    if (introText) {
      if (!SHOW_CONFIG.intoBlackout) SHOW_CONFIG.intoBlackout = {};
      SHOW_CONFIG.intoBlackout.script = introText;
    }

    for (let i = 1; i <= 10; i++) {
      if (sceneLines[i] && SHOW_CONFIG.scenes[i - 1]) {
        SHOW_CONFIG.scenes[i - 1].script = sceneLines[i].join('\n').trim();
      }
    }

    const nonBlankOutro = outroLines.map(l => l.trim()).filter(Boolean);
    if (nonBlankOutro.length > 0) {
      if (!SHOW_CONFIG.postBlackout) SHOW_CONFIG.postBlackout = {};
      const part2 = nonBlankOutro.pop();
      const part1 = nonBlankOutro.join('\n\n');
      SHOW_CONFIG.postBlackout.scriptPart1 = part1;
      SHOW_CONFIG.postBlackout.scriptPart2 = part2;
    }
  } catch (err) {
    console.error('[Script Sync Error]', err.message);
  }
}

function buildManifest() {
  syncScriptFromMarkdown();
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
    intoBlackout: SHOW_CONFIG.intoBlackout,
    postBlackout: SHOW_CONFIG.postBlackout,
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
      state.audioPlaying = true;
      state.audioInitialized = true;
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
      state.audioPlaying = false; // Smooth fade out when returning home
      transitionSafetyTimer = setTimeout(() => {
        if (state.stageMode === 'transitioning_home') {
          state.stageMode = 'standby_loop';
          state.blackout = false;
          state.activeScene = -1;
          state.targetScene = -1;
          state.transitionFile = null;
          state.audioPlaying = false;
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
      state.audioPlaying = false;
      state.seq += 1;
      broadcastState();
      return;
    }

    if (data.type === 'toggle_blackout') {
      clearSafetyTimer();
      if (state.stageMode === 'standby_loop') {
        state.stageMode = 'transitioning_black';
        state.blackout = false;
        state.audioPlaying = true;
        state.audioInitialized = true;
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

    if (data.type === 'set_audio_output') {
      const target = (data.output || data.destination) === 'screen' ? 'screen' : 'phone';
      state.audioOutput = target;
      state.seq += 1;
      broadcastState();
      return;
    }

    if (data.type === 'toggle_audio_output') {
      state.audioOutput = state.audioOutput === 'screen' ? 'phone' : 'screen';
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
      state.audioOutput = 'phone';
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
