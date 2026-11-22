import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage, TimelineEntry, UserAction } from "@aha/contracts";

/** The backend's Timeline over the /ws WebSocket, and a way to send user actions. */
export function useTimeline() {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const socket = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
      socket.current = ws;
      ws.onopen = () => setError(null);
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data) as ServerMessage;
        if (message.type === "snapshot") setEntries(message.entries);
        else if (message.type === "entry") setEntries((prev) => [...prev, message.entry]);
        else setError(message.message);
      };
      // The backend restarts during development: say so and reconnect; the snapshot restores the Timeline.
      ws.onclose = () => {
        if (closed) return;
        setError("Disconnected from the Aha backend. Reconnecting…");
        retry = setTimeout(connect, 1000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      socket.current?.close();
    };
  }, []);

  const dispatch = useCallback((action: UserAction) => {
    setError(null);
    const message: ClientMessage = { type: "action", action };
    socket.current?.send(JSON.stringify(message));
  }, []);

  return { entries, error, dispatch };
}
