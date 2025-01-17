const express = require("express");
const WebSocket = require("ws");
const { SerialPort } = require("serialport");

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
app.get("/api/ports", async (req, res) => {
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
    console.log("WebSocket client connected");
    clientSocket = ws;
  
    // Handle messages from the client
    ws.on("message", async (message) => {
      const data = JSON.parse(message);

      console.log("Received message:", data);
  
      if (data.type === "connect") {
        // Connect to the selected serial port
        const { port, baudRate } = data;
  
        // If already connected, disconnect the current port first
        if (serialPort && serialPort.isOpen) {
          serialPort.close(() => console.log("Previous connection closed."));
        }
  
        try {
          serialPort = new SerialPort({
            path: port,
            baudRate: parseInt(baudRate, 10),
          });
  
          serialPort.on("data", (data) => {
            // Send received data to the client
            ws.send(JSON.stringify({ type: "output", message: data.toString() }));
          });
  
          serialPort.on("error", (err) => {
            ws.send(
              JSON.stringify({ type: "error", message: `Serial port error: ${err.message}` })
            );
          });
  
          ws.send(JSON.stringify({ type: "status", message: `Connected to ${port}` }));
          console.log(`Connected to ${port} at ${baudRate} baud.`);
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
                JSON.stringify({ type: "error", message: `Write error: ${err.message}` })
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
                JSON.stringify({ type: "status", message: "Serial port disconnected" })
              );
              serialPort = null;
            }
          });
        } else {
          ws.send(
            JSON.stringify({ type: "error", message: "No active serial port to disconnect" })
          );
        }
      }
    });
  
    // Handle client disconnection
    ws.on("close", () => {
      console.log("WebSocket client disconnected");
      if (serialPort && serialPort.isOpen) {
        serialPort.close(() => console.log("Serial port connection closed."));
        serialPort = null;
      }
    });
  });

