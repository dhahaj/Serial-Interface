const { app, BrowserWindow } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

let mainWindow;
let serverProcess;

app.whenReady().then(() => {

  serverProcess = spawn("node", [path.join(__dirname, "index.js")]);
  serverProcess.stdout.on("data", (data) => {
    console.log(`Server: ${data}`);
  });

  serverProcess.stderr.on("data", (data) => {
    console.error(`Server Error: ${data}`);
  });

  serverProcess.on("close", (code) => {
    console.log(`Server process exited with code ${code}`);
  });
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 1100,
    webPreferences: {
      nodeIntegration: true, // Allow Node.js integration in the frontend
    },
  });

  // Load the HTML file
  mainWindow.loadFile(path.join(__dirname, "public/index.html"));

  // Open DevTools (optional for debugging)
  mainWindow.webContents.openDevTools();

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

app.on("quit", () => {
  if (serverProcess) {
    serverProcess.kill(); // Ensure the server process is terminated when the app quits
  }
});