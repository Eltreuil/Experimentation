// Application de bureau OpenBIM Studio (Electron) : charge le build web local.
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

function appIndex() {
  // En développement : ../dist ; une fois empaqueté : ressources/app/web
  const candidates = [path.join(__dirname, 'web', 'index.html'), path.join(__dirname, '..', 'dist', 'index.html')];
  return candidates.find((p) => fs.existsSync(p));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'OpenBIM Studio',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#eef1f4',
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  const index = appIndex();
  if (!index) {
    dialog.showErrorBox('OpenBIM Studio', "Build web introuvable. Lancez d'abord « npm run build » à la racine du projet.");
    app.quit();
    return;
  }
  win.loadFile(index);
  // Les liens externes s'ouvrent dans le navigateur par défaut.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

const template = [
  ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
  { label: 'Fichier', submenu: [{ role: 'reload', label: 'Recharger' }, { type: 'separator' }, { role: 'quit', label: 'Quitter' }] },
  { label: 'Édition', submenu: [{ role: 'cut', label: 'Couper' }, { role: 'copy', label: 'Copier' }, { role: 'paste', label: 'Coller' }] },
  {
    label: 'Affichage',
    submenu: [
      { role: 'resetZoom', label: 'Taille réelle' },
      { role: 'zoomIn', label: 'Agrandir' },
      { role: 'zoomOut', label: 'Réduire' },
      { type: 'separator' },
      { role: 'togglefullscreen', label: 'Plein écran' },
      { role: 'toggleDevTools', label: 'Outils de développement' },
    ],
  },
  { label: 'Aide', submenu: [{ label: 'Code source', click: () => shell.openExternal('https://github.com/Eltreuil/Experimentation') }] },
];

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
