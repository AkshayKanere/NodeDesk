const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

const args = process.argv.slice(2);

function usage() {
  console.log(`
SSH Remote Tool - File Transfer

Usage:
  node transfer.js upload   <local-path> <remote-path> [host] [port] [user] [pass]
  node transfer.js download <remote-path> <local-path>  [host] [port] [user] [pass]
  node transfer.js list     <remote-path>               [host] [port] [user] [pass]
  node transfer.js delete   <remote-path>               [host] [port] [user] [pass]
  node transfer.js mkdir    <remote-path>               [host] [port] [user] [pass]

Defaults:
  host=100.64.1.39  port=2222  user=admin  pass=lrt@1234
`);
  process.exit(1);
}

if (args.length < 2) usage();

const action = args[0];
let srcPath, dstPath, connArgStart;

if (action === 'upload' || action === 'download') {
  if (args.length < 3) usage();
  srcPath = args[1];
  dstPath = args[2];
  connArgStart = 3;
} else {
  srcPath = args[1];
  connArgStart = 2;
}

const CONFIG = {
  host: args[connArgStart] || '100.64.1.39',
  port: parseInt(args[connArgStart + 1] || '2222', 10),
  username: args[connArgStart + 2] || 'admin',
  password: args[connArgStart + 3] || 'lrt@1234',
};

const conn = new Client();

conn.on('ready', () => {
  conn.sftp((err, sftp) => {
    if (err) { console.error('SFTP error:', err.message); conn.end(); process.exit(1); }

    switch (action) {
      case 'upload': doUpload(sftp, srcPath, dstPath); break;
      case 'download': doDownload(sftp, srcPath, dstPath); break;
      case 'list': doList(sftp, srcPath); break;
      case 'delete': doDelete(sftp, srcPath); break;
      case 'mkdir': doMkdir(sftp, srcPath); break;
      default: console.error(`Unknown action: ${action}`); usage();
    }
  });
});

conn.on('error', (err) => {
  console.error('Connection error:', err.message);
  process.exit(1);
});

conn.connect({
  host: CONFIG.host,
  port: CONFIG.port,
  username: CONFIG.username,
  password: CONFIG.password,
  readyTimeout: 10000,
  algorithms: {
    kex: [
      'ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521',
      'diffie-hellman-group14-sha256', 'diffie-hellman-group14-sha1',
    ],
    cipher: [
      'aes128-ctr', 'aes192-ctr', 'aes256-ctr',
      'aes128-gcm@openssh.com', 'aes256-gcm@openssh.com',
    ],
  },
});

function doUpload(sftp, localPath, remotePath) {
  localPath = path.resolve(localPath);

  if (!fs.existsSync(localPath)) {
    console.error(`Local path not found: ${localPath}`);
    conn.end(); process.exit(1);
  }

  const stat = fs.statSync(localPath);

  if (stat.isDirectory()) {
    uploadDir(sftp, localPath, remotePath, () => {
      console.log('Upload complete.');
      conn.end();
    });
  } else {
    const fileSize = stat.size;
    console.log(`Uploading: ${localPath} -> ${remotePath} (${formatSize(fileSize)})`);

    const readStream = fs.createReadStream(localPath);
    const writeStream = sftp.createWriteStream(remotePath);

    let transferred = 0;
    readStream.on('data', (chunk) => {
      transferred += chunk.length;
      printProgress(transferred, fileSize);
    });

    writeStream.on('close', () => {
      console.log('\nUpload complete.');
      conn.end();
    });

    writeStream.on('error', (err) => {
      console.error('\nUpload error:', err.message);
      conn.end(); process.exit(1);
    });

    readStream.pipe(writeStream);
  }
}

function uploadDir(sftp, localDir, remoteDir, callback) {
  sftp.mkdir(remoteDir, (err) => {
    const entries = fs.readdirSync(localDir, { withFileTypes: true });
    let pending = entries.length;
    if (pending === 0) return callback();

    entries.forEach((entry) => {
      const localFull = path.join(localDir, entry.name);
      const remoteFull = remoteDir.replace(/\\/g, '/') + '/' + entry.name;

      if (entry.isDirectory()) {
        uploadDir(sftp, localFull, remoteFull, () => {
          if (--pending === 0) callback();
        });
      } else {
        const stat = fs.statSync(localFull);
        console.log(`  ${localFull} -> ${remoteFull} (${formatSize(stat.size)})`);
        const rs = fs.createReadStream(localFull);
        const ws = sftp.createWriteStream(remoteFull);
        ws.on('close', () => { if (--pending === 0) callback(); });
        ws.on('error', (err) => {
          console.error(`  Error: ${localFull}: ${err.message}`);
          if (--pending === 0) callback();
        });
        rs.pipe(ws);
      }
    });
  });
}

