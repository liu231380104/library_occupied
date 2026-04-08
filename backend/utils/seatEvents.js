const { EventEmitter } = require("events");

const seatEventEmitter = new EventEmitter();
seatEventEmitter.setMaxListeners(0);

function broadcastSeatUpdate(payload = {}) {
  seatEventEmitter.emit("seat-update", {
    area: String(payload.area || "").trim(),
    source: String(payload.source || "system").trim(),
    reason: String(payload.reason || "seat-changed").trim(),
    seatIds: Array.isArray(payload.seatIds) ? payload.seatIds : [],
    seatId: Number.isFinite(Number(payload.seatId)) ? Number(payload.seatId) : null,
    detectedAt: Date.now(),
  });
}

function subscribeSeatUpdates(listener) {
  seatEventEmitter.on("seat-update", listener);
  return () => seatEventEmitter.off("seat-update", listener);
}

module.exports = {
  broadcastSeatUpdate,
  subscribeSeatUpdates,
};