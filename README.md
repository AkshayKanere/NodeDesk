# NodeDesk

A portable, browser-based remote desktop and file manager powered by Node.js. No installation or admin rights required on either the server or client side — access any machine from a web browser.

## Why NodeDesk?

Traditional remote desktop tools like VNC require server software installation and often need administrator privileges. NodeDesk was built to solve these problems:

- **No admin rights required** — Runs as a regular user on both the server and client machine
- **No client installation** — Access your remote machine from any device with a web browser
- **Portable** — Copy the folder to any machine, run `install.bat`, and you're ready
- **Works everywhere** — Pure Node.js, runs on Windows and Linux without native compilation hassles (not tested on Linux)

## Features

### FTP-Like File Manager

A full-featured browser-based file manager for browsing and managing remote filesystems — works like a traditional FTP client, right in your browser.

- **Drive sidebar** — Left panel lists all available drives (with free/total space info) for one-click navigation
- **Quick Access shortcuts** — Home, Desktop, Downloads, Documents, Pictures, Videos, and Music folders in the sidebar for instant access
- **Directory navigation** — Back, Up, and Refresh buttons; editable address bar with Go button
- **Parent directory** (`..`) row for quick navigation up
- **Path history** — Back button navigates through previously visited directories
- **Column sorting** — Click Name, Size, or Modified headers to sort; folders always stay on top
- **Upload files** — Upload multiple files at once
- **Upload folders** — Upload entire directories
- **Download files** — Download any file directly to your machine
- **Create directories** — New Folder button with modal dialog
- **Smart file icons** — Context-aware icons for images, videos, audio, archives, code, documents, executables, and more
- **Status bar** — Shows folder count, file count, and total size of current directory

### Remote Desktop

- Live desktop streaming via WebSocket (up to 20 FPS, default 10 FPS)
- Remote mouse control (click, drag, scroll, right-click)
- Remote keyboard input (full key support including modifiers)
- Autofit display to browser window
- Fullscreen mode
- Single screenshot capture
- Desktop controls (Start Stream, Screenshot, Fullscreen, Enable Control) only appear when the Desktop tab is active

### SSH Server & Client

- Built-in SSH server with SFTP support
- Command-line SSH client for interactive shell
- File transfer client (upload, download, list, delete, mkdir)
- Recursive folder transfer with progress bars

## Requirements

