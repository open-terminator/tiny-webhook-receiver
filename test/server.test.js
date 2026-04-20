const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tiny-webhook-receiver-'));
process.env.DATA_DIR = path.join(tempRoot, 'data');

const { createServer } = require('../src/server');

function requestJson(server, requestPath) {
  return new Promise((resolve, reject) => {
    const request = new EventEmitter();
    request.method = 'GET';
    request.url = requestPath;
    request.headers = {};

    const response = new EventEmitter();
    const chunks = [];

    response.writeHead = (statusCode, headers) => {
      response.statusCode = statusCode;
      response.headers = headers;
    };

    response.end = (chunk) => {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      try {
        resolve({
          status: response.statusCode,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        });
      } catch (error) {
        reject(error);
      }
    };

    server.emit('request', request, response);
  });
}

test.after(() => {
  delete process.env.DATA_DIR;
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test.beforeEach(() => {
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
});

test('GET /deliveries filters by event, verification, and limit', async () => {
  const deliveries = [
    {
      fileName: '2026-04-18T11-00-00-000Z_alpha.json',
      delivery: {
        receivedAt: '2026-04-18T11:00:00.000Z',
        deliveryId: 'alpha',
        event: 'push',
        signatureVerified: true,
      },
    },
    {
      fileName: '2026-04-18T10-00-00-000Z_beta.json',
      delivery: {
        receivedAt: '2026-04-18T10:00:00.000Z',
        deliveryId: 'beta',
        event: 'issues',
        signatureVerified: false,
      },
    },
    {
      fileName: '2026-04-18T09-00-00-000Z_gamma.json',
      delivery: {
        receivedAt: '2026-04-18T09:00:00.000Z',
        deliveryId: 'gamma',
        event: 'push',
        signatureVerified: false,
      },
    },
  ];

  for (const { fileName, delivery } of deliveries) {
    fs.writeFileSync(
      path.join(process.env.DATA_DIR, fileName),
      JSON.stringify(delivery, null, 2)
    );
  }

  const server = createServer();

  const filtered = await requestJson(server, '/deliveries?event=push&verified=false&limit=1');

  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.ok, true);
  assert.deepEqual(filtered.body.filters, {
    event: 'push',
    deliveryId: null,
    verified: false,
    limit: 1,
  });
  assert.equal(filtered.body.total, 1);
  assert.equal(filtered.body.deliveries.length, 1);
  assert.equal(filtered.body.deliveries[0].deliveryId, 'gamma');

  const byDeliveryId = await requestJson(server, '/deliveries?deliveryId=beta');

  assert.equal(byDeliveryId.status, 200);
  assert.equal(byDeliveryId.body.total, 1);
  assert.equal(byDeliveryId.body.deliveries[0].event, 'issues');
  assert.equal(byDeliveryId.body.deliveries[0].signatureVerified, false);
});

test('GET /deliveries/:deliveryId returns a saved delivery or 404', async () => {
  const delivery = {
    receivedAt: '2026-04-18T12:00:00.000Z',
    deliveryId: 'detail-123',
    event: 'pull_request',
    signatureVerified: true,
    payload: {
      action: 'opened',
      number: 42,
    },
  };

  fs.writeFileSync(
    path.join(process.env.DATA_DIR, '2026-04-18T12-00-00-000Z_detail-123.json'),
    JSON.stringify(delivery, null, 2)
  );

  const server = createServer();

  const found = await requestJson(server, '/deliveries/detail-123');

  assert.equal(found.status, 200);
  assert.equal(found.body.ok, true);
  assert.deepEqual(found.body.delivery, {
    fileName: '2026-04-18T12-00-00-000Z_detail-123.json',
    ...delivery,
  });

  const missing = await requestJson(server, '/deliveries/missing-id');

  assert.equal(missing.status, 404);
  assert.deepEqual(missing.body, {
    ok: false,
    error: 'Delivery not found',
    deliveryId: 'missing-id',
  });
});
