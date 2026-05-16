const fs = require('fs');
const path = require('path');
const { Server, utils: { sftp: { STATUS_CODE: SFTP_STATUS_CODE, OPEN_MODE: SFTP_OPEN_MODE } } } = require('ssh2');
const { spawn } = require('child_process');

const CONFIG = {
  port: parseInt(process.env.SSH_PORT || '2222', 10),
  host: '0.0.0.0',
  username: process.env.SSH_USER || 'admin',
  password: process.env.SSH_PASS || 'lrt@1234',
  hostKeyPath: process.env.HOST_KEY || path.join(__dirname, 'keys', 'host_key'),
};

const hostKey = fs.readFileSync(CONFIG.hostKeyPath);

const server = new Server({ hostKeys: [hostKey] }, (client) => {
  const clientAddr = client._sock?.remoteAddress || 'unknown';
  console.log(`[${ts()}] Client connected from ${clientAddr}`);

  let authenticated = false;

  client.on('authentication', (ctx) => {
    if (
      ctx.method === 'password' &&
      ctx.username === CONFIG.username &&
      ctx.password === CONFIG.password
    ) {
      authenticated = true;
      console.log(`[${ts()}] Auth success: ${ctx.username}`);
      ctx.accept();
    } else if (ctx.method === 'none') {
      ctx.reject(['password']);
    } else {
      console.log(`[${ts()}] Auth failed: ${ctx.username} (${ctx.method})`);
      ctx.reject(['password']);
    }
  });

  client.on('ready', () => {
    console.log(`[${ts()}] Client authenticated, waiting for session`);

    client.on('session', (accept) => {
      const session = accept();

      session.on('pty', (accept) => {
        accept && accept();
      });

      session.on('shell', (accept) => {
        const channel = accept();
        handleShell(channel, clientAddr);
      });

      session.on('exec', (accept, reject, info) => {
        const channel = accept();
        handleExec(channel, info.command, clientAddr);
      });

      session.on('sftp', (accept) => {
        console.log(`[${ts()}] SFTP session opened for ${clientAddr}`);
        const sftpStream = accept();
        handleSftp(sftpStream, clientAddr);
      });
    });
  });

  client.on('end', () => {
    console.log(`[${ts()}] Client disconnected: ${clientAddr}`);
  });

  client.on('error', (err) => {
    console.error(`[${ts()}] Client error: ${err.message}`);
  });
});

function handleShell(channel, clientAddr) {
  console.log(`[${ts()}] Shell opened for ${clientAddr}`);

  const isWindows = process.platform === 'win32';
  const shellCmd = isWindows ? 'cmd.exe' : '/bin/bash';
  const shellArgs = isWindows ? [] : ['--login'];

  const shell = spawn(shellCmd, shellArgs, {
    env: { ...process.env, TERM: 'xterm-256color' },
    cwd: process.env.HOME || process.env.USERPROFILE || '/',
  });

  channel.pipe(shell.stdin);
  shell.stdout.pipe(channel);
  shell.stderr.pipe(channel.stderr);

  shell.on('close', (code) => {
    console.log(`[${ts()}] Shell closed (code ${code}) for ${clientAddr}`);
    channel.exit(code || 0);
    channel.end();
  });

  channel.on('close', () => {
    shell.kill();
  });
}

function handleExec(channel, command, clientAddr) {
  console.log(`[${ts()}] Exec: "${command}" from ${clientAddr}`);

  const isWindows = process.platform === 'win32';
  const shellCmd = isWindows ? 'cmd.exe' : '/bin/sh';
  const shellArgs = isWindows ? ['/c', command] : ['-c', command];

  const proc = spawn(shellCmd, shellArgs, {
    env: process.env,
    cwd: process.env.HOME || process.env.USERPROFILE || '/',
  });

  proc.stdout.pipe(channel);
  proc.stderr.pipe(channel.stderr);

  proc.on('close', (code) => {
    channel.exit(code || 0);
    channel.end();
  });

  channel.on('close', () => {
    proc.kill();
  });
}

