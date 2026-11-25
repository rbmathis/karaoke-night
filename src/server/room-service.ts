import "server-only";

import { and, asc, desc, eq, inArray, isNull, lt, max, sql } from "drizzle-orm";

import { HISTORY_LIMIT, PARTY_THEMES, PRESENCE_TTL_MS, RECENT_REACTIONS_LIMIT } from "@/lib/constants";
import type {
  CreateRoomInput,
  QueueItemView,
  RoomActionInput,
  RoomState,
  SongInput,
  ThemePresetView,
} from "@/lib/room-types";
import { generateRoomCode } from "@/lib/utils";
import { getDatabase } from "@/server/db/client";
import { publishRoomEvent } from "@/server/room-hub";
import {
  markSongEmbedBlocked,
  recordSongPlaybackSuccess,
  searchYouTubeKaraoke,
} from "@/server/youtube-service";
import {
  encoreVotes,
  favorites,
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

function isRecent(isoTimestamp: string, ttlMs = PRESENCE_TTL_MS) {
  return Date.now() - new Date(isoTimestamp).getTime() <= ttlMs;
}

function getThemePresets(locale: "en" | "ja"): ThemePresetView[] {
  return PARTY_THEMES.map((theme) => ({
    id: theme.id,
    name: theme.name[locale],
    description: theme.description[locale],
    searchHint: theme.searchHint[locale],
  }));
}

function createPublicError(message: string, status = 400) {
  const error = new Error(message);
  Object.assign(error, {
    status,
  });
  return error;
}

async function getRoomByCode(code: string) {
  const { db } = getDatabase();

  return (
    db.select()
      .from(rooms)
      .where(eq(rooms.code, code.toUpperCase()))
      .get() ?? null
  );
}

async function getProfileByDeviceToken(deviceToken?: string | null) {
  if (!deviceToken) {
    return null;
  }

  const { db } = getDatabase();

  return (
    db.select()
      .from(profiles)
      .where(eq(profiles.deviceToken, deviceToken))
      .get() ?? null
  );
}

async function upsertProfile({
  deviceToken,
  displayName,
  avatarId,
  locale,
}: {
  deviceToken: string;
  displayName: string;
  avatarId?: string;
  locale: "en" | "ja";
}) {
  const { db } = getDatabase();
  const existing = await getProfileByDeviceToken(deviceToken);
  const timestamp = nowIso();

  if (existing) {
    db.update(profiles)
      .set({
        displayName,
        avatarId: avatarId ?? existing.avatarId,
        preferredLocale: locale,
        updatedAt: timestamp,
      })
      .where(eq(profiles.id, existing.id))
      .run();

    return {
      ...existing,
      displayName,
      avatarId: avatarId ?? existing.avatarId,
      preferredLocale: locale,
      updatedAt: timestamp,
    };
  }

  const profile = {
    id: crypto.randomUUID(),
    deviceToken,
    displayName,
    avatarId: avatarId ?? "singer-1",
    preferredLocale: locale,
    createdAt: timestamp,
    updatedAt: timestamp,
  } satisfies typeof profiles.$inferInsert;

  db.insert(profiles).values(profile).run();
  return profile;
}

async function ensureRoomCode() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = generateRoomCode();
    const existing = await getRoomByCode(code);

    if (!existing) {
      return code;
    }
  }

  throw createPublicError("Could not create a unique room code.", 500);
}

async function touchParticipant(roomId: string, profileId: string) {
  const { db } = getDatabase();
  const timestamp = nowIso();

  db.insert(roomParticipants)
    .values({
      id: crypto.randomUUID(),
      roomId,
      profileId,
      joinedAt: timestamp,
      lastSeenAt: timestamp,
      isPresent: true,
    })
    .onConflictDoUpdate({
      target: [roomParticipants.roomId, roomParticipants.profileId],
      set: {
        lastSeenAt: timestamp,
        isPresent: true,
      },
    })
    .run();
}

async function getViewerContext(roomId: string, deviceToken?: string | null) {
  const { db } = getDatabase();
  const viewerProfile = await getProfileByDeviceToken(deviceToken);

  if (!viewerProfile) {
    return {
      profile: null,
      participant: null,
    };
  }

  const participant =
    db.select()
      .from(roomParticipants)
      .where(
        and(
          eq(roomParticipants.roomId, roomId),
          eq(roomParticipants.profileId, viewerProfile.id),
        ),
      )
      .get() ?? null;

  return {
    profile: viewerProfile,
    participant,
  };
}

async function ensureJoinedViewer(roomId: string, deviceToken?: string | null) {
  const viewer = await getViewerContext(roomId, deviceToken);

  if (!viewer.profile || !viewer.participant) {
    throw createPublicError("Join the room first.", 403);
  }

  return viewer;
}

async function requireHost(room: typeof rooms.$inferSelect, deviceToken?: string | null) {
  const viewer = await ensureJoinedViewer(room.id, deviceToken);

  if (room.hostProfileId !== viewer.profile.id) {
    throw createPublicError("Only the host can do that.", 403);
  }

  return viewer;
}

