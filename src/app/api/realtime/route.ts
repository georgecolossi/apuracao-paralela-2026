import { realtimeEmitter } from '@/lib/realtime';

export async function GET(req: Request) {
  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection event
      controller.enqueue('event: connected\ndata: {}\n\n');

      const onUpdate = (data: unknown) => {
        controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
      };

      realtimeEmitter.on('update', onUpdate);

      // Keepalive heartbeat
      const heartbeat = setInterval(() => {
        controller.enqueue(':\n\n');
      }, 30000);

      req.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        realtimeEmitter.off('update', onUpdate);
        controller.close();
      });
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
