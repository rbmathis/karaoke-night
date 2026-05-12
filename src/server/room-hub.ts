import "server-only";

import { EventEmitter } from "node:events";

type RoomRefreshEvent = {
  type: "refresh";
  roomCode: string;
  reason: string;
  at: string;
};

declare global {
  var __karaokeRoomHub: EventEmitter | undefined;
}

const roomHub = global.__karaokeRoomHub ?? new EventEmitter();
roomHub.setMaxListeners(0);
global.__karaokeRoomHub = roomHub;

export type RoomEvent = RoomRefreshEvent;

export function publishRoomEvent(roomCode: string, reason = "updated") {
  roomHub.emit(roomCode.toUpperCase(), {
    type: "refresh",
    roomCode: roomCode.toUpperCase(),
    reason,
    at: new Date().toISOString(),
  } satisfies RoomEvent);
}

export function subscribeRoomEvent(
  roomCode: string,
  listener: (event: RoomEvent) => void,
) {
  const normalized = roomCode.toUpperCase();
  roomHub.on(normalized, listener);

  return () => {
    roomHub.off(normalized, listener);
  };
}