async function getCurrentQueueItem(room: typeof rooms.$inferSelect) {
  const { db } = getDatabase();

  if (!room.activeQueueItemId) {
    return null;
  }

  return (
    db.select()
      .from(queueItems)
      .where(eq(queueItems.id, room.activeQueueItemId))
      .get() ?? null
  );
}

async function getOrCreateSong(song: SongInput) {
  const { db } = getDatabase();
  const existing =
    db.select()
      .from(songs)
      .where(eq(songs.youtubeVideoId, song.youtubeVideoId))
      .get() ?? null;

  const timestamp = nowIso();

  if (existing) {
    if (existing.deletedAt) {
      throw createPublicError("That song was removed from the catalog by the admin.", 409);
    }

    db.update(songs)
      .set({
        title: song.title,
        channelTitle: song.channelTitle,
        thumbnailUrl: song.thumbnailUrl,
        durationLabel: song.durationLabel ?? null,
        languageHint: song.languageHint ?? null,
        updatedAt: timestamp,
      })
      .where(eq(songs.id, existing.id))
      .run();

    return {
      ...existing,
      title: song.title,
      channelTitle: song.channelTitle,
      thumbnailUrl: song.thumbnailUrl,
      durationLabel: song.durationLabel ?? null,
      languageHint: song.languageHint ?? null,
      updatedAt: timestamp,
    };
  }

  const created = {
    id: crypto.randomUUID(),
    youtubeVideoId: song.youtubeVideoId,
    title: song.title,
    channelTitle: song.channelTitle,
    thumbnailUrl: song.thumbnailUrl,
    durationLabel: song.durationLabel ?? null,
    languageHint: song.languageHint ?? null,
    embeddable: true,
    deletedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  } satisfies typeof songs.$inferInsert;

  db.insert(songs).values(created).run();
  return created;
}

function applyRotationOrder(
  items: Array<Pick<typeof queueItems.$inferSelect, "id" | "primarySingerProfileId" | "position">>,
  avoidSingerId?: string | null,
) {
  const groups = new Map<
    string,
    Array<Pick<typeof queueItems.$inferSelect, "id" | "primarySingerProfileId" | "position">>
  >();
  const groupOrder: string[] = [];

  for (const item of items) {
    if (!groups.has(item.primarySingerProfileId)) {
      groups.set(item.primarySingerProfileId, []);
      groupOrder.push(item.primarySingerProfileId);
    }

    groups.get(item.primarySingerProfileId)?.push(item);
  }

  let rotatedOrder = [...groupOrder];

  if (avoidSingerId && rotatedOrder.includes(avoidSingerId) && rotatedOrder.length > 1) {
    const startIndex = (rotatedOrder.indexOf(avoidSingerId) + 1) % rotatedOrder.length;
    rotatedOrder = [
      ...rotatedOrder.slice(startIndex),
      ...rotatedOrder.slice(0, startIndex),
    ];
  }

  const ordered: typeof items = [];

  while (groups.size > 0) {
    for (const singerId of rotatedOrder) {
      const next = groups.get(singerId)?.shift();

      if (!next) {
        continue;
      }

      ordered.push(next);

      if (!groups.get(singerId)?.length) {
        groups.delete(singerId);
      }
    }

    rotatedOrder = rotatedOrder.filter((singerId) => groups.has(singerId));
  }

  return ordered;
}