function handleSftp(sftpStream, clientAddr) {
  const openFiles = new Map();
  const openDirs = new Map();
  let handleCount = 0;

  function nextHandle() {
    return Buffer.from(String(handleCount++));
  }

  sftpStream.on('OPEN', (reqid, filename, flags, attrs) => {
    console.log(`[${ts()}] SFTP OPEN: ${filename} from ${clientAddr}`);
    const handle = nextHandle();

    let mode = 'r';
    const write = flags & SFTP_OPEN_MODE.WRITE;
    const read = flags & SFTP_OPEN_MODE.READ;
    const create = flags & SFTP_OPEN_MODE.CREAT;
    const trunc = flags & SFTP_OPEN_MODE.TRUNC;
    const append = flags & SFTP_OPEN_MODE.APPEND;

    if (write && read) mode = create ? 'w+' : 'r+';
    else if (write) mode = append ? 'a' : 'w';
    else mode = 'r';

    try {
      const fd = fs.openSync(filename, mode);
      openFiles.set(handle.toString(), { fd, filename, pos: 0 });
      sftpStream.handle(reqid, handle);
    } catch (err) {
      console.error(`[${ts()}] SFTP OPEN error: ${err.message}`);
      sftpStream.status(reqid, errorToStatus(err));
    }
  });

  sftpStream.on('READ', (reqid, handle, offset, length) => {
    const key = handle.toString();
    const entry = openFiles.get(key);
    if (!entry) return sftpStream.status(reqid, SFTP_STATUS_CODE.FAILURE);

    const buf = Buffer.alloc(length);
    try {
      const bytesRead = fs.readSync(entry.fd, buf, 0, length, offset);
      if (bytesRead === 0) {
        sftpStream.status(reqid, SFTP_STATUS_CODE.EOF);
      } else {
        sftpStream.data(reqid, buf.slice(0, bytesRead));
      }
    } catch (err) {
      sftpStream.status(reqid, errorToStatus(err));
    }
  });

  sftpStream.on('WRITE', (reqid, handle, offset, data) => {
    const key = handle.toString();
    const entry = openFiles.get(key);
    if (!entry) return sftpStream.status(reqid, SFTP_STATUS_CODE.FAILURE);

    try {
      fs.writeSync(entry.fd, data, 0, data.length, offset);
      sftpStream.status(reqid, SFTP_STATUS_CODE.OK);
    } catch (err) {
      sftpStream.status(reqid, errorToStatus(err));
    }
  });

  sftpStream.on('CLOSE', (reqid, handle) => {
    const key = handle.toString();
    const fileEntry = openFiles.get(key);
    if (fileEntry) {
      fs.closeSync(fileEntry.fd);
      openFiles.delete(key);
      console.log(`[${ts()}] SFTP CLOSE file: ${fileEntry.filename}`);
    }
    const dirEntry = openDirs.get(key);
    if (dirEntry) {
      openDirs.delete(key);
      console.log(`[${ts()}] SFTP CLOSE dir: ${dirEntry.path}`);
    }
    sftpStream.status(reqid, SFTP_STATUS_CODE.OK);
  });

  sftpStream.on('FSTAT', (reqid, handle) => {
    const key = handle.toString();
    const entry = openFiles.get(key);
    if (!entry) return sftpStream.status(reqid, SFTP_STATUS_CODE.FAILURE);

    try {
      const stat = fs.fstatSync(entry.fd);
      sftpStream.attrs(reqid, statToAttrs(stat));
    } catch (err) {
      sftpStream.status(reqid, errorToStatus(err));
    }
  });

  sftpStream.on('STAT', (reqid, filepath) => {
    try {
      const stat = fs.statSync(filepath);
      sftpStream.attrs(reqid, statToAttrs(stat));
    } catch (err) {
      sftpStream.status(reqid, errorToStatus(err));
    }
  });

  sftpStream.on('LSTAT', (reqid, filepath) => {
    try {
      const stat = fs.lstatSync(filepath);
      sftpStream.attrs(reqid, statToAttrs(stat));
    } catch (err) {
      sftpStream.status(reqid, errorToStatus(err));
    }
  });

  sftpStream.on('OPENDIR', (reqid, dirpath) => {
    console.log(`[${ts()}] SFTP OPENDIR: ${dirpath} from ${clientAddr}`);
    try {
      const entries = fs.readdirSync(dirpath, { withFileTypes: true });
      const handle = nextHandle();
      openDirs.set(handle.toString(), { path: dirpath, entries, offset: 0 });
      sftpStream.handle(reqid, handle);
    } catch (err) {
      sftpStream.status(reqid, errorToStatus(err));
    }
  });

  const READDIR_CHUNK = 100;

  sftpStream.on('READDIR', (reqid, handle) => {
    const key = handle.toString();
    const entry = openDirs.get(key);
    if (!entry) return sftpStream.status(reqid, SFTP_STATUS_CODE.FAILURE);

    if (entry.offset >= entry.entries.length) {
      return sftpStream.status(reqid, SFTP_STATUS_CODE.EOF);
    }

    const chunk = entry.entries.slice(entry.offset, entry.offset + READDIR_CHUNK);
    entry.offset += chunk.length;

    const names = chunk.map((e) => {
      const fullPath = path.join(entry.path, e.name);
      let stat;
      try { stat = fs.statSync(fullPath); } catch { stat = null; }
      return {
        filename: e.name,
        longname: formatLongname(e, stat),
        attrs: stat ? statToAttrs(stat) : {},
      };
    });

    sftpStream.name(reqid, names);
  });

  sftpStream.on('REALPATH', (reqid, filepath) => {
    const resolved = path.resolve(filepath);
    sftpStream.name(reqid, [{ filename: resolved, longname: resolved, attrs: {} }]);
  });

  sftpStream.on('REMOVE', (reqid, filepath) => {
    console.log(`[${ts()}] SFTP REMOVE: ${filepath} from ${clientAddr}`);
    try {
      fs.unlinkSync(filepath);
      sftpStream.status(reqid, SFTP_STATUS_CODE.OK);
    } catch (err) {
      sftpStream.status(reqid, errorToStatus(err));
    }
  });

  sftpStream.on('MKDIR', (reqid, dirpath, attrs) => {
    console.log(`[${ts()}] SFTP MKDIR: ${dirpath} from ${clientAddr}`);
    try {
      fs.mkdirSync(dirpath, { recursive: true });
      sftpStream.status(reqid, SFTP_STATUS_CODE.OK);
    } catch (err) {
      sftpStream.status(reqid, errorToStatus(err));
    }
  });

  sftpStream.on('RMDIR', (reqid, dirpath) => {
    console.log(`[${ts()}] SFTP RMDIR: ${dirpath} from ${clientAddr}`);
    try {
      fs.rmdirSync(dirpath);
      sftpStream.status(reqid, SFTP_STATUS_CODE.OK);
    } catch (err) {
      sftpStream.status(reqid, errorToStatus(err));
    }
  });

  sftpStream.on('RENAME', (reqid, oldPath, newPath) => {
    console.log(`[${ts()}] SFTP RENAME: ${oldPath} -> ${newPath} from ${clientAddr}`);
    try {
      fs.renameSync(oldPath, newPath);
      sftpStream.status(reqid, SFTP_STATUS_CODE.OK);
    } catch (err) {
      sftpStream.status(reqid, errorToStatus(err));
    }
  });

  sftpStream.on('SETSTAT', (reqid, filepath, attrs) => {
    sftpStream.status(reqid, SFTP_STATUS_CODE.OK);
  });

  sftpStream.on('FSETSTAT', (reqid, handle, attrs) => {
    sftpStream.status(reqid, SFTP_STATUS_CODE.OK);
  });
}

