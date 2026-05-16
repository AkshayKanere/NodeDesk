const { Client } = require('ssh2');
const readline = require('readline');

const CONFIG = {
  host: process.argv[2] || '100.64.1.39',
  port: parseInt(process.argv[3] || '2222', 10),
  username: process.argv[4] || 'admin',
  password: process.argv[5] || 'lrt@1234',
};

const mode = process.argv.includes('--exec')
  ? 'exec'
  : 'shell';

const execCmd = (() => {
  const idx = process.argv.indexOf('--exec');
  return idx !== -1 && process.argv[idx + 1] ? process.argv.slice(idx + 1).join(' ') : null;
})();

console.log(`Connecting to ${CONFIG.host}:${CONFIG.port} as ${CONFIG.username}...`);

const conn = new Client();

conn.on('ready', () => {
  console.log('Connected!\n');

  if (mode === 'exec' && execCmd) {
    conn.exec(execCmd, (err, stream) => {
      if (err) { console.error('Exec error:', err.message); conn.end(); return; }

      let exitCode = 0;
      stream.on('exit', (code) => { exitCode = code; });
      stream.on('close', () => {
        console.log(`\nCommand exited with code ${exitCode}`);
        conn.end();
      });

      stream.on('data', (data) => process.stdout.write(data));
      stream.stderr.on('data', (data) => process.stderr.write(data));
    });
  } else {
    conn.shell({ term: 'xterm-256color', cols: process.stdout.columns || 80, rows: process.stdout.rows || 24 }, (err, stream) => {
      if (err) { console.error('Shell error:', err.message); conn.end(); return; }

      if (process.stdin.setRawMode) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();

      process.stdin.pipe(stream);
      stream.pipe(process.stdout);
      stream.stderr.pipe(process.stderr);

      stream.on('close', () => {
        console.log('\nSession closed.');
        if (process.stdin.setRawMode) process.stdin.setRawMode(false);
        conn.end();
      });

      process.stdout.on('resize', () => {
        stream.setWindow(
          process.stdout.rows || 24,
          process.stdout.columns || 80,
          0, 0
        );
      });
    });
  }
});

conn.on('error', (err) => {
  console.error('Connection error:', err.message);
  process.exit(1);
});

conn.on('close', () => {
  process.exit(0);
});

conn.connect({
  host: CONFIG.host,
  port: CONFIG.port,
  username: CONFIG.username,
  password: CONFIG.password,
  readyTimeout: 10000,
  keepaliveInterval: 5000,
  keepaliveCountMax: 3,
  algorithms: {
    kex: [
      'ecdh-sha2-nistp256',
      'ecdh-sha2-nistp384',
      'ecdh-sha2-nistp521',
      'diffie-hellman-group14-sha256',
      'diffie-hellman-group14-sha1',
    ],
    cipher: [
      'aes128-ctr',
      'aes192-ctr',
      'aes256-ctr',
      'aes128-gcm@openssh.com',
      'aes256-gcm@openssh.com',
    ],
  },
});
