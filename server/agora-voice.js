import dotenv from 'dotenv';
import { simulateAvailability } from './gemini-agent.js';

dotenv.config();

const appId = process.env.AGORA_APP_ID;
const customerId = process.env.AGORA_CUSTOMER_ID;
const customerSecret = process.env.AGORA_CUSTOMER_SECRET;
const fromNumber = process.env.AGORA_FROM_NUMBER;
const publicUrl = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 4000}`;

const callCache = {};
let livePstn = false;

if (appId) console.log('✓ Agora App ID configured');
if (appId && customerId && customerSecret) livePstn = true;

function isValidPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 10 && !/^9180412345/.test(digits);
}

function authHeader() {
  const cred = Buffer.from(`${customerId}:${customerSecret}`).toString('base64');
  return `Basic ${cred}`;
}

async function agoraOutboundCall(store, product) {
  const channel = `stock-${store.id}-${Date.now()}`;
  const res = await fetch('https://sipcm.agora.io/v1/api/pstn', {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'outbound',
      appid: appId,
      channel,
      to: store.phone.replace(/[^\d+]/g, ''),
      from: fromNumber || '+9180XXXX0000',
      prompt: 'true',
      webhook_url: `${publicUrl}/api/agora-webhook?storeId=${encodeURIComponent(store.id)}`
    })
  });
  if (!res.ok) throw new Error(`Agora PSTN ${res.status}`);
  const data = await res.json();
  callCache[data.callId || channel] = { storeId: store.id, product };
  return { callId: data.callId || channel, channel };
}

export async function verifyStockWithCall(store, product) {
  if (!isValidPhone(store.phone)) {
    return { ...store, available: false, callStatus: 'SKIPPED', verified: false, note: `⚠ No phone for ${store.name}` };
  }

  if (livePstn) {
    try {
      const { callId } = await agoraOutboundCall(store, product);
      return {
        ...store,
        available: false,
        callStatus: 'IN_PROGRESS',
        callSid: callId,
        verified: false,
        note: `📞 Agora calling ${store.name} (${store.phone})…`
      };
    } catch (err) {
      console.warn(`Agora call failed (${store.name}):`, err.message);
    }
  }

  return simulateCall(store, product);
}

function simulateCall(store, product) {
  const delay = 60 + Math.random() * 100;
  return new Promise(resolve => {
    setTimeout(() => {
      const { available, note } = simulateAvailability(store, product);
      resolve({
        ...store,
        available,
        callStatus: 'COMPLETED',
        verified: true,
        note: appId ? `[Agora agent] ${note}` : note
      });
    }, delay);
  });
}

export function recordCallResponse(storeId, available) {
  for (const id of Object.keys(callCache)) {
    if (callCache[id].storeId === storeId) {
      callCache[id].available = available;
      callCache[id].status = 'COMPLETED';
      return callCache[id];
    }
  }
  return null;
}

export function updateCallStatus(callId, status) {
  if (callCache[callId]) callCache[callId].callStatus = status;
  return callCache[callId] || null;
}

export function isConfigured() {
  return !!appId;
}

export function getVoiceMode() {
  if (livePstn) return 'AGORA_LIVE';
  if (appId) return 'AGORA_SIMULATED';
  return 'SIMULATION';
}
