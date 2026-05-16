const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const screenshot = require('screenshot-desktop');
const { mouse, keyboard, Key, Button, Point } = require('@nut-tree-fork/nut-js');

mouse.config.autoDelayMs = 0;
keyboard.config.autoDelayMs = 0;

const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadConfig() {
  const defaults = { port: 8080, host: '0.0.0.0', password: '' };
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      return Object.assign(defaults, saved);
    }
  } catch (_) {}
  return defaults;
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

const CONFIG = loadConfig();
if (process.env.WEB_PORT) CONFIG.port = parseInt(process.env.WEB_PORT, 10);
if (process.env.WEB_PASS) CONFIG.password = process.env.WEB_PASS;

const isWindows = process.platform === 'win32';
const upload = multer({ storage: multer.memoryStorage() });

function ts() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function log(category, message, level) {
  const lvl = level || 'INFO';
  console.log(`[${ts()}] [${lvl}] [${category}] ${message}`);
}

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  const start = Date.now();
  const originalEnd = res.end;
  res.end = function () {
    const duration = Date.now() - start;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    log('HTTP', `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms [${ip}]`);
    originalEnd.apply(res, arguments);
  };
  next();
});

function authMiddleware(req, res, next) {
  if (!CONFIG.password) return next();
  const authParam = req.query.auth;
  if (req.headers['x-auth'] !== CONFIG.password && authParam !== CONFIG.password) {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    log('AUTH', `Rejected ${req.method} ${req.originalUrl} from ${ip}`, 'WARN');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.get('/api/auth-required', (req, res) => {
  res.json({ required: !!CONFIG.password });
});

app.use('/api', authMiddleware);

app.get('/api/settings', (req, res) => {
  res.json({ port: CONFIG.port, host: CONFIG.host, password: CONFIG.password });
});

app.post('/api/settings', express.json(), (req, res) => {
  const { port, host, password } = req.body;
  if (port !== undefined) CONFIG.port = parseInt(port, 10);
  if (host !== undefined) CONFIG.host = host;
  if (password !== undefined) CONFIG.password = password;
  saveConfig({ port: CONFIG.port, host: CONFIG.host, password: CONFIG.password });
  log('SETTINGS', `Config saved: port=${CONFIG.port} host=${CONFIG.host} auth=${CONFIG.password ? 'enabled' : 'disabled'}`);
  res.json({ success: true, message: 'Settings saved. Restart server for port/host changes.' });
});

app.get('/api/shortcuts', (req, res) => {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const shortcuts = [
    { name: 'Home', icon: '\uD83C\uDFE0', path: home },
    { name: 'Desktop', icon: '\uD83D\uDDA5', path: path.join(home, 'Desktop') },
    { name: 'Downloads', icon: '\u2B07', path: path.join(home, 'Downloads') },
    { name: 'Documents', icon: '\uD83D\uDCC4', path: path.join(home, 'Documents') },
    { name: 'Pictures', icon: '\uD83D\uDDBC', path: path.join(home, 'Pictures') },
    { name: 'Videos', icon: '\uD83C\uDFAC', path: path.join(home, 'Videos') },
    { name: 'Music', icon: '\uD83C\uDFB5', path: path.join(home, 'Music') },
  ];
  const result = shortcuts.filter(s => { try { return fs.existsSync(s.path); } catch (_) { return false; } });
  res.json(result);
});

app.get('/api/drives', (req, res) => {
  if (isWindows) {
    const { execSync } = require('child_process');
    try {
      const raw = execSync('wmic logicaldisk get caption,size,freespace,drivetype /format:csv', { encoding: 'utf-8' });
      const lines = raw.trim().split('\n').filter(l => l.trim());
      const drives = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].trim().split(',');
        if (cols.length >= 4) {
          const letter = cols[1];
          const free = parseInt(cols[2]) || 0;
          const total = parseInt(cols[3]) || 0;
          if (letter) drives.push({ letter: letter, free: free, total: total });
        }
      }
      res.json(drives);
    } catch (_) {
      const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
      const drives = [];
      for (const l of letters) {
        const p = l + ':\\';
        try { if (fs.existsSync(p) && fs.statSync(p).isDirectory()) drives.push({ letter: l + ':', free: 0, total: 0 }); } catch (_) {}
      }
      res.json(drives);
    }
  } else {
    res.json([{ letter: '/', free: 0, total: 0 }]);
  }
});

