const express = require("express");
const WebSocket = require("ws");
const { SerialPort } = require("serialport");
const { exec } = require("child_process");
const path = require("path");
const { Board, Led, Pin } = require("johnny-five");

let batteryPin, lowBatteryPin, indicatorPin;

const board = new Board({
  port: "COM15",
});


const app = express();
const port = 3000;

app.use(express.static("public"));

const server = app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

const wss = new WebSocket.Server({ server });

let serialPort = null; // Holds the active SerialPort instance
let clientSocket = null; // Stores the WebSocket connection to the client

// Endpoint to get available serial ports
app.get("http://localhost:3000/api/ports", async (req, res) => {
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
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Another client is already connected.",
      })
    );
    ws.close();
    return;
  }

  console.log("WebSocket client connected");
  clientSocket = ws;

  // Handle messages from the client
  ws.on("message", async (message) => {
    const data = JSON.parse(message);
    console.log("Received message:", data);

    if (data.type === "connect") {
      // Connect to the selected serial port
      const { port } = data;

      // If already connected, disconnect the current port first
      if (serialPort && serialPort.isOpen) {
        serialPort.close(() => console.log("Previous connection closed."));
      }

      try {
        serialPort = new SerialPort({
          path: port,
        });

        serialPort.on("data", (data) => {
          // Send received data to the client
          ws.send(JSON.stringify({ type: "output", message: data.toString() }));
        });

        serialPort.on("error", (err) => {
          ws.send(
            JSON.stringify({
              type: "error",
              message: `Serial port error: ${err.message}`,
            })
          );
        });

        ws.send(
          JSON.stringify({ type: "status", message: `Connected to ${port}` })
        );
        console.log(`Connected to ${port}.`);
      } catch (error) {
        console.error("Error connecting to serial port:", error);
        ws.send(
          JSON.stringify({
            type: "error",
            message: `Failed to connect to ${port}: ${error.message}`,
          })
        );
      }
    } else if (data.type === "send") {
      console.log("Sending data:", data.message);
      // Send data to the serial port
      if (serialPort && serialPort.isOpen) {
        serialPort.write(data.message, (err) => {
          if (err) {
            console.error("Error writing to serial port:", err);
            ws.send(
              JSON.stringify({
                type: "error",
                message: `Write error: ${err.message}`,
              })
            );
          }
        });
      } else {
        console.log("Cannot send data. No active serial port connection.");
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Cannot send data. No active serial port connection.",
          })
        );
      }
    } else if (data.type === "disconnect") {
      // Disconnect from the serial port
      if (serialPort && serialPort.isOpen) {
        serialPort.close((err) => {
          if (err) {
            console.error("Error disconnecting serial port:", err);
            ws.send(
              JSON.stringify({
                type: "error",
                message: `Disconnect error: ${err.message}`,
              })
            );
          } else {
            console.log("Serial port disconnected.");
            ws.send(
              JSON.stringify({
                type: "status",
                message: "Serial port disconnected",
              })
            );
            serialPort = null;
          }
        });
      } else {
        ws.send(
          JSON.stringify({
            type: "error",
            message: "No active serial port to disconnect",
          })
        );
      }
    } else if (data.type === "openProgram") {
      ws.send(
        JSON.stringify({ type: "output", message: "Programming board..." })
      );

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
          ws.send(
            JSON.stringify({
              type: "error",
              message: `Failed to open program: ${error.message}`,
            })
          );
          return;
        }
        ws.send(
          JSON.stringify({
            type: "success",
            message: `Program opened successfully: ${stdout || stderr}`,
          })
        );
        ws.send(JSON.stringify({ type: "callback", message: "test" }));
      });
    } else if (data.type === "test") {
      test(ws);
    }
  });

  // Handle client disconnection
  ws.on("close", () => {
    console.log("WebSocket client disconnected");
    if (serialPort && serialPort.isOpen) {
      serialPort.close(() => console.log("Serial port connection closed."));
      serialPort = null;
    }
    clientSocket = null;
  });
});

board.on("ready", () => {
  console.log("Board connected");

   batteryPin = new Pin({ pin: 4, type: "digital", mode: board.MODES.OUTPUT, board });
   lowBatteryPin = new Pin({ pin: 2, type: "digital", mode: board.MODES.OUTPUT, board });
   indicatorPin = new Pin({ pin: 13, type: "digital", mode: board.MODES.OUTPUT, board });

  // indicatorPin.low(); // Turn on the indicator

  var i = 0;

  setInterval(() => {
    if (clientSocket && !testRunning) {
      if (indicatorPin.isOn) {
        indicatorPin.low();
      } else {
        indicatorPin.high();
      }
    } else if (indicatorPin.isOn && !clientSocket) {
      indicatorPin.low();
    }
  }, 250);

  console.log("LED blinking on pin 13");
});

board.on("exit", () => {
  console.log("Board disconnected");
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

var testRunning = false;

async function test(ws) {
  testRunning = true;

  ws.send(JSON.stringify({ type: "output", message: "\nStarting test..." }));

  indicatorPin.mode = board.MODES.OUTPUT;
  lowBatteryPin.mode = board.MODES.OUTPUT;
  batteryPin.mode = board.MODES.OUTPUT;

  indicatorPin.high(); // Turn on the indicator LED

  await delay(2000);

  // board.pinMode(2, board.MODES.OUTPUT); // Low Battery
  // board.pinMode(4, board.MODES.OUTPUT); // Battery power
  // board.pinMode(13, board.MODES.OUTPUT); // LED
  
  batteryPin.mode = board.MODES.OUTPUT;
  lowBatteryPin.mode = board.MODES.OUTPUT;
  indicatorPin.mode = board.MODES.OUTPUT;

  
  ws.send(JSON.stringify({ type: "output", message: "Low Battery active" }));
  lowBatteryPin.high(); // Turn on the low battery indicator
  
  await delay(4000);
  
  ws.send(JSON.stringify({ type: "output", message: "Battery power on" }));
  batteryPin.high(); // Turn on the battery power

  await delay(3000);

  board.digitalWrite(2, 0); // Low Battery inactive
  lowBatteryPin.low();
  ws.send(JSON.stringify({ type: "output", message: "Low Battery inactive" }));

  await delay(2000);

  batteryPin.low();
  ws.send(JSON.stringify({ type: "output", message: "Battery power off" }));

  await delay(2000);

  ws.send(JSON.stringify({ type: "output", message: "Testing complete\n" }));

  await delay(1000);

  ws.send(JSON.stringify({ type: "callback", message: "test" }));

  testRunning = false;
}
