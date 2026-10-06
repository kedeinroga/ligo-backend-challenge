#!/usr/bin/env node
// Sends a signed payment notification to the local API.
//
//   node scripts/send-webhook.mjs <operation_id> <type> <amount> <currency> [event_id]
//   node scripts/send-webhook.mjs op_<uuid> payment.succeeded 100.00 PEN
//
// Signs with WEBHOOK_SIGNING_SECRET, or with the docker compose demo secret when unset.
// For `npm run start:dev` use WEBHOOK_SIGNING_SECRET=dev-only-webhook-signing-secret.
import { createHmac, randomUUID } from 'node:crypto';

const [operationId, type, amount, currency, eventId = `evt_${randomUUID()}`] = process.argv.slice(2);
if (!operationId || !type || !amount || !currency) {
  console.error('usage: node scripts/send-webhook.mjs <operation_id> <type> <amount> <currency> [event_id]');
  process.exit(1);
}

const secret = process.env.WEBHOOK_SIGNING_SECRET ?? 'compose-demo-webhook-signing-secret';
const url = process.env.WEBHOOK_URL ?? 'http://localhost:3000/webhooks/payment';

const payload = {
  event_id: eventId,
  type,
  operation_id: operationId,
  amount: Number(amount),
  currency,
  ...(type === 'payment.succeeded' && { provider_charge_id: `ch_${randomUUID()}` }),
  ...(type === 'payment.failed' && { failure_reason: 'insufficient_funds' }),
};
const body = JSON.stringify(payload);
const timestamp = Math.floor(Date.now() / 1000);
const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

const response = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-provider-signature': `t=${timestamp},v1=${signature}` },
  body,
});
console.log(response.status, await response.text());