function statToAttrs(stat) {
  return {
    mode: stat.mode,
    uid: stat.uid || 0,
    gid: stat.gid || 0,
    size: stat.size,
    atime: Math.floor(stat.atimeMs / 1000),
    mtime: Math.floor(stat.mtimeMs / 1000),
  };
}

function errorToStatus(err) {
  if (err.code === 'ENOENT') return SFTP_STATUS_CODE.NO_SUCH_FILE;
  if (err.code === 'EACCES' || err.code === 'EPERM') return SFTP_STATUS_CODE.PERMISSION_DENIED;
  return SFTP_STATUS_CODE.FAILURE;
}

function formatLongname(entry, stat) {
  const type = entry.isDirectory() ? 'd' : '-';
  const size = stat ? stat.size : 0;
  const mtime = stat ? stat.mtime.toISOString().substring(0, 10) : '          ';
  return `${type}rwxr-xr-x  1 user  group  ${String(size).padStart(10)} ${mtime} ${entry.name}`;
}

function ts() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

process.on('uncaughtException', (err) => {
  console.error(`[${ts()}] Uncaught exception: ${err.message}`);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error(`[${ts()}] Unhandled rejection: ${reason}`);
});

server.listen(CONFIG.port, CONFIG.host, () => {
  console.log(`[${ts()}] NodeDesk SSH server listening on ${CONFIG.host}:${CONFIG.port}`);
  console.log(`[${ts()}] User: ${CONFIG.username}`);
  console.log(`[${ts()}] Platform: ${process.platform} | Node: ${process.version} | PID: ${process.pid}`);
});

server.on('error', (err) => {
  console.error(`[${ts()}] Server error: ${err.message}`);
});