app.get('/api/files', (req, res) => {
  const dirPath = req.query.path || (isWindows ? 'C:\\' : '/');
  try {
    if (!fs.existsSync(dirPath)) {
      return res.status(404).json({ error: 'Path not found' });
    }
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const items = [];
    for (const entry of entries) {
      try {
        const fullPath = path.join(dirPath, entry.name);
        const s = fs.statSync(fullPath);
        items.push({
          name: entry.name,
          type: s.isDirectory() ? 'dir' : 'file',
          size: s.size,
          mtime: s.mtime,
        });
      } catch (_) {}
    }
    items.sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      return a.type === 'dir' ? -1 : 1;
    });
    res.json(items);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/files/download', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Path required' });
  try {
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      return res.status(400).json({ error: 'Cannot download directories' });
    }
    res.download(filePath, path.basename(filePath));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/files/upload', upload.array('files'), (req, res) => {
  const destDir = req.query.path;
  if (!destDir) return res.status(400).json({ error: 'Destination path required' });
  try {
    if (!fs.existsSync(destDir)) {
      return res.status(404).json({ error: 'Destination directory not found' });
    }
    for (const file of req.files) {
      const destPath = path.join(destDir, file.originalname);
      fs.writeFileSync(destPath, file.buffer);
    }
    res.json({ success: true, count: req.files.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/files/mkdir', (req, res) => {
  const dirPath = req.body.path;
  if (!dirPath) return res.status(400).json({ error: 'Path required' });
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    res.json({ success: true, path: dirPath });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/files/rename', (req, res) => {
  const { oldPath, newPath } = req.body;
  if (!oldPath || !newPath) return res.status(400).json({ error: 'oldPath and newPath required' });
  try {
    if (!fs.existsSync(oldPath)) return res.status(404).json({ error: 'Source not found' });
    fs.renameSync(oldPath, newPath);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/files', (req, res) => {
  const targetPath = req.query.path;
  if (!targetPath) return res.status(400).json({ error: 'Path required' });
  try {
    if (!fs.existsSync(targetPath)) {
      return res.status(404).json({ error: 'Path not found' });
    }
    fs.rmSync(targetPath, { recursive: true, force: true });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/desktop/screenshot', async (req, res) => {
  try {
    const img = await screenshot({ format: 'png' });
    res.set('Content-Type', 'image/png');
    res.send(img);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/desktop/stream', async (req, res) => {
  let fps = parseInt(req.query.fps || '1', 10);
  if (isNaN(fps) || fps < 1) fps = 1;
  if (fps > 20) fps = 20;
  const interval = Math.floor(1000 / fps);

  res.set({
    'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  let running = true;
  req.on('close', () => { running = false; });

  const sendFrame = async () => {
    while (running) {
      try {
        const img = await screenshot({ format: 'png' });
        if (!running) break;
        res.write(`--frame\r\nContent-Type: image/png\r\nContent-Length: ${img.length}\r\n\r\n`);
        res.write(img);
        res.write('\r\n');
      } catch (_) {
        if (!running) break;
      }
      await new Promise(r => setTimeout(r, interval));
    }
  };
  sendFrame();
});

const KEY_MAP = {
  'Enter': Key.Enter, 'Backspace': Key.Backspace, 'Tab': Key.Tab,
  'Escape': Key.Escape, 'Delete': Key.Delete, 'Insert': Key.Insert,
  'Home': Key.Home, 'End': Key.End, 'PageUp': Key.PageUp, 'PageDown': Key.PageDown,
  'ArrowUp': Key.Up, 'ArrowDown': Key.Down, 'ArrowLeft': Key.Left, 'ArrowRight': Key.Right,
  'F1': Key.F1, 'F2': Key.F2, 'F3': Key.F3, 'F4': Key.F4, 'F5': Key.F5, 'F6': Key.F6,
  'F7': Key.F7, 'F8': Key.F8, 'F9': Key.F9, 'F10': Key.F10, 'F11': Key.F11, 'F12': Key.F12,
  'Control': Key.LeftControl, 'Shift': Key.LeftShift, 'Alt': Key.LeftAlt,
  'Meta': Key.LeftSuper, 'CapsLock': Key.CapsLock, ' ': Key.Space,
};

const CHAR_KEY_MAP = {};
'abcdefghijklmnopqrstuvwxyz'.split('').forEach(c => { CHAR_KEY_MAP[c] = Key[c.toUpperCase()]; });
'0123456789'.split('').forEach(c => { CHAR_KEY_MAP[c] = Key['Num' + c]; });
CHAR_KEY_MAP['-'] = Key.Minus; CHAR_KEY_MAP['='] = Key.Equal;
CHAR_KEY_MAP['['] = Key.LeftBracket; CHAR_KEY_MAP[']'] = Key.RightBracket;
CHAR_KEY_MAP['\\'] = Key.Backslash; CHAR_KEY_MAP[';'] = Key.Semicolon;
CHAR_KEY_MAP["'"] = Key.Quote; CHAR_KEY_MAP[','] = Key.Comma;
CHAR_KEY_MAP['.'] = Key.Period; CHAR_KEY_MAP['/'] = Key.Slash;
CHAR_KEY_MAP['`'] = Key.Grave;

function resolveKey(key) {
  if (KEY_MAP[key]) return KEY_MAP[key];
  const lower = key.toLowerCase();
  if (CHAR_KEY_MAP[lower]) return CHAR_KEY_MAP[lower];
  return null;
}

app.post('/api/desktop/mouse', express.json(), async (req, res) => {
  const { action, x, y, button } = req.body;
  try {
    const btn = button === 'right' ? Button.RIGHT : button === 'middle' ? Button.MIDDLE : Button.LEFT;
    switch (action) {
      case 'move':
        await mouse.setPosition(new Point(x, y));
        break;
      case 'click':
        await mouse.setPosition(new Point(x, y));
        await mouse.click(btn);
        break;
      case 'dblclick':
        await mouse.setPosition(new Point(x, y));
        await mouse.doubleClick(btn);
        break;
      case 'down':
        await mouse.setPosition(new Point(x, y));
        await mouse.pressButton(btn);
        break;
      case 'up':
        await mouse.setPosition(new Point(x, y));
        await mouse.releaseButton(btn);
        break;
      case 'scroll':
        await mouse.scrollDown(y > 0 ? Math.abs(y) : 0);
        await mouse.scrollUp(y < 0 ? Math.abs(y) : 0);
        break;
      default:
        return res.status(400).json({ error: 'Unknown mouse action' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/desktop/keyboard', express.json(), async (req, res) => {
  const { action, key, modifiers } = req.body;
  try {
    if (action === 'type' && key && key.length === 1 && (!modifiers || modifiers.length === 0)) {
      await keyboard.type(key);
      res.json({ success: true });
      return;
    }

    const resolvedKey = resolveKey(key);
    if (!resolvedKey) {
      if (key && key.length === 1) {
        await keyboard.type(key);
        res.json({ success: true });
        return;
      }
      return res.status(400).json({ error: 'Unknown key: ' + key });
    }

    const mods = (modifiers || []).map(m => {
      if (m === 'ctrl' || m === 'Control') return Key.LeftControl;
      if (m === 'shift' || m === 'Shift') return Key.LeftShift;
      if (m === 'alt' || m === 'Alt') return Key.LeftAlt;
      if (m === 'meta' || m === 'Meta') return Key.LeftSuper;
      return null;
    }).filter(Boolean);

    if (action === 'down') {
      for (const m of mods) await keyboard.pressKey(m);
      await keyboard.pressKey(resolvedKey);
    } else if (action === 'up') {
      await keyboard.releaseKey(resolvedKey);
      for (const m of mods.reverse()) await keyboard.releaseKey(m);
    } else {
      if (mods.length > 0) {
        for (const m of mods) await keyboard.pressKey(m);
        await keyboard.pressKey(resolvedKey);
        await keyboard.releaseKey(resolvedKey);
        for (const m of mods.reverse()) await keyboard.releaseKey(m);
      } else {
        await keyboard.pressKey(resolvedKey);
        await keyboard.releaseKey(resolvedKey);
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/desktop/screensize', async (req, res) => {
  try {
    const img = await screenshot({ format: 'png' });
    const { createCanvas, loadImage } = (() => {
      try { return require('canvas'); } catch (_) { return {}; }
    })();
    const sizeOf = (() => {
      try { return require('image-size'); } catch (_) { return null; }
    })();
    if (sizeOf) {
      const dims = sizeOf(img);
      return res.json({ width: dims.width, height: dims.height });
    }
    const pngSig = img.slice(16, 24);
    const width = pngSig.readUInt32BE(0);
    const height = pngSig.readUInt32BE(4);
    res.json({ width, height });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

let captureProc = null;
let captureReady = false;
let captureBuf = Buffer.alloc(0);
let captureHeaderParsed = false;
let captureFrameSize = -1;
let captureCallbacks = [];

function ensureCaptureWorker() {
  if (captureProc && !captureProc.killed) return;

  captureProc = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'capture-worker.ps1')], { stdio: ['pipe', 'pipe', 'pipe'] });
  captureReady = false;
  captureBuf = Buffer.alloc(0);
  captureHeaderParsed = false;
  captureFrameSize = -1;

  captureProc.stdout.on('data', (chunk) => {
    captureBuf = Buffer.concat([captureBuf, chunk]);
    while (true) {
      if (!captureHeaderParsed) {
        const idx = captureBuf.indexOf(10);
        if (idx === -1) break;
        const header = captureBuf.slice(0, idx).toString();
        if (header.startsWith('FRAME:')) {
          captureFrameSize = parseInt(header.split(':')[1]);
          captureHeaderParsed = true;
          captureBuf = captureBuf.slice(idx + 1);
        } else {
          captureBuf = captureBuf.slice(idx + 1);
        }
      }
      if (captureHeaderParsed && captureBuf.length >= captureFrameSize) {
        const frame = captureBuf.slice(0, captureFrameSize);
        captureBuf = captureBuf.slice(captureFrameSize);
        captureHeaderParsed = false;
        captureFrameSize = -1;
        captureReady = true;
        const cb = captureCallbacks.shift();
        if (cb) cb(null, frame);
      } else break;
    }
  });

  captureProc.stderr.on('data', (d) => {
    const msg = d.toString().trim();
    if (msg) log('CAPTURE', msg, 'ERROR');
  });

  captureProc.on('close', () => {
    captureReady = false;
    captureProc = null;
    while (captureCallbacks.length) {
      const cb = captureCallbacks.shift();
      cb(new Error('Capture worker died'));
    }
  });

  log('CAPTURE', 'Worker started, warming up...');
  setTimeout(() => {
    if (captureProc && !captureProc.killed) {
      captureProc.stdin.write('warmup\n');
    }
  }, 500);
}

function captureFrame(callback) {
  ensureCaptureWorker();
  captureCallbacks.push(callback);
  if (captureProc && !captureProc.killed) {
    captureProc.stdin.write('capture\n');
  }
}

const wssTerminal = new WebSocketServer({ noServer: true });
const wssDesktop = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  if (pathname === '/ws/terminal') {
    wssTerminal.handleUpgrade(req, socket, head, (ws) => {
      wssTerminal.emit('connection', ws, req);
    });
  } else if (pathname === '/ws/desktop') {
    wssDesktop.handleUpgrade(req, socket, head, (ws) => {
      wssDesktop.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

wssDesktop.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  log('WS', `Desktop connection from ${clientIp}`);
  let authenticated = false;
  let streaming = false;
  let streamRunning = false;

  ws.on('message', async (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch (_) { return; }

    if (!authenticated) {
      if (msg.type === 'auth' && (!CONFIG.password || msg.password === CONFIG.password)) {
        authenticated = true;
        ws.send(JSON.stringify({ type: 'auth', success: true }));
        log('WS', `Desktop authenticated from ${clientIp}`);
      } else {
        ws.send(JSON.stringify({ type: 'auth', success: false }));
        ws.close();
      }
      return;
    }

    if (msg.type === 'start') {
      const fps = Math.min(Math.max(parseInt(msg.fps) || 5, 1), 30);
      const interval = Math.floor(1000 / fps);
      streaming = true;
      streamRunning = true;
      log('WS', `Desktop stream started at ${fps}fps for ${clientIp}`);

      const sendLoop = () => {
        if (!streamRunning || ws.readyState !== 1) return;
        captureFrame((err, frame) => {
          if (err || !streamRunning || ws.readyState !== 1) return;
          try {
            ws.send(frame, { binary: true });
          } catch (_) { streamRunning = false; return; }
          setTimeout(sendLoop, interval);
        });
      };
      sendLoop();
    } else if (msg.type === 'stop') {
      streaming = false;
      streamRunning = false;
      log('WS', `Desktop stream stopped for ${clientIp}`);
    } else if (msg.type === 'mouse') {
      try {
        const btn = msg.button === 'right' ? Button.RIGHT : msg.button === 'middle' ? Button.MIDDLE : Button.LEFT;
        switch (msg.action) {
          case 'move': await mouse.setPosition(new Point(msg.x, msg.y)); break;
          case 'click': await mouse.setPosition(new Point(msg.x, msg.y)); await mouse.click(btn); break;
          case 'dblclick': await mouse.setPosition(new Point(msg.x, msg.y)); await mouse.doubleClick(btn); break;
          case 'down': await mouse.setPosition(new Point(msg.x, msg.y)); await mouse.pressButton(btn); break;
          case 'up': await mouse.setPosition(new Point(msg.x, msg.y)); await mouse.releaseButton(btn); break;
          case 'scroll':
            if (msg.y > 0) await mouse.scrollDown(Math.abs(msg.y));
            else if (msg.y < 0) await mouse.scrollUp(Math.abs(msg.y));
            break;
        }
      } catch (_) {}
    } else if (msg.type === 'key') {
      try {
        if (msg.action === 'type' && msg.key && msg.key.length === 1 && (!msg.modifiers || msg.modifiers.length === 0)) {
          await keyboard.type(msg.key);
          return;
        }
        const resolved = resolveKey(msg.key);
        if (!resolved) {
          if (msg.key && msg.key.length === 1) { await keyboard.type(msg.key); return; }
          return;
        }
        const mods = (msg.modifiers || []).map(m => {
          if (m === 'ctrl' || m === 'Control') return Key.LeftControl;
          if (m === 'shift' || m === 'Shift') return Key.LeftShift;
          if (m === 'alt' || m === 'Alt') return Key.LeftAlt;
          if (m === 'meta' || m === 'Meta') return Key.LeftSuper;
          return null;
        }).filter(Boolean);

        for (const m of mods) await keyboard.pressKey(m);
        await keyboard.pressKey(resolved);
        await keyboard.releaseKey(resolved);
        for (const m of mods.reverse()) await keyboard.releaseKey(m);
      } catch (_) {}
    }
  });

  ws.on('close', () => {
    streamRunning = false;
    log('WS', `Desktop disconnected from ${clientIp}`);
  });

  ws.on('error', () => { streamRunning = false; });
});

wssTerminal.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  log('WS', `New terminal connection from ${clientIp}`);
  let authenticated = false;
  let shell = null;

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (_) {
      if (authenticated && shell) {
        shell.stdin.write(data);
      }
      return;
    }

    if (!authenticated) {
      if (msg.type === 'auth' && (!CONFIG.password || msg.password === CONFIG.password)) {
        authenticated = true;
        ws.send(JSON.stringify({ type: 'auth', success: true }));

        const shellCmd = isWindows ? 'cmd.exe' : '/bin/bash';
        const cwd = isWindows ? (process.env.USERPROFILE || 'C:\\') : (process.env.HOME || '/');
        shell = spawn(shellCmd, [], { cwd });

        shell.stdout.on('data', (chunk) => {
          if (ws.readyState === 1) ws.send(chunk);
        });

        shell.stderr.on('data', (chunk) => {
          if (ws.readyState === 1) ws.send(chunk);
        });

        shell.on('close', (code) => {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'exit', code }));
            ws.close();
          }
        });

        shell.on('error', (err) => {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'error', message: err.message }));
            ws.close();
          }
        });

        log('WS', `Terminal authenticated from ${clientIp}, shell spawned`);
      } else {
        log('AUTH', `WebSocket auth failed from ${clientIp}`, 'WARN');
        ws.send(JSON.stringify({ type: 'auth', success: false }));
        ws.close();
      }
      return;
    }

    if (msg.type === 'input' && shell) {
      shell.stdin.write(msg.data);
    } else if (msg.type === 'resize') {
    }
  });

  ws.on('close', () => {
    log('WS', `Terminal disconnected from ${clientIp}`);
    if (shell) {
      try { shell.kill(); } catch (_) {}
    }
  });

  ws.on('error', (err) => {
    log('WS', `Terminal error from ${clientIp}: ${err.message}`, 'ERROR');
    if (shell) {
      try { shell.kill(); } catch (_) {}
    }
  });
});

process.on('uncaughtException', (err) => {
  log('SERVER', `Uncaught exception: ${err.message}`, 'ERROR');
  log('SERVER', err.stack, 'ERROR');
});

process.on('unhandledRejection', (reason) => {
  log('SERVER', `Unhandled rejection: ${reason}`, 'ERROR');
});

process.on('SIGINT', () => {
  log('SERVER', 'Received SIGINT, shutting down...');
  if (captureProc && !captureProc.killed) {
    captureProc.stdin.write('quit\n');
    captureProc.kill();
  }
  wssDesktop.clients.forEach(ws => ws.close());
  wssTerminal.clients.forEach(ws => ws.close());
  server.close(() => {
    log('SERVER', 'Server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000);
});

process.on('SIGTERM', () => {
  log('SERVER', 'Received SIGTERM, shutting down...');
  process.emit('SIGINT');
});

setInterval(() => {
  const memMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
  const termClients = wssTerminal.clients.size;
  const deskClients = wssDesktop.clients.size;
  log('SERVER', `Health: mem=${memMB}MB terminals=${termClients} desktops=${deskClients} capture=${captureProc && !captureProc.killed ? 'running' : 'idle'}`);
}, 300000);

server.listen(CONFIG.port, CONFIG.host, () => {
  log('SERVER', `NodeDesk web server listening on http://${CONFIG.host}:${CONFIG.port}`);
  log('SERVER', `Auth: ${CONFIG.password ? 'enabled' : 'disabled'}`);
  log('SERVER', `Platform: ${process.platform} | Node: ${process.version} | PID: ${process.pid}`);
});
