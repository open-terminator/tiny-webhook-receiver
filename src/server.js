const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const DEFAULT_DATA_DIR = path.resolve(process.cwd(), 'data');

function getDataDir() {
  return path.resolve(process.env.DATA_DIR || DEFAULT_DATA_DIR);
}

fs.mkdirSync(getDataDir(), { recursive: true });

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);

  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });

  response.end(body);
}

function readRawBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    request.on('data', (chunk) => {
      chunks.push(chunk);
    });

    request.on('end', () => {
      resolve(Buffer.concat(chunks));
    });

    request.on('error', reject);
  });
}

function verifySignature(rawBody, signatureHeader, secret) {
  if (!secret) {
    return true;
  }

  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }

  const expected = `sha256=${crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex')}`;

  const expectedBuffer = Buffer.from(expected, 'utf8');
  const actualBuffer = Buffer.from(signatureHeader, 'utf8');

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function buildDeliveryFileName(deliveryId) {
  const safeId = deliveryId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${timestamp}_${safeId}.json`;
}

function saveDelivery(delivery) {
  const fileName = buildDeliveryFileName(delivery.deliveryId);
  const dataDir = getDataDir();
  const filePath = path.join(dataDir, fileName);

  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(delivery, null, 2));
  return fileName;
}

function readDeliveries() {
  const dataDir = getDataDir();

  fs.mkdirSync(dataDir, { recursive: true });

  const fileNames = fs
    .readdirSync(dataDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));

  return fileNames.flatMap((fileName) => {
    const filePath = path.join(dataDir, fileName);

    try {
      const delivery = JSON.parse(fs.readFileSync(filePath, 'utf8'));

      return [
        {
          fileName,
          receivedAt: delivery.receivedAt || null,
          deliveryId: delivery.deliveryId || null,
          event: delivery.event || null,
          signatureVerified: delivery.signatureVerified === true,
        },
      ];
    } catch {
      return [];
    }
  });
}

function readDeliveryById(deliveryId) {
  const dataDir = getDataDir();

  fs.mkdirSync(dataDir, { recursive: true });

  const fileNames = fs
    .readdirSync(dataDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));

  for (const fileName of fileNames) {
    const filePath = path.join(dataDir, fileName);

    try {
      const delivery = JSON.parse(fs.readFileSync(filePath, 'utf8'));

      if (delivery.deliveryId === deliveryId) {
        return {
          fileName,
          ...delivery,
        };
      }
    } catch {
      continue;
    }
  }

  return null;
}

function parsePositiveInteger(value) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
}

function parseBooleanFilter(value) {
  if (!value) {
    return null;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return null;
}

function filterDeliveries(deliveries, filters) {
  return deliveries.filter((delivery) => {
    if (filters.event && delivery.event !== filters.event) {
      return false;
    }

    if (filters.deliveryId && delivery.deliveryId !== filters.deliveryId) {
      return false;
    }

    if (
      filters.signatureVerified !== null &&
      delivery.signatureVerified !== filters.signatureVerified
    ) {
      return false;
    }

    return true;
  });
}

async function handleWebhook(request, response) {
  const contentType = (request.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();

  if (contentType !== 'application/json') {
    sendJson(response, 415, {
      ok: false,
      error: 'Unsupported media type',
      expected: 'application/json',
      received: contentType || null,
    });
    return;
  }

  const rawBody = await readRawBody(request);
  const signatureHeader = request.headers['x-hub-signature-256'];
  const signatureVerified = WEBHOOK_SECRET
    ? verifySignature(rawBody, signatureHeader, WEBHOOK_SECRET)
    : false;

  if (WEBHOOK_SECRET && !signatureVerified) {
    sendJson(response, 401, {
      ok: false,
      error: 'Invalid or missing webhook signature',
    });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    sendJson(response, 400, {
      ok: false,
      error: 'Request body must be valid JSON',
    });
    return;
  }

  const deliveryId = request.headers['x-github-delivery'] || crypto.randomUUID();
  const event = request.headers['x-github-event'] || 'unknown';

  const fileName = saveDelivery({
    receivedAt: new Date().toISOString(),
    deliveryId,
    event,
    signatureVerified,
    payload,
  });

  sendJson(response, 200, {
    ok: true,
    savedAs: fileName,
    signatureVerified,
  });
}

function handleDeliveries(response, url) {
  const event = url.searchParams.get('event') || null;
  const deliveryId = url.searchParams.get('deliveryId') || null;
  const signatureVerified = parseBooleanFilter(url.searchParams.get('verified'));
  const limit = parsePositiveInteger(url.searchParams.get('limit'));

  const deliveries = filterDeliveries(readDeliveries(), {
    event,
    deliveryId,
    signatureVerified,
  });
  const limitedDeliveries = limit ? deliveries.slice(0, limit) : deliveries;

  sendJson(response, 200, {
    ok: true,
    deliveries: limitedDeliveries,
    filters: {
      event,
      deliveryId,
      verified: signatureVerified,
      limit,
    },
    total: limitedDeliveries.length,
  });
}

function handleDeliveryDetail(response, deliveryId) {
  const delivery = readDeliveryById(deliveryId);

  if (!delivery) {
    sendJson(response, 404, {
      ok: false,
      error: 'Delivery not found',
      deliveryId,
    });
    return;
  }

  sendJson(response, 200, {
    ok: true,
    delivery,
  });
}

function createServer() {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://localhost');

      if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/deliveries') {
        handleDeliveries(response, url);
        return;
      }

      const deliveryDetailMatch = url.pathname.match(/^\/deliveries\/([^/]+)$/);
      if (request.method === 'GET' && deliveryDetailMatch) {
        handleDeliveryDetail(response, decodeURIComponent(deliveryDetailMatch[1]));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/webhook') {
        await handleWebhook(request, response);
        return;
      }

      sendJson(response, 404, {
        ok: false,
        error: 'Not found',
      });
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        error: 'Internal server error',
      });

      console.error(error);
    }
  });
}

function startServer() {
  const server = createServer();

  server.on('error', (error) => {
    console.error('Failed to start server:', error.message);
    process.exitCode = 1;
  });

  server.listen(PORT, HOST, () => {
    console.log(
      `tiny-webhook-receiver listening on http://${HOST}:${PORT} (secret ${WEBHOOK_SECRET ? 'enabled' : 'disabled'})`
    );
  });

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  createServer,
  startServer,
};