function doDownload(sftp, remotePath, localPath) {
  localPath = path.resolve(localPath);

  sftp.stat(remotePath, (err, stat) => {
    if (err) {
      console.error(`Remote path not found: ${remotePath}`);
      conn.end(); process.exit(1);
    }

    if (stat.isDirectory()) {
      downloadDir(sftp, remotePath, localPath, () => {
        console.log('Download complete.');
        conn.end();
      });
    } else {
      const fileSize = stat.size;
      console.log(`Downloading: ${remotePath} -> ${localPath} (${formatSize(fileSize)})`);

      const dir = path.dirname(localPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const readStream = sftp.createReadStream(remotePath);
      const writeStream = fs.createWriteStream(localPath);

      let transferred = 0;
      readStream.on('data', (chunk) => {
        transferred += chunk.length;
        printProgress(transferred, fileSize);
      });

      writeStream.on('close', () => {
        console.log('\nDownload complete.');
        conn.end();
      });

      readStream.on('error', (err) => {
        console.error('\nDownload error:', err.message);
        conn.end(); process.exit(1);
      });

      readStream.pipe(writeStream);
    }
  });
}

function downloadDir(sftp, remoteDir, localDir, callback) {
  if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });

  sftp.readdir(remoteDir, (err, entries) => {
    if (err) {
      console.error(`Cannot read remote dir: ${remoteDir}: ${err.message}`);
      return callback();
    }

    let pending = entries.length;
    if (pending === 0) return callback();

    entries.forEach((entry) => {
      const remoteFull = remoteDir.replace(/\\/g, '/') + '/' + entry.filename;
      const localFull = path.join(localDir, entry.filename);

      if (entry.longname.startsWith('d')) {
        downloadDir(sftp, remoteFull, localFull, () => {
          if (--pending === 0) callback();
        });
      } else {
        console.log(`  ${remoteFull} -> ${localFull} (${formatSize(entry.attrs.size || 0)})`);
        const rs = sftp.createReadStream(remoteFull);
        const ws = fs.createWriteStream(localFull);
        ws.on('close', () => { if (--pending === 0) callback(); });
        rs.on('error', (err) => {
          console.error(`  Error: ${remoteFull}: ${err.message}`);
          if (--pending === 0) callback();
        });
        rs.pipe(ws);
      }
    });
  });
}

function doList(sftp, remotePath) {
  sftp.readdir(remotePath, (err, entries) => {
    if (err) {
      console.error(`Cannot list: ${remotePath}: ${err.message}`);
      conn.end(); process.exit(1);
    }

    console.log(`\n  Directory: ${remotePath}\n`);
    console.log(`  ${'Type'.padEnd(6)} ${'Size'.padStart(12)}  Name`);
    console.log(`  ${'----'.padEnd(6)} ${'----'.padStart(12)}  ----`);

    entries.forEach((e) => {
      const type = e.longname.startsWith('d') ? '<DIR>' : '     ';
      const size = e.attrs.size != null ? formatSize(e.attrs.size) : '';
      console.log(`  ${type.padEnd(6)} ${size.padStart(12)}  ${e.filename}`);
    });

    console.log(`\n  ${entries.length} item(s)\n`);
    conn.end();
  });
}

function doDelete(sftp, remotePath) {
  sftp.unlink(remotePath, (err) => {
    if (err) {
      console.error(`Delete failed: ${remotePath}: ${err.message}`);
      conn.end(); process.exit(1);
    }
    console.log(`Deleted: ${remotePath}`);
    conn.end();
  });
}

function doMkdir(sftp, remotePath) {
  sftp.mkdir(remotePath, (err) => {
    if (err) {
      console.error(`Mkdir failed: ${remotePath}: ${err.message}`);
      conn.end(); process.exit(1);
    }
    console.log(`Created directory: ${remotePath}`);
    conn.end();
  });
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function printProgress(transferred, total) {
  if (total === 0) return;
  const pct = Math.floor((transferred / total) * 100);
  const bar = '='.repeat(Math.floor(pct / 2)).padEnd(50);
  process.stdout.write(`\r  [${bar}] ${pct}% ${formatSize(transferred)}/${formatSize(total)}`);
}