async function reorderQueuedItems(
  roomId: string,
  orderedQueueItemIds: string[],
  preserveUnknown = false,
) {
  const { db } = getDatabase();
  const queued =
    db.select({
      id: queueItems.id,
      primarySingerProfileId: queueItems.primarySingerProfileId,
      position: queueItems.position,
    })
      .from(queueItems)
      .where(and(eq(queueItems.roomId, roomId), eq(queueItems.status, "queued")))
      .orderBy(asc(queueItems.position))
      .all() ?? [];

  const queuedById = new Map(queued.map((item) => [item.id, item]));
  const ordered = orderedQueueItemIds
    .map((id) => queuedById.get(id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  if (preserveUnknown) {
    for (const item of queued) {
      if (!ordered.some((candidate) => candidate.id === item.id)) {
        ordered.push(item);
      }
    }
  }

  ordered.forEach((item, index) => {
    db.update(queueItems)
      .set({
        position: index + 1,
      })
      .where(eq(queueItems.id, item.id))
      .run();
  });
}

async function rebalanceRoomQueue(room: typeof rooms.$inferSelect) {
  const { db } = getDatabase();
  const queued =
    db.select({
      id: queueItems.id,
      primarySingerProfileId: queueItems.primarySingerProfileId,
      position: queueItems.position,
    })
      .from(queueItems)
      .where(and(eq(queueItems.roomId, room.id), eq(queueItems.status, "queued")))
      .orderBy(asc(queueItems.position))
      .all() ?? [];

  if (queued.length < 2) {
    return;
  }

  const current = await getCurrentQueueItem(room);
  const ordered = applyRotationOrder(queued, current?.primarySingerProfileId);

  await reorderQueuedItems(
    room.id,
    ordered.map((item) => item.id),
  );
}

export async function createRoom(
  input: CreateRoomInput,
  deviceToken: string,
): Promise<{ roomCode: string }> {
  const { db } = getDatabase();
  const profile = await upsertProfile({
    deviceToken,
    displayName: input.displayName,
    locale: input.locale,
  });
  const roomCode = await ensureRoomCode();
  const timestamp = nowIso();

  const room = {
    id: crypto.randomUUID(),
    code: roomCode,
    name: input.roomName?.trim() || `${input.displayName}'s Karaoke`,
    hostProfileId: profile.id,
    locale: input.locale,
    rotationMode: false,
    lockQueue: false,
    themeId: null,
    customTheme: null,
    activeQueueItemId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  } satisfies typeof rooms.$inferInsert;

  db.insert(rooms).values(room).run();
  await touchParticipant(room.id, profile.id);

  return {
    roomCode,
  };
}

export async function joinRoom(
  input: { code: string; displayName: string; avatarId?: string; locale: "en" | "ja" },
  deviceToken: string,
) {
  const room = await getRoomByCode(input.code);

  if (!room) {
    throw createPublicError("That room was not found.", 404);
  }

  const profile = await upsertProfile({
    deviceToken,
    displayName: input.displayName,
    avatarId: input.avatarId,
    locale: input.locale,
  });

  await touchParticipant(room.id, profile.id);

  return {
    roomCode: room.code,
    isHost: room.hostProfileId === profile.id,
  };
}

export async function getOrCreateSingleRoom(locale: "en" | "ja", deviceToken: string) {
  const { db } = getDatabase();
  const existing =
    db.select()
      .from(rooms)
      .orderBy(desc(rooms.updatedAt))
      .limit(1)
      .get() ?? null;

  if (existing) {
    const profile = await upsertProfile({
      deviceToken,
      displayName: "TV",
      locale,
    });

    db.update(rooms)
      .set({
        hostProfileId: profile.id,
        locale,
        updatedAt: nowIso(),
      })
      .where(eq(rooms.id, existing.id))
      .run();
    await touchParticipant(existing.id, profile.id);

    return { roomCode: existing.code };
  }

  return createRoom(
    {
      displayName: "TV",
      roomName: "Karaoke Night",
      locale,
    },
    deviceToken,
  );
}

export async function deleteRoomByCode(roomCode: string, deviceToken?: string | null) {
  const { db, sqlite } = getDatabase();
  const room = await getRoomByCode(roomCode);

  if (!room) {
    throw createPublicError("That room was not found.", 404);
  }

  await requireHost(room, deviceToken);

  const deleteRoom = sqlite.transaction(() => {
    const historyIds = db
      .select({ id: playbackHistory.id })
      .from(playbackHistory)
      .where(eq(playbackHistory.roomId, room.id))
      .all()
      .map((row) => row.id);

    if (historyIds.length > 0) {
      db.delete(encoreVotes).where(inArray(encoreVotes.historyId, historyIds)).run();
    }

    db.delete(reactions).where(eq(reactions.roomId, room.id)).run();
    db.delete(playbackHistory).where(eq(playbackHistory.roomId, room.id)).run();
    db.delete(queueItems).where(eq(queueItems.roomId, room.id)).run();
    db.delete(roomParticipants).where(eq(roomParticipants.roomId, room.id)).run();
    db.delete(rooms).where(eq(rooms.id, room.id)).run();
  });

  deleteRoom();
  publishRoomEvent(room.code, "deleted");
}

export function listRooms() {
  const { db } = getDatabase();

  const roomRows = db
    .select({
      id: rooms.id,
      code: rooms.code,
      name: rooms.name,
      updatedAt: rooms.updatedAt,
      currentSongTitle: songs.title,
    })
    .from(rooms)
    .leftJoin(queueItems, eq(rooms.activeQueueItemId, queueItems.id))
    .leftJoin(songs, eq(queueItems.songId, songs.id))
    .orderBy(desc(rooms.updatedAt))
    .limit(1)
    .all();

  const participantRows = db
    .select({
      roomId: roomParticipants.roomId,
      profileId: roomParticipants.profileId,
      displayName: profiles.displayName,
    })
    .from(roomParticipants)
    .innerJoin(profiles, eq(roomParticipants.profileId, profiles.id))
    .where(eq(roomParticipants.isPresent, true))
    .all();

  const queueCounts = db
    .select({
      roomId: queueItems.roomId,
      count: sql<number>`count(*)`,
    })
    .from(queueItems)
    .where(eq(queueItems.status, "queued"))
    .groupBy(queueItems.roomId)
    .all();

  const participantMap = new Map<string, typeof participantRows>();
  for (const participant of participantRows) {
    const existing = participantMap.get(participant.roomId) ?? [];
    existing.push(participant);
    participantMap.set(participant.roomId, existing);
  }

  const queueCountMap = new Map(queueCounts.map((row) => [row.roomId, Number(row.count)]));

  return roomRows.map((room) => {
    return {
      code: room.code,
      name: room.name,
      updatedAt: room.updatedAt,
      currentSongTitle: room.currentSongTitle ?? null,
      participantCount: participantMap.get(room.id)?.length ?? 0,
      queuedCount: queueCountMap.get(room.id) ?? 0,
    };
  });
}

export async function getRoomState(
  roomCode: string,
  deviceToken?: string | null,
): Promise<RoomState | null> {
  const { db } = getDatabase();
  const room = await getRoomByCode(roomCode);

  if (!room) {
    return null;
  }

  const staleCutoff = new Date(Date.now() - PRESENCE_TTL_MS).toISOString();
  db.update(roomParticipants)
    .set({
      isPresent: false,
    })
    .where(and(eq(roomParticipants.roomId, room.id), lt(roomParticipants.lastSeenAt, staleCutoff)))
    .run();

  const viewer = await getViewerContext(room.id, deviceToken);
  const participantRows =
    db.select({
      profileId: profiles.id,
      displayName: profiles.displayName,
      avatarId: profiles.avatarId,
      preferredLocale: profiles.preferredLocale,
      lastSeenAt: roomParticipants.lastSeenAt,
      isPresent: roomParticipants.isPresent,
    })
      .from(roomParticipants)
      .innerJoin(profiles, eq(roomParticipants.profileId, profiles.id))
      .where(eq(roomParticipants.roomId, room.id))
      .orderBy(desc(roomParticipants.isPresent), asc(profiles.displayName))
      .all() ?? [];

  const queuedRows =
    db.select({
      id: queueItems.id,
      songId: queueItems.songId,
      addedByProfileId: queueItems.addedByProfileId,
      primarySingerProfileId: queueItems.primarySingerProfileId,
      secondarySingerProfileId: queueItems.secondarySingerProfileId,
      position: queueItems.position,
      status: queueItems.status,
      addedAt: queueItems.addedAt,
      title: songs.title,
      youtubeVideoId: songs.youtubeVideoId,
      channelTitle: songs.channelTitle,
      thumbnailUrl: songs.thumbnailUrl,
      durationLabel: songs.durationLabel,
      languageHint: songs.languageHint,
    })
      .from(queueItems)
      .innerJoin(songs, eq(queueItems.songId, songs.id))
      .where(
        and(
          eq(queueItems.roomId, room.id),
          inArray(queueItems.status, ["queued", "playing"]),
        ),
      )
      .orderBy(asc(queueItems.position))
      .all() ?? [];

  const currentRow = queuedRows.find((row) => row.status === "playing") ?? null;
  const queueRows = queuedRows.filter((row) => row.status === "queued");

  const historyRows =
    db.select({
      id: playbackHistory.id,
      songId: playbackHistory.songId,
      primarySingerProfileId: playbackHistory.primarySingerProfileId,
      secondarySingerProfileId: playbackHistory.secondarySingerProfileId,
      outcome: playbackHistory.outcome,
      completedAt: playbackHistory.completedAt,
      title: songs.title,
      youtubeVideoId: songs.youtubeVideoId,
      channelTitle: songs.channelTitle,
      thumbnailUrl: songs.thumbnailUrl,
      durationLabel: songs.durationLabel,
      languageHint: songs.languageHint,
    })
      .from(playbackHistory)
      .innerJoin(songs, eq(playbackHistory.songId, songs.id))
      .where(eq(playbackHistory.roomId, room.id))
      .orderBy(desc(playbackHistory.completedAt))
      .limit(HISTORY_LIMIT)
      .all() ?? [];

  const historyIds = historyRows.map((row) => row.id);
  const voteCounts =
    historyIds.length > 0
      ? db
          .select({
            historyId: encoreVotes.historyId,
            votes: sql<number>`count(*)`,
          })
          .from(encoreVotes)
          .where(inArray(encoreVotes.historyId, historyIds))
          .groupBy(encoreVotes.historyId)
          .all()
      : [];

  const viewerVotes =
    viewer.profile && historyIds.length > 0
      ? db
          .select({
            historyId: encoreVotes.historyId,
          })
          .from(encoreVotes)
          .where(
            and(
              eq(encoreVotes.profileId, viewer.profile.id),
              inArray(encoreVotes.historyId, historyIds),
            ),
          )
          .all()
      : [];

  const favoritesRows =
    viewer.profile
      ? db
          .select({
            id: songs.id,
            youtubeVideoId: songs.youtubeVideoId,
            title: songs.title,
            channelTitle: songs.channelTitle,
            thumbnailUrl: songs.thumbnailUrl,
            durationLabel: songs.durationLabel,
            languageHint: songs.languageHint,
          })
          .from(favorites)
          .innerJoin(songs, eq(favorites.songId, songs.id))
          .where(and(eq(favorites.profileId, viewer.profile.id), isNull(songs.deletedAt)))
          .orderBy(desc(favorites.createdAt))
          .limit(12)
          .all()
      : [];

  const reactionRows =
    db.select()
      .from(reactions)
      .where(eq(reactions.roomId, room.id))
      .orderBy(desc(reactions.createdAt))
      .limit(RECENT_REACTIONS_LIMIT)
      .all() ?? [];

  const referencedProfileIds = new Set<string>();

  for (const participant of participantRows) {
    referencedProfileIds.add(participant.profileId);
  }

  for (const row of queuedRows) {
    referencedProfileIds.add(row.addedByProfileId);
    referencedProfileIds.add(row.primarySingerProfileId);

    if (row.secondarySingerProfileId) {
      referencedProfileIds.add(row.secondarySingerProfileId);
    }
  }

  for (const row of historyRows) {
    referencedProfileIds.add(row.primarySingerProfileId);

    if (row.secondarySingerProfileId) {
      referencedProfileIds.add(row.secondarySingerProfileId);
    }
  }

  for (const reaction of reactionRows) {
    referencedProfileIds.add(reaction.profileId);
  }

  const profileRows =
    referencedProfileIds.size > 0
      ? db
          .select({
            id: profiles.id,
            displayName: profiles.displayName,
            avatarId: profiles.avatarId,
          })
          .from(profiles)
          .where(inArray(profiles.id, Array.from(referencedProfileIds)))
          .all()
      : [];

  const profileMap = new Map(
    profileRows.map((profile) => [
      profile.id,
      {
        id: profile.id,
        displayName: profile.displayName,
        avatarId: profile.avatarId,
      },
    ]),
  );

  function getDisplayName(profileId: string) {
    return profileMap.get(profileId)?.displayName ?? "Singer";
  }
  function getAvatar(profileId: string) {
    return profileMap.get(profileId)?.avatarId ?? "🎤";
  }

  const voteCountMap = new Map(voteCounts.map((row) => [row.historyId, row.votes]));
  const viewerVoteSet = new Set(viewerVotes.map((row) => row.historyId));

  const toQueueView = (
    row: (typeof queuedRows)[number],
    status: "queued" | "playing",
  ): QueueItemView => ({
    id: row.id,
    position: row.position,
    status,
    addedAt: row.addedAt,
    addedByDisplayName: getDisplayName(row.addedByProfileId),
    primarySinger: {
      id: row.primarySingerProfileId,
      displayName: getDisplayName(row.primarySingerProfileId),
      avatarId: getAvatar(row.primarySingerProfileId),
      isHost: room.hostProfileId === row.primarySingerProfileId,
    },
    secondarySinger: row.secondarySingerProfileId
      ? {
          id: row.secondarySingerProfileId,
          displayName: getDisplayName(row.secondarySingerProfileId),
          avatarId: getAvatar(row.secondarySingerProfileId),
          isHost: room.hostProfileId === row.secondarySingerProfileId,
        }
      : null,
    song: {
      id: row.songId,
      youtubeVideoId: row.youtubeVideoId,
      title: row.title,
      channelTitle: row.channelTitle,
      thumbnailUrl: row.thumbnailUrl,
      durationLabel: row.durationLabel ?? null,
      languageHint: row.languageHint ?? null,
    },
  });

  const canClaimHost = (() => {
    if (!viewer.profile || !viewer.participant) {
      return false;
    }

    if (!room.hostProfileId) {
      return true;
    }

    const hostParticipant = participantRows.find(
      (participant) => participant.profileId === room.hostProfileId,
    );

    return !hostParticipant || !hostParticipant.isPresent || !isRecent(hostParticipant.lastSeenAt);
  })();

  return {
    room: {
      id: room.id,
      code: room.code,
      name: room.name,
      locale: room.locale as "en" | "ja",
      themeId: room.themeId ?? null,
      customTheme: room.customTheme ?? null,
    },
    viewer: {
      profileId: viewer.profile?.id ?? null,
      displayName: viewer.profile?.displayName ?? null,
      avatarId: viewer.profile?.avatarId ?? "singer-1",
      isHost: viewer.profile?.id === room.hostProfileId,
      isJoined: Boolean(viewer.participant),
      canClaimHost,
    },
    participants: participantRows.map((participant) => ({
      id: participant.profileId,
      displayName: participant.displayName,
      avatarId: participant.avatarId,
      isHost: room.hostProfileId === participant.profileId,
      isPresent: Boolean(participant.isPresent),
      lastSeenAt: participant.lastSeenAt,
    })),
    current: currentRow ? toQueueView(currentRow, "playing") : null,
    queue: queueRows.map((row) => toQueueView(row, "queued")),
    history: historyRows.map((row) => ({
      id: row.id,
      outcome: row.outcome as "played" | "skipped",
      completedAt: row.completedAt,
      encoreVotes: voteCountMap.get(row.id) ?? 0,
      viewerVoted: viewerVoteSet.has(row.id),
      primarySinger: {
        id: row.primarySingerProfileId,
        displayName: getDisplayName(row.primarySingerProfileId),
        avatarId: getAvatar(row.primarySingerProfileId),
        isHost: room.hostProfileId === row.primarySingerProfileId,
      },
      secondarySinger: row.secondarySingerProfileId
        ? {
            id: row.secondarySingerProfileId,
            displayName: getDisplayName(row.secondarySingerProfileId),
            avatarId: getAvatar(row.secondarySingerProfileId),
            isHost: room.hostProfileId === row.secondarySingerProfileId,
          }
        : null,
      song: {
        id: row.songId,
        youtubeVideoId: row.youtubeVideoId,
        title: row.title,
        channelTitle: row.channelTitle,
        thumbnailUrl: row.thumbnailUrl,
        durationLabel: row.durationLabel ?? null,
        languageHint: row.languageHint ?? null,
      },
    })),
    favorites: favoritesRows.map((row) => ({
      id: row.id,
      youtubeVideoId: row.youtubeVideoId,
      title: row.title,
      channelTitle: row.channelTitle,
      thumbnailUrl: row.thumbnailUrl,
      durationLabel: row.durationLabel ?? null,
      languageHint: row.languageHint ?? null,
    })),
    recentReactions: reactionRows.map((reaction) => ({
      id: reaction.id,
      emoji: reaction.emoji,
      createdAt: reaction.createdAt,
      byDisplayName: getDisplayName(reaction.profileId),
    })),
    themePresets: getThemePresets(room.locale as "en" | "ja"),
  };
}

export async function runRoomAction(
  roomCode: string,
  action: RoomActionInput,
  deviceToken?: string | null,
) {
  const { db } = getDatabase();
  const room = await getRoomByCode(roomCode);

  if (!room) {
    throw createPublicError("That room was not found.", 404);
  }

  switch (action.type) {
    case "update-singer": {
      const viewer = await ensureJoinedViewer(room.id, deviceToken);
      const timestamp = nowIso();
      db.update(profiles)
        .set({
          displayName: action.displayName,
          avatarId: action.avatarId,
          updatedAt: timestamp,
        })
        .where(eq(profiles.id, viewer.profile.id))
        .run();
      return;
    }

    case "heartbeat": {
      const viewer = await getViewerContext(room.id, deviceToken);

      if (viewer.profile && viewer.participant) {
        await touchParticipant(room.id, viewer.profile.id);
      }

      return;
    }

    case "claim-host": {
      const viewer = await ensureJoinedViewer(room.id, deviceToken);
      const state = await getRoomState(room.code, deviceToken);

      if (!state?.viewer.canClaimHost) {
        throw createPublicError("Only the host can do that.", 403);
      }

      db.update(rooms)
        .set({
          hostProfileId: viewer.profile.id,
          updatedAt: nowIso(),
        })
        .where(eq(rooms.id, room.id))
        .run();

      return;
    }

    case "make-host": {
      await requireHost(room, deviceToken);

      const target =
        db.select()
          .from(roomParticipants)
          .where(
            and(
              eq(roomParticipants.roomId, room.id),
              eq(roomParticipants.profileId, action.profileId),
            ),
          )
          .get() ?? null;

      if (!target) {
        throw createPublicError("Singer not found in this room.", 404);
      }

      db.update(rooms)
        .set({
          hostProfileId: action.profileId,
          updatedAt: nowIso(),
        })
        .where(eq(rooms.id, room.id))
        .run();

      return;
    }

    case "add-queue-item": {
      const viewer = await ensureJoinedViewer(room.id, deviceToken);

      const song = await getOrCreateSong(action.song);
      const existingInRoom =
        db.select({
          id: queueItems.id,
        })
          .from(queueItems)
          .where(and(eq(queueItems.roomId, room.id), eq(queueItems.songId, song.id)))
          .get() ?? null;

      if (existingInRoom) {
        throw createPublicError("That song has already been added in this room.", 409);
      }

      const validSingerIds = new Set(
        db.select({
          profileId: roomParticipants.profileId,
        })
          .from(roomParticipants)
          .where(eq(roomParticipants.roomId, room.id))
          .all()
          .map((item) => item.profileId),
      );

      const primarySingerId =
        action.primarySingerId && validSingerIds.has(action.primarySingerId)
          ? action.primarySingerId
          : viewer.profile.id;

      const secondarySingerId =
        action.secondarySingerId &&
        action.secondarySingerId !== primarySingerId &&
        validSingerIds.has(action.secondarySingerId)
          ? action.secondarySingerId
          : null;

      const currentMax =
        db.select({
          highest: max(queueItems.position),
        })
          .from(queueItems)
          .where(eq(queueItems.roomId, room.id))
          .get()?.highest ?? 0;

      const timestamp = nowIso();
      const newQueueItemId = crypto.randomUUID();
      const shouldStartImmediately = !room.activeQueueItemId;

      db.insert(queueItems)
        .values({
          id: newQueueItemId,
          roomId: room.id,
          songId: song.id,
          addedByProfileId: viewer.profile.id,
          primarySingerProfileId: primarySingerId,
          secondarySingerProfileId: secondarySingerId,
          position: Number(currentMax) + 1,
          status: shouldStartImmediately ? "playing" : "queued",
          addedAt: timestamp,
          startedAt: shouldStartImmediately ? timestamp : null,
          endedAt: null,
        })
        .run();

      if (shouldStartImmediately) {
        db.update(rooms)
          .set({
            activeQueueItemId: newQueueItemId,
            updatedAt: timestamp,
          })
          .where(eq(rooms.id, room.id))
          .run();
      }
      return;
    }

    case "remove-queue-item": {
      await requireHost(room, deviceToken);

      const item =
        db.select()
          .from(queueItems)
          .where(eq(queueItems.id, action.queueItemId))
          .get() ?? null;

      if (!item || item.roomId !== room.id || item.status !== "queued") {
        throw createPublicError("Queue item not found.", 404);
      }

      db.delete(queueItems).where(eq(queueItems.id, item.id)).run();

      const remaining =
        db.select({
          id: queueItems.id,
          primarySingerProfileId: queueItems.primarySingerProfileId,
          position: queueItems.position,
        })
          .from(queueItems)
          .where(and(eq(queueItems.roomId, room.id), eq(queueItems.status, "queued")))
          .orderBy(asc(queueItems.position))
          .all() ?? [];

      await reorderQueuedItems(
        room.id,
        remaining.map((queued) => queued.id),
      );

      return;
    }

    case "reorder-queue": {
      await requireHost(room, deviceToken);
      await reorderQueuedItems(room.id, action.queueItemIds, true);
      return;
    }

    case "rebalance-queue": {
      await requireHost(room, deviceToken);
      await rebalanceRoomQueue(room);
      return;
    }

    case "start-playback": {
      const alreadyCurrent = await getCurrentQueueItem(room);

      if (alreadyCurrent) {
        return;
      }

      const target =
        (action.queueItemId
          ? db
              .select()
              .from(queueItems)
              .where(eq(queueItems.id, action.queueItemId))
              .get()
          : db
              .select()
              .from(queueItems)
              .where(and(eq(queueItems.roomId, room.id), eq(queueItems.status, "queued")))
              .orderBy(asc(queueItems.position))
              .get()) ?? null;

      if (!target || target.roomId !== room.id || target.status !== "queued") {
        throw createPublicError("No queued song is ready to play.", 400);
      }

      const timestamp = nowIso();
      db.update(queueItems)
        .set({
          status: "playing",
          startedAt: timestamp,
        })
        .where(eq(queueItems.id, target.id))
        .run();

      db.update(rooms)
        .set({
          activeQueueItemId: target.id,
          updatedAt: timestamp,
        })
        .where(eq(rooms.id, room.id))
        .run();

      return;
    }

    case "advance-playback": {
      const current = await getCurrentQueueItem(room);

      if (!current) {
        throw createPublicError("No current song is playing.", 400);
      }

      const timestamp = nowIso();

      db.update(queueItems)
        .set({
          status: action.outcome,
          endedAt: timestamp,
        })
        .where(eq(queueItems.id, current.id))
        .run();

      db.insert(playbackHistory)
        .values({
          id: crypto.randomUUID(),
          roomId: room.id,
          queueItemId: current.id,
          songId: current.songId,
          primarySingerProfileId: current.primarySingerProfileId,
          secondarySingerProfileId: current.secondarySingerProfileId ?? null,
          outcome: action.outcome,
          completedAt: timestamp,
        })
        .run();

      const nextUp =
        db.select()
          .from(queueItems)
          .where(and(eq(queueItems.roomId, room.id), eq(queueItems.status, "queued")))
          .orderBy(asc(queueItems.position))
          .get() ?? null;

      if (nextUp) {
        db.update(queueItems)
          .set({
            status: "playing",
            startedAt: timestamp,
          })
          .where(eq(queueItems.id, nextUp.id))
          .run();

        db.update(rooms)
          .set({
            activeQueueItemId: nextUp.id,
            updatedAt: timestamp,
          })
          .where(eq(rooms.id, room.id))
          .run();
      } else {
        db.update(rooms)
          .set({
            activeQueueItemId: null,
            updatedAt: timestamp,
          })
          .where(eq(rooms.id, room.id))
          .run();
      }

      return;
    }

    case "update-settings": {
      await requireHost(room, deviceToken);

      db.update(rooms)
        .set({
          themeId:
            action.themeId === undefined ? room.themeId : action.themeId ?? null,
          customTheme:
            action.customTheme === undefined
              ? room.customTheme
              : action.customTheme ?? null,
          updatedAt: nowIso(),
        })
        .where(eq(rooms.id, room.id))
        .run();

      return;
    }

    case "toggle-favorite": {
      const viewer = await ensureJoinedViewer(room.id, deviceToken);
      const song = await getOrCreateSong(action.song);
      const existing =
        db.select()
          .from(favorites)
          .where(
            and(
              eq(favorites.profileId, viewer.profile.id),
              eq(favorites.songId, song.id),
            ),
          )
          .get() ?? null;

      if (existing) {
        db.delete(favorites).where(eq(favorites.id, existing.id)).run();
      } else {
        db.insert(favorites)
          .values({
            id: crypto.randomUUID(),
            profileId: viewer.profile.id,
            songId: song.id,
            createdAt: nowIso(),
          })
          .run();
      }

      return;
    }

    case "add-reaction": {
      const viewer = await ensureJoinedViewer(room.id, deviceToken);

      db.insert(reactions)
        .values({
          id: crypto.randomUUID(),
          roomId: room.id,
          profileId: viewer.profile.id,
          queueItemId: room.activeQueueItemId ?? null,
          emoji: action.emoji,
          createdAt: nowIso(),
        })
        .run();

      const reactionRowsForCleanup =
        db.select({
          id: reactions.id,
        })
          .from(reactions)
          .where(eq(reactions.roomId, room.id))
          .orderBy(desc(reactions.createdAt))
          .all() ?? [];
      const staleReactions = reactionRowsForCleanup.slice(RECENT_REACTIONS_LIMIT);

      if (staleReactions.length > 0) {
        db.delete(reactions)
          .where(
            inArray(
              reactions.id,
              staleReactions.map((reaction) => reaction.id),
            ),
          )
          .run();
      }

      return;
    }

    case "toggle-encore-vote": {
      const viewer = await ensureJoinedViewer(room.id, deviceToken);
      const historyRow =
        db.select()
          .from(playbackHistory)
          .where(eq(playbackHistory.id, action.historyId))
          .get() ?? null;

      if (!historyRow || historyRow.roomId !== room.id) {
        throw createPublicError("Song history item not found.", 404);
      }

      const existing =
        db.select()
          .from(encoreVotes)
          .where(
            and(
              eq(encoreVotes.historyId, historyRow.id),
              eq(encoreVotes.profileId, viewer.profile.id),
            ),
          )
          .get() ?? null;

      if (existing) {
        db.delete(encoreVotes).where(eq(encoreVotes.id, existing.id)).run();
      } else {
        db.insert(encoreVotes)
          .values({
            id: crypto.randomUUID(),
            historyId: historyRow.id,
            profileId: viewer.profile.id,
            createdAt: nowIso(),
          })
          .run();
      }

      return;
    }

    case "delete-room": {
      await deleteRoomByCode(roomCode, deviceToken);
      return;
    }

    case "report-playback-error": {
      if (action.errorCode === 100 || action.errorCode === 101 || action.errorCode === 150) {
        markSongEmbedBlocked(action.youtubeVideoId);
      }

      return;
    }

    case "report-playback-success": {
      recordSongPlaybackSuccess(action.youtubeVideoId);
      return;
    }

    case "swap-current-song": {
      const current = await getCurrentQueueItem(room);

      if (!current) {
        throw createPublicError("No song is currently playing.", 400);
      }

      const currentSong =
        db.select()
          .from(songs)
          .where(eq(songs.id, current.songId))
          .get() ?? null;

      if (!currentSong) {
        throw createPublicError("Current song not found.", 404);
      }

      markSongEmbedBlocked(currentSong.youtubeVideoId);

      const searchLocale: "en" | "ja" = room.locale === "ja" ? "ja" : "en";
      const { results: candidates } = await searchYouTubeKaraoke(
        currentSong.title,
        searchLocale,
      );
      const alternative =
        candidates.find(
          (candidate) =>
            candidate.youtubeVideoId !== currentSong.youtubeVideoId && candidate.embeddable,
        ) ??
        candidates.find(
          (candidate) => candidate.youtubeVideoId !== currentSong.youtubeVideoId,
        );

      if (!alternative) {
        throw createPublicError("No other playable version was found for this song.", 404);
      }

      const replacementSong = await getOrCreateSong({
        youtubeVideoId: alternative.youtubeVideoId,
        title: alternative.title,
        channelTitle: alternative.channelTitle,
        thumbnailUrl: alternative.thumbnailUrl,
        durationLabel: alternative.durationLabel ?? undefined,
        languageHint: alternative.languageHint ?? undefined,
      });

      const timestamp = nowIso();

      db.update(queueItems)
        .set({
          songId: replacementSong.id,
          startedAt: timestamp,
        })
        .where(eq(queueItems.id, current.id))
        .run();

      db.update(rooms)
        .set({
          updatedAt: timestamp,
        })
        .where(eq(rooms.id, room.id))
        .run();

      return;
    }
  }
}

export function getHealthSnapshot() {
  const { sqlite, filePath } = getDatabase();
  const check = sqlite.prepare("SELECT 1 AS ok").get() as { ok: number };
  const cacheCount = sqlite.prepare("SELECT COUNT(*) AS count FROM search_cache").get() as {
    count: number;
  };
  const journalMode = sqlite.pragma("journal_mode", {
    simple: true,
  }) as string;

  return {
    ok: check.ok === 1,
    filePath,
    journalMode,
    cacheRows: cacheCount.count,
  };
}