- [Node.js](https://nodejs.org) 16 or later
- No administrator/root privileges needed
- Server and client machines must be on the **same network** — either a local LAN or connected via VPN

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Generate SSH host keys (optional, for SSH server)
node generate-key.js

# 3. Start the web server
node web-server.js
```

Open `http://localhost:8080` in your browser.

On Windows, double-click `install.bat` for setup, then `start-web.bat` to run.

## Password & Login

By default, NodeDesk has no password and anyone with the URL can access it. To secure your instance:

### Setting a password

Choose any one of these methods:

1. **Browser Settings tab** — Open the Settings tab, enter a password, and click Save
2. **Environment variable** — Set `WEB_PASS` before starting the server:
   ```bash
   # Windows
   set WEB_PASS=mysecretpassword
   node web-server.js

   # Linux
   WEB_PASS=mysecretpassword node web-server.js
   ```
3. **config.json** — Create or edit `config.json` in the project root:
   ```json
   {
     "port": 8080,
     "host": "0.0.0.0",
     "password": "mysecretpassword"
   }
   ```

### Login page

When a password is configured, clients opening the web interface will see a **login page** before they can access any functionality. After entering the correct password, the full interface (Files, Desktop, Logs, Settings, About) becomes available. A **Logout** button appears in the top-right corner of the navbar to end the session.

If no password is set, the login page is skipped and the interface loads directly.

## Usage

### Web Server (browser access)

```bash
node web-server.js
```

Or on Windows:

```
start-web.bat
```

### System Tray Mode (Windows, recommended)

Double-click `start-tray.bat` to launch the web server minimized to the **system tray** — no console window is shown. The tray icon provides:

- **Double-click** the tray icon to open NodeDesk in your browser
- **Right-click** for a context menu with:
  - Open in Browser
  - Restart Server
  - Exit
- A balloon notification on startup confirming the server is running
- Automatic server restart if it crashes

This is the recommended way to run NodeDesk on Windows for unattended, background operation.

Open `http://<machine-ip>:8080` from any browser. The web interface has five tabs:

| Tab | Description |
|-----|-------------|
| Files | FTP-like file manager with drive sidebar, quick access shortcuts, navigation, upload, and download |
| Desktop | Remote desktop with live stream and mouse/keyboard control |
| Logs | Client-side activity log |
| Settings | Server configuration (port, host, password) |
| About | Author and project information |

### SSH Server

```bash
node server.js
```

### SSH Client (command line)

```bash
# Interactive shell
node client.js <host> <port> <user> <password>

# Execute a single command
node client.js <host> <port> <user> <password> --exec "ipconfig /all"
```

### File Transfer (command line)

```bash
node transfer.js upload   <local-path> <remote-path> [host] [port] [user] [pass]
node transfer.js download <remote-path> <local-path>  [host] [port] [user] [pass]
node transfer.js list     <remote-path>               [host] [port] [user] [pass]
node transfer.js delete   <remote-path>               [host] [port] [user] [pass]
node transfer.js mkdir    <remote-path>               [host] [port] [user] [pass]
```

## Configuration

Settings can be configured in three ways (in order of priority):

1. **Browser Settings tab** — saved to `config.json`
2. **Environment variables** — `WEB_PORT`, `WEB_PASS`
3. **config.json** — auto-created when saving from the browser

| Setting | Default | Env Variable | Description |
|---------|---------|--------------|-------------|
| Port | 8080 | WEB_PORT | Web server port |
| Password | *(empty)* | WEB_PASS | Leave empty to disable auth |
| Host | 0.0.0.0 | — | Bind address |

## Batch Files (Windows)

| File | Description |
|------|-------------|
| `install.bat` | Install dependencies and generate keys |
| `start-tray.bat` | Start web server minimized to system tray (recommended) |
| `start-web.bat` | Start web server in console (auto-restarts on crash) |
| `start-server.bat` | Start SSH server (auto-restarts on crash) |
| `connect.bat` | SSH client (interactive shell) |
| `run-command.bat` | Execute a single remote command |
| `upload.bat` | Upload files via SSH/SFTP |
| `download.bat` | Download files via SSH/SFTP |
| `list-remote.bat` | List remote directory via SSH/SFTP |

## Architecture

```
nodedesk/
  web-server.js        - Web server (HTTP + WebSocket)
  server.js            - SSH server (shell + SFTP)
  client.js            - SSH client
  transfer.js          - SFTP file transfer client
  capture-worker.ps1   - Persistent screen capture (Windows)
  generate-key.js      - RSA key generator
  config.json          - Server settings (auto-created)
  public/
    index.html         - Web interface (single-page app)
  keys/
    host_key           - SSH host key (auto-generated)
    host_key.pub       - SSH public key
```

## Reliability

NodeDesk is designed for long-running, unattended operation:

- **Auto-restart** — Batch files restart the server automatically on crash
- **Error recovery** — Uncaught exceptions and unhandled rejections are caught and logged, not fatal
- **Graceful shutdown** — SIGINT/SIGTERM handlers clean up child processes and connections
- **Health logging** — Memory and connection stats logged every 5 minutes
- **Client resilience** — Clients can connect and disconnect freely without affecting the server
- **Capture worker** — Persistent screen capture process, auto-restarts if it dies

## Security Notes

- No admin rights are needed — the server runs entirely in user space.
- By default, authentication is disabled (no password). Set a password for any deployment beyond localhost.
- When a password is set, a login page is shown to all clients before granting access.
- The server binds to `0.0.0.0` (all interfaces) by default.
- Traffic is not encrypted over HTTP. For production use over untrusted networks, consider placing behind a reverse proxy with TLS.
- The SSH server uses encrypted SSH protocol.

## Author

**Akshay Kanere**
Email: [thegr8akshay@gmail.com](mailto:thegr8akshay@gmail.com)

## License

MIT
