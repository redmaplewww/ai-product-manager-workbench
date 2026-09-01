import { requireUser } from "@/lib/auth";
import { readState } from "@/lib/store";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await context.params;
  const run = (await readState()).runs.find((item) => item.id === id);
  if (!run) return new Response("not found", { status: 404 });
  const encoder = new TextEncoder();
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(encoder.encode(`event: run.queued\ndata: ${JSON.stringify({ runId: run.id })}\n\n`));
    for (const wave of run.waves) {
      controller.enqueue(encoder.encode(`event: wave.started\ndata: ${JSON.stringify({ runId: run.id, waveId: wave.id, index: wave.index })}\n\n`));
      for (const action of wave.actions) controller.enqueue(encoder.encode(`event: action.completed\ndata: ${JSON.stringify(action)}\n\n`));
      controller.enqueue(encoder.encode(`event: wave.completed\ndata: ${JSON.stringify(wave)}\n\n`));
    }
    controller.enqueue(encoder.encode(`event: run.${run.status}\ndata: ${JSON.stringify(run)}\n\n`));
    controller.close();
  }});
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
}
