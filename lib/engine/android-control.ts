import { once } from "node:events";
import type { Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { androidDisplay, EngineError, type InputDisplay } from "./android";
import { openScrcpy } from "./scrcpy";

function tapEvents(x: number, y: number, width: number, height: number) {
  // scrcpy 3.3.4 INJECT_TOUCH_EVENT: type, action, pointer ID, position, pressure, buttons.
  const down = Buffer.alloc(32);
  down[0] = 2;
  down.writeBigInt64BE(-2n, 2); // Generic finger.
  down.writeUInt32BE(Math.round(x * (width - 1)), 10);
  down.writeUInt32BE(Math.round(y * (height - 1)), 14);
  down.writeUInt16BE(width, 18);
  down.writeUInt16BE(height, 20);
  down.writeUInt16BE(0xffff, 22);
  const up = Buffer.from(down);
  up[1] = 1;
  up.writeUInt16BE(0, 22);
  return { down, up };
}

function writeEvent(socket: Socket, event: Buffer) {
  if (!socket.writable) throw new EngineError("CONTROL_UNAVAILABLE");
  return new Promise<void>((resolve, reject) => {
    socket.write(event, (error) => error ? reject(error) : resolve());
  });
}

// The caller holds the run's exclusive device claim for the entire gesture.
export async function doubleTapAndroid(serial: string, x: number, y: number, gap: number, signal: AbortSignal, display?: InputDisplay) {
  signal.throwIfAborted();
  const { socket, cleanup } = await openScrcpy(serial, display ? { controlDisplay: display.id } : "control");
  // Drain the control socket and keep errors observable until the gesture ends.
  socket.on("error", () => undefined);
  socket.setNoDelay(true);
  socket.resume();
  try {
    signal.throwIfAborted();
    const { width, height } = display ?? await androidDisplay(serial);
    signal.throwIfAborted();
    const { down, up } = tapEvents(x, y, width, height);
    async function tap() {
      signal.throwIfAborted();
      await writeEvent(socket, down);
      // Finish the short press even if the run is cancelled after DOWN.
      await delay(30);
      await writeEvent(socket, up);
    }
    try {
      await tap();
      await delay(gap, undefined, { signal });
      await tap();
    } finally {
      // Give Android time to consume the final UP before closing the ADB tunnel.
      await delay(100);
      if (!socket.writable) throw new EngineError("CONTROL_UNAVAILABLE");
      const closed = once(socket, "close", { signal: AbortSignal.timeout(1500) });
      socket.end();
      const [failed] = await closed;
      if (failed) throw new EngineError("CONTROL_UNAVAILABLE");
    }
    signal.throwIfAborted();
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof EngineError) throw error;
    throw new EngineError("CONTROL_UNAVAILABLE");
  } finally {
    socket.destroy();
    cleanup();
  }
}
