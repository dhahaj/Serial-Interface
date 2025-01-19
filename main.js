const { app, BrowserWindow } = require("electron");
const path = require("path");

let mainWindow;

app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true, // Allow Node.js integration in the frontend
    },
  });

  // Load the HTML file
  mainWindow.loadFile(path.join(__dirname, "public/index.html"));

  // Open DevTools (optional for debugging)
  // mainWindow.webContents.openDevTools();

  app.on("activate", () => {
    // Re-create the window if the app is re-opened on macOS
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
