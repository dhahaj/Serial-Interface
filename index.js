const express = require("express");
const WebSocket = require("ws");
const { SerialPort } = require("serialport");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const { createLogger, format, transports } = require("winston");
const { Board, Led, Pin, PinMode } = require("johnny-five");

let board;
let batteryPin, lowBatteryPin, indicatorPin, inputPin;

const app = express();
const port = 3000;

app.use(express.static("public"));

const server = app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

const wss = new WebSocket.Server({ server });

let clientSocket = null; // Stores the WebSocket connection to the client

// Endpoint to get the current serial port connection
app.get("/api/ports", async (req, res) => {
  console.log("GET /api/ports");
  try {
    const ports = await SerialPort.list(); // Use SerialPort.list() as a static method
    res.json(ports.map((p) => p.path)); // Send only the paths to the frontend
  } catch (error) {
    console.error("Error fetching ports:", error);
    res.status(500).send("Error fetching ports");
  }
});


// WebSocket server logic
wss.on("connection", (ws) => {
  if (clientSocket) {
    console.log("Client already connected. Closing new connection.");
    logger.info("Client already connected. Closing new connection.");
    ws.send(JSON.stringify({type: "error",message: "Another client is already connected.",}));
    ws.close();
    return;
  }

  console.log("WebSocket client connected");
  logger.info("WebSocket client connected");
  clientSocket = ws;

  // Send configuration file data when a client connects
  const configPath = path.join(__dirname, "config.json");
  const config = readConfigFile(configPath);
  if (config) {
    ws.send(JSON.stringify({ type: "config", data: config }));
  } else {
    ws.send(JSON.stringify({ type: "error", message: "Failed to load config file" }));
  }

  sendPorts(ws);

  // Handle messages from the client
  ws.on("message", async (message) => {
    const data = JSON.parse(message);
    console.log("Received message:", data);
    logger.info(`Received message: ${JSON.stringify(data)}`);

    if (data.type === "connect") {
      // Connect to the selected serial port
      const { port } = data;

      try {

      if (board && board.isReady) {
        ws.send(JSON.stringify({ type: "error", message: "Board already connected" }));
        return;
      }

        board = new Board({
          port,
          repl: false,
        });

        board.on("ready", () => {
          console.log("Board connected");

          batteryPin = new Pin({
            pin: 4,
            type: "digital",
            mode: board.MODES.OUTPUT,
          });
          lowBatteryPin = new Pin({
            pin: 2,
            type: "digital",
            mode: board.MODES.OUTPUT,
          });
          indicatorPin = new Led(13);
          inputPin = new Pin({
            pin: 7,
            type: "digital",
            mode: board.MODES.INPUT,
          });

          // ws.send(JSON.stringify({ type: "status", message: "Board ready" }));

          sendMsg(ws, "connected", `Board connected on port ${port}`);

          setInterval(toggleLED, 100);
        });

        board.on("exit", () => {
          console.log("Board disconnected");
          batteryPin = null;
          lowBatteryPin = null;
          indicatorPin = null;
          ws.send(JSON.stringify({ type: "error", message: "Board disconnected" }));
          sendMsg(ws, "disconnected", "Board disconnected");
        });
      } catch (error) {
        board = null;
        console.error("Error connecting to board:", error);
        ws.send(JSON.stringify({ type: "error", message: error.message }));
      }

    } else if (data.type === "send") {
      console.log("Sending data:", data.message);
    } else if (data.type === "disconnect") {
      if (board) {
        console.log("Disconnecting board");

        // Cleanup Johnny-Five board
        board.io.reset(); // Reset the board (if supported)
        board.emit("exit"); // Emit the 'exit' event for manual cleanup
        board.emit("close"); // Emit the 'exit' event for manual cleanup
        board = null; // Clear the board instance

        // Clear pin references
        batteryPin = null;
        lowBatteryPin = null;
        indicatorPin = null;

        // Notify the client
        ws.send(JSON.stringify({type: "disconnected",message: "Board disconnected successfully",}));
        console.log("Board disconnected successfully");
      } else {
        ws.send(JSON.stringify({type: "error",message: "No active board to disconnect",}));
        console.log("No active board to disconnect");
      }
    } else if (data.type === "openProgram") {
      ws.send(JSON.stringify({ type: "output", message: "Programming board..." }));

      const { path: programPath, params } = data; // Program path and parameters

      // Resolve relative paths in parameters
      const resolvedParams = params.map((param) =>
        param.startsWith("./") ? param.substring(2) : param
      );

      // Construct the command
      const command = `"${programPath}" ${resolvedParams.join(" ")}`;

      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error: ${error.message}`);
          ws.send(JSON.stringify({type: "error",message: `Failed to open program: ${error.message}`,}));
          return;
        }
        ws.send(JSON.stringify({type: "success",message: `Program opened successfully: ${stdout || stderr}`,}));
        ws.send(JSON.stringify({ type: "callback", message: "test" }));
      });
    } else if (data.type === "test") {
      if (board) {
        const { speed } = data;
        test(ws, speed);
      } else {
        ws.send(JSON.stringify({type: "error",message: "Board not connected. Please connect the board first.",}));
      }
    } else if (data.type === "is_connected") {
      if (board) {
        ws.send(JSON.stringify({ type: "connected", port: board.io.port }));
      } else {
        ws.send(JSON.stringify({ type: "disconnected" }));
      }
    } else if (data.type === "ports") {
      try {
        const ports = await SerialPort.list(); // Use SerialPort.list() as a static method
        // ws.send(JSON.stringify({ type: "ports", data: ports.map((p) => p.path) }));
        sendData(ws, { type: "ports", data: ports.map((p) => p.path) });
      } catch (error) {
        console.error("Error fetching ports:", error);
        sendMsg(ws, "error", "Error fetching ports");
      }
    } else if (data.type === "saveConfig") {
      const configPath = path.join(__dirname, "config.json");
      try {
        fs.writeFileSync(configPath, JSON.stringify(data.data, null, 2), "utf-8");
        ws.send(JSON.stringify({ type: "success", message: "Configuration saved successfully." }));
      } catch (error) {
        console.error("Error saving configuration:", error.message);
        ws.send(JSON.stringify({ type: "error", message: "Failed to save configuration." }));
      }
    }
  });

  // Handle client disconnection
  ws.on("close", () => {
    console.log("WebSocket client disconnected");
    logger.info("WebSocket client disconnected");
    clientSocket = null;
  });
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

var testRunning = false;

async function test(ws, speed) {
  testRunning = true;

  ws.send(JSON.stringify({ type: "output", message: "\nStarting test..." }));

  indicatorPin.on();

  await delay((2000 * speed) / 100);

  ws.send(JSON.stringify({ type: "output", message: "Low Battery active" }));
  lowBatteryPin.high(); // Turn on the low battery indicator

  await delay((4000 * speed) / 100);

  ws.send(JSON.stringify({ type: "output", message: "Battery power on" }));
  batteryPin.high(); // Turn on the battery power

  await delay((3000 * speed) / 100);

  board.digitalWrite(2, 0); // Low Battery inactive
  lowBatteryPin.low();
  ws.send(JSON.stringify({ type: "output", message: "Low Battery inactive" }));

  await delay((2000 * speed) / 100);

  batteryPin.low();
  ws.send(JSON.stringify({ type: "output", message: "Battery power off" }));

  await delay((2000 * speed) / 100);

  ws.send(JSON.stringify({ type: "output", message: "Testing complete\n" }));
  indicatorPin.off();

  await delay((1000 * speed) / 100);

  ws.send(JSON.stringify({ type: "callback", message: "test" }));

  testRunning = false;
}

// blink the LED
async function toggleLED() {
  if (!testRunning && indicatorPin) {
    indicatorPin.toggle();
  }
}

// send port list 
async function sendPorts(ws) {
  try {
    const ports = await SerialPort.list(); // Use SerialPort.list() as a static method
    console.log("Sending ports:", JSON.stringify({ type: "ports", data: ports.map((p) => p.path) }));
    sendData(ws, { type: "ports", data: ports.map((p) => p.path) });
  } catch (error) {
    console.error("Error fetching ports:", error);
    sendMsg(ws, "error", "Error fetching ports");
  }
}


function sendMsg(ws, type, message) {
  ws.send(JSON.stringify({ type, message }));
  logger.info(`Sent message: ${type} - ${message}`);
}

function sendData(ws, data) {
  ws.send(JSON.stringify(data));
  logger.info(`Sent data: ${JSON.stringify(data)}`);
}

// Function to read the configuration file
function readConfigFile(filePath) {
  try {
    const configData = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(configData); // Assuming JSON format
  } catch (error) {
    console.error("Error reading configuration file:", error.message);
    return null;
  }
}

// const logger = require("./logger");

const logger = createLogger({
  level: "info", // Minimum level to log ("error", "warn", "info", "verbose", "debug", "silly")
  format: format.combine(
    format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    format.printf(({ timestamp, level, message }) => `${timestamp} [${level}]: ${message}`)
  ),
  transports: [
    new transports.Console(), // Log to console
    new transports.File({ filename: "logs/app.log" }) // Log to a file
  ],
});

module.exports = logger;