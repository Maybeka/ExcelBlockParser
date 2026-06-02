# Packaging Guide — Excel Block Parser

## Quick Start — Electron

```bash
# 1. Build the source
npm run build

# 2. Package for current OS
npm run pack:mac     # macOS → .dmg
npm run pack:win     # macOS/Windows → .exe installer
npm run pack:linux   # → .AppImage

# 3. Package for all platforms (macOS host only)
npm run pack:all
```

Output in `release/` directory.

---

## Quick Start — Wails

```bash
# 1. Prerequisites (one time)
# - Install Go: https://go.dev/dl/
# - Install Wails CLI: go install github.com/wailsapp/wails/v2/cmd/wails@latest
# - macOS: xcode-select --install
# - Windows: install WebView2 runtime (pre-installed on Win 10+)
# - Linux: sudo apt install libgtk-3-dev libwebkit2gtk-4.0-dev

# 2. Build frontend + backend
wails build

# 3. Output
# macOS:   build/bin/excel-block-parser.app
# Windows: build/bin/excel-block-parser.exe
# Linux:   build/bin/excel-block-parser
```

---

## Prerequisites

### All platforms
```bash
npm install
```

### macOS (for macOS targets)
- Xcode Command Line Tools: `xcode-select --install`
- For notarized builds: Apple Developer account ($99/year)

### Windows (for Windows targets)
- **From macOS**: No extra tools needed (electron-builder cross-compiles)
- **From Windows**: Visual Studio Build Tools with C++ workload, or just `npm install --global windows-build-tools`

---

## Step-by-step Packaging

### Step 1 — Verify build works locally
```bash
npm run dev
```
Open the Electron window. Confirm everything loads — close when done.

### Step 2 — Production build
```bash
npm run build
```
This produces `out/` with:
- `out/main/index.js` — main process
- `out/preload/index.js` — preload bridge
- `out/renderer/` — the React app (HTML + JS + CSS)

### Step 3 — Package for target OS

#### macOS (produces `.dmg`)
```bash
npm run pack:mac
```
Output: `release/Excel Block Parser-0.1.0-arm64.dmg` (Apple Silicon)
Output: `release/Excel Block Parser-0.1.0-x64.dmg` (Intel)

#### Windows (produces `.exe` installer)
```bash
# From macOS (cross-compile):
npm run pack:win

# From Windows (native):
npm run pack:win
```
Output: `release/Excel Block Parser Setup 0.1.0.exe`

#### Linux (produces `.AppImage`)
```bash
npm run pack:linux
```

### Step 4 — Test the packaged app
- **macOS**: Double-click the `.dmg`, drag to Applications, launch
- **Windows**: Run the `.exe` installer, launch from Start Menu
- **Linux**: `chmod +x *.AppImage && ./*.AppImage`

---

## Adding a Custom Icon

1. Create a 512×512 PNG icon: `resources/icon.png`
2. For macOS: convert to `.icns` format
   ```bash
   # On macOS:
   mkdir icon.iconset
   sips -z 16 16   icon.png --out icon.iconset/icon_16x16.png
   sips -z 32 32   icon.png --out icon.iconset/icon_16x16@2x.png
   sips -z 32 32   icon.png --out icon.iconset/icon_32x32.png
   sips -z 64 64   icon.png --out icon.iconset/icon_32x32@2x.png
   sips -z 128 128 icon.png --out icon.iconset/icon_128x128.png
   sips -z 256 256 icon.png --out icon.iconset/icon_128x128@2x.png
   sips -z 256 256 icon.png --out icon.iconset/icon_256x256.png
   sips -z 512 512 icon.png --out icon.iconset/icon_256x256@2x.png
   sips -z 512 512 icon.png --out icon.iconset/icon_512x512.png
   iconutil -c icns icon.iconset
   mv icon.icns resources/
   ```
3. For Windows: convert to `.ico` format (use online converter)
4. Update `package.json` `build.win.icon` from `null` to `"resources/icon.ico"`

---

## Cross-Compilation Matrix

| Building on | → macOS target | → Windows target | → Linux target |
|-------------|----------------|------------------|----------------|
| **macOS** | ✅ native | ✅ cross-compile | ✅ cross-compile |
| **Windows** | ❌ not possible | ✅ native | ✅ cross-compile |
| **Linux** | ❌ not possible | ✅ cross-compile | ✅ native |

**Best strategy**: Build all targets from macOS.

---

## Code Signing (optional, for distribution)

### macOS notarization
```bash
# Set environment variables
export APPLE_ID="your@email.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="YOURTEAMID"

# Then package — electron-builder auto-notarizes
npm run pack:mac
```

### Windows code signing
Purchase a code signing certificate (e.g., DigiCert), then:
```json
// In package.json "build.win":
"certificateFile": "path/to/cert.pfx",
"certificatePassword": "your-password"
```

---

## About Wails vs Electron

This project supports **both** packaging methods. The same React frontend (`src/renderer/`) works with both runtimes via a unified bridge (`src/renderer/services/bridge.ts`):

| | Electron | Wails |
|---|---|---|
| **Backend** | Node.js (`src/main/`) | Go (`app.go`, `main.go`) |
| **IPC** | `contextBridge` | Wails runtime bindings |
| **Binary size** | ~180 MB (.dmg) | ~15 MB (.app) |
| **Memory** | ~200 MB baseline | ~50 MB baseline |
| **File dialogs** | Native Electron | Native Wails runtime |
| **Build** | `npm run pack:mac` | `wails build` |

**When to use Electron**: if you need Node.js ecosystem, complex main-process logic, or are already on Electron.
**When to use Wails**: if you want smaller binaries, lower memory, or prefer Go for backend logic.

---

## Transfer & Install

### To another macOS machine
1. Copy the `.dmg` file
2. Open it, drag `Excel Block Parser.app` to Applications
3. Right-click → Open (first launch bypasses Gatekeeper)

### To another Windows machine
1. Copy the `.exe` installer
2. Run it, choose install directory
3. Launch from desktop shortcut or Start Menu

### Source-only transfer (for rebuilding anywhere)
```bash
tar -czf excel-block-parser-src.tar.gz \
  --exclude='node_modules' --exclude='out' --exclude='release' \
  src/ resources/ examples/ tests/ \
  package.json package-lock.json tsconfig*.json electron.vite.config.ts playwright.config.ts
```

Then on the target machine:
```bash
tar -xzf excel-block-parser-src.tar.gz
cd excel-block-parser
npm install
npm run pack:mac    # or pack:win / pack:linux
```
