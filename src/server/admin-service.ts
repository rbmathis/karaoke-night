import "server-only";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import type { AdminState } from "@/lib/admin-types";
import { getDatabase } from "@/server/db/client";
import { publishRoomEvent } from "@/server/room-hub";
import {
  encoreVotes,
  playbackHistory,
  profiles,
  queueItems,
  reactions,
  roomParticipants,
  rooms,
  songs,
} from "@/server/db/schema";

function nowIso() {
  return new Date().toISOString();
}

function createPublicError(message: string, status = 400) {
  const error = new Error(message);
  Object.assign(error, {
    status,
  });
  return error;
}

function getRoomOrThrow(roomId: string) {
  const { db } = getDatabase();
  const room =
    db.select()
      .from(rooms)
      .where(eq(rooms.id, roomId))
      .get() ?? null;

  if (!room) {
    throw createPublicError("That room was not found.", 404);
  }

  return room;
}

export function getLoggedOutAdminState(configured: boolean): AdminState {
  return {
    configured,
    authenticated: false,
    rooms: [],
  };
}

export function getAdminDashboardState(): AdminState {
  const { db } = getDatabase();

  const roomRows = db
    .select({
      id: rooms.id,
      code: rooms.code,
      name: rooms.name,
      locale: rooms.locale,
      themeId: rooms.themeId,
      customTheme: rooms.customTheme,
      hostProfileId: rooms.hostProfileId,
      createdAt: rooms.createdAt,
      updatedAt: rooms.updatedAt,
      currentSongTitle: songs.title,
    })
    .from(rooms)
    .leftJoin(queueItems, eq(rooms.activeQueueItemId, queueItems.id))
    .leftJoin(songs, eq(queueItems.songId, songs.id))
    .orderBy(desc(rooms.updatedAt))
    .all();

  const participantRows = db
    .select({
      roomId: roomParticipants.roomId,
      profileId: profiles.id,
      displayName: profiles.displayName,
      lastSeenAt: roomParticipants.lastSeenAt,
      isPresent: roomParticipants.isPresent,
    })
    .from(roomParticipants)
    .innerJoin(profiles, eq(roomParticipants.profileId, profiles.id))
    .orderBy(desc(roomParticipants.isPresent), desc(roomParticipants.lastSeenAt), asc(profiles.displayName))
    .all();

  const roomQueueCounts = db
    .select({
      roomId: queueItems.roomId,
      count: sql<number>`count(*)`,
    })
    .from(queueItems)
    .where(eq(queueItems.status, "queued"))
    .groupBy(queueItems.roomId)
    .all();

  const roomHistoryCounts = db
    .select({
      roomId: playbackHistory.roomId,
      count: sql<number>`count(*)`,
    })
    .from(playbackHistory)
    .groupBy(playbackHistory.roomId)
    .all();

  const participantMap = new Map<string, typeof participantRows>();

  for (const participant of participantRows) {
    const existing = participantMap.get(participant.roomId) ?? [];
    existing.push(participant);
    participantMap.set(participant.roomId, existing);
  }

  const queueCountMap = new Map(roomQueueCounts.map((row) => [row.roomId, Number(row.count)]));
  const historyCountMap = new Map(roomHistoryCounts.map((row) => [row.roomId, Number(row.count)]));

  return {
    configured: true,
    authenticated: true,
    rooms: roomRows.map((room) => {
      const participants = participantMap.get(room.id) ?? [];

      return {
        id: room.id,
        code: room.code,
        name: room.name,
        locale: room.locale as "en" | "ja",
        themeId: room.themeId ?? null,
        customTheme: room.customTheme ?? null,
        createdAt: room.createdAt,
        updatedAt: room.updatedAt,
        currentSongTitle: room.currentSongTitle ?? null,
        participantCount: participants.length,
        queuedCount: queueCountMap.get(room.id) ?? 0,
        historyCount: historyCountMap.get(room.id) ?? 0,
        participants: participants.map((participant) => ({
          id: participant.profileId,
          displayName: participant.displayName,
          isHost: room.hostProfileId === participant.profileId,
          isPresent: Boolean(participant.isPresent),
          lastSeenAt: participant.lastSeenAt,
        })),
      };
    }),
  };
}

export function updateRoomSettings(input: {
  roomId: string;
  name: string;
  locale: "en" | "ja";
  themeId: string | null;
  customTheme?: string | null;
}) {
  const { db } = getDatabase();
  const room = getRoomOrThrow(input.roomId);

  db.update(rooms)
    .set({
      name: input.name,
      locale: input.locale,
      themeId: input.themeId,
      customTheme: input.customTheme?.trim() ? input.customTheme.trim() : null,
      updatedAt: nowIso(),
    })
    .where(eq(rooms.id, input.roomId))
    .run();

  publishRoomEvent(room.code, "admin-update-room");
}

export function removeParticipantFromRoom(roomId: string, profileId: string) {
  const { db, sqlite } = getDatabase();
  const room = getRoomOrThrow(roomId);
  const participant =
    db.select()
      .from(roomParticipants)
      .where(and(eq(roomParticipants.roomId, roomId), eq(roomParticipants.profileId, profileId)))
      .get() ?? null;

  if (!participant) {
    throw createPublicError("That participant is no longer in the room.", 404);
  }

  const timestamp = nowIso();
  const removeParticipant = sqlite.transaction(() => {
    db.delete(roomParticipants)
      .where(and(eq(roomParticipants.roomId, roomId), eq(roomParticipants.profileId, profileId)))
      .run();

    db.update(rooms)
      .set({
        hostProfileId: room.hostProfileId === profileId ? null : room.hostProfileId,
        updatedAt: timestamp,
      })
      .where(eq(rooms.id, roomId))
      .run();
  });

  removeParticipant();
  publishRoomEvent(room.code, "admin-remove-participant");
}

export function deleteRoomById(roomId: string) {
  const { db, sqlite } = getDatabase();
  const room = getRoomOrThrow(roomId);

  const deleteRoom = sqlite.transaction(() => {
    const historyIds = db
      .select({
        id: playbackHistory.id,
      })
      .from(playbackHistory)
      .where(eq(playbackHistory.roomId, roomId))
      .all()
      .map((row) => row.id);

    if (historyIds.length > 0) {
      db.delete(encoreVotes).where(inArray(encoreVotes.historyId, historyIds)).run();
    }

    db.delete(reactions).where(eq(reactions.roomId, roomId)).run();
    db.delete(playbackHistory).where(eq(playbackHistory.roomId, roomId)).run();
    db.delete(queueItems).where(eq(queueItems.roomId, roomId)).run();
    db.delete(roomParticipants).where(eq(roomParticipants.roomId, roomId)).run();
    db.delete(rooms).where(eq(rooms.id, roomId)).run();
  });

  deleteRoom();
  publishRoomEvent(room.code, "deleted");
}
