import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage, TimelineEntry, UserAction } from "@aha/contracts";

/** The backend's Timeline over the /ws WebSocket, and a way to send user actions. */
export function useTimeline() {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const socket = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    socket.current = ws;
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data) as ServerMessage;
      if (message.type === "snapshot") setEntries(message.entries);
      else if (message.type === "entry") setEntries((prev) => [...prev, message.entry]);
      else setError(message.message);
    };
    ws.onclose = () => setError("Disconnected from the Aha backend.");
    return () => ws.close();
  }, []);

  const dispatch = useCallback((action: UserAction) => {
    setError(null);
    const message: ClientMessage = { type: "action", action };
    socket.current?.send(JSON.stringify(message));
  }, []);

  return { entries, error, dispatch };
}
