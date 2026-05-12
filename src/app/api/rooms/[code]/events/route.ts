import { subscribeRoomEvent } from "@/server/room-hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/rooms/[code]/events">,
) {
  const { code } = await ctx.params;
  const normalizedCode = code.toUpperCase();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: { type: string; roomCode: string; reason: string; at: string }) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      send({
        type: "refresh",
        roomCode: normalizedCode,
        reason: "connected",
        at: new Date().toISOString(),
      });

      const unsubscribe = subscribeRoomEvent(normalizedCode, send);
      const keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode("event: ping\ndata: {}\n\n"));
      }, 15_000);

      const cleanup = () => {
        clearInterval(keepAlive);
        unsubscribe();

        try {
          controller.close();
        } catch {
          // no-op
        }
      };

      request.signal.addEventListener(
        "abort",
        cleanup,
        { once: true },
      );
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
