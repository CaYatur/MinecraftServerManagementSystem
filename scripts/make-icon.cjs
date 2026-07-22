// Rasterizes build/icon.svg -> build/icon.png (1024) + build/icon.ico (256)
// using Electron's canvas. Run: electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')
const pngToIcoModule = require('png-to-ico')
const pngToIco = typeof pngToIcoModule === 'function' ? pngToIcoModule : pngToIcoModule.default

const buildDir = path.join(__dirname, '..', 'build')
const svg = fs.readFileSync(path.join(buildDir, 'icon.svg'), 'utf8')

async function render(win, size) {
  const dataUrl = await win.webContents.executeJavaScript(`(async () => {
    const svg = ${JSON.stringify(svg)};
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const c = document.createElement('canvas'); c.width = ${size}; c.height = ${size};
    const ctx = c.getContext('2d'); ctx.clearRect(0, 0, ${size}, ${size});
    ctx.drawImage(img, 0, 0, ${size}, ${size});
    return c.toDataURL('image/png');
  })()`)
  return Buffer.from(dataUrl.split(',')[1], 'base64')
}

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 128, height: 128 })
  await win.loadURL('data:text/html,<html><body></body></html>')
  fs.writeFileSync(path.join(buildDir, 'icon.png'), await render(win, 1024))
  const png256 = path.join(buildDir, 'icon-256.png')
  fs.writeFileSync(png256, await render(win, 256))
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), await pngToIco([png256]))
  console.log('ICON: wrote build/icon.png (1024) + build/icon.ico (256)')
  app.exit(0)
})
