import { promises as fs } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { CAR_LIFECYCLE_DEV_ENDPOINT } from '../src/game/carLifecycleEndpoint';

export type CarLifecycleUpdate = {
  id: string;
  status: 'experimental' | 'production';
  price: number;
  requiredOrders: number;
};

export type ValidationResult =
  | { ok: true; value: CarLifecycleUpdate }
  | { ok: false; error: string };

export function validateCarLifecycleUpdate(body: unknown, knownIds: ReadonlySet<string>): ValidationResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Body must be a JSON object' };
  }
  const candidate = body as Partial<CarLifecycleUpdate>;
  const allowedFields = new Set(['id', 'status', 'price', 'requiredOrders']);
  if (Object.keys(candidate).some(key => !allowedFields.has(key))) {
    return { ok: false, error: 'Unexpected field' };
  }
  if (typeof candidate.id !== 'string' || !knownIds.has(candidate.id)) {
    return { ok: false, error: 'Unknown car id' };
  }
  if (candidate.status !== 'experimental' && candidate.status !== 'production') {
    return { ok: false, error: 'Invalid status' };
  }
  if (!Number.isInteger(candidate.price) || Number(candidate.price) < 0) {
    return { ok: false, error: 'price must be a non-negative integer' };
  }
  if (!Number.isInteger(candidate.requiredOrders) || Number(candidate.requiredOrders) < 0) {
    return { ok: false, error: 'requiredOrders must be a non-negative integer' };
  }
  if (candidate.id === 'cruiser' && candidate.status !== 'production') {
    return { ok: false, error: 'The fallback Cruiser must remain production' };
  }
  return {
    ok: true,
    value: {
      id: candidate.id,
      status: candidate.status,
      price: Number(candidate.price),
      requiredOrders: Number(candidate.requiredOrders),
    },
  };
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 16_384) throw new Error('Request body is too large');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Fixed-path source writer installed only by the Vite development server. */
export function carLifecycleDevPlugin(lifecyclePath: string): Plugin {
  return {
    name: 'neon-taxi-car-lifecycle-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
        if (pathname !== CAR_LIFECYCLE_DEV_ENDPOINT) return next();
        if (request.method !== 'POST') {
          response.setHeader('Allow', 'POST');
          sendJson(response, 405, { error: 'Method not allowed' });
          return;
        }

        try {
          const source = JSON.parse(await fs.readFile(lifecyclePath, 'utf8')) as Record<string, unknown>;
          const validation = validateCarLifecycleUpdate(await readJsonBody(request), new Set(Object.keys(source)));
          if (validation.ok === false) {
            sendJson(response, 400, { error: validation.error });
            return;
          }
          const { id, status, price, requiredOrders } = validation.value;
          const updated = {
            ...source,
            [id]: { status, price, requiredOrders },
          };
          await fs.writeFile(lifecyclePath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
          sendJson(response, 200, { ok: true, lifecycle: updated[id] });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Lifecycle update failed';
          sendJson(response, 500, { error: message });
        }
      });
    },
  };
}
