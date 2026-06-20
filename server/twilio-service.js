import twilio from 'twilio';
import dotenv from 'dotenv';
import { simulateAvailability } from './gemini-agent.js';

dotenv.config();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
const publicUrl = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 4000}`;

let client = null;
const callCache = {};

if (accountSid && authToken && fromPhoneNumber) {
  client = twilio(accountSid, authToken);
  console.log('✓ Twilio client initialized');
} else {
  console.log('⚠ Twilio not configured — simulation mode');
}

function isValidPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 10 && !/^9180412345/.test(digits);
}

export async function verifyStockWithCall(store, product) {
  if (!isValidPhone(store.phone)) {
    return {
      ...store,
      available: false,
      callStatus: 'SKIPPED',
      verified: false,
      note: `⚠ No verified Google phone for ${store.name} — skipped call.`
    };
  }

  if (!client) {
    return simulateCall(store, product);
  }

  try {
    const cleanPhone = store.phone.replace(/[^\d+]/g, '');
    const callbackBase = `${publicUrl}/api/call-callback?storeId=${encodeURIComponent(store.id)}`;
    const statusBase = `${publicUrl}/api/call-status?storeId=${encodeURIComponent(store.id)}`;

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Aditi">Hello, this is Stock Hunt Bengaluru. Do you currently have ${product} available for in-store purchase? Press 1 for yes, press 0 for no.</Say>
  <Gather numDigits="1" action="${callbackBase}" method="POST" timeout="12">
    <Say voice="Polly.Aditi">Press 1 if in stock, 0 if not available.</Say>
  </Gather>
  <Say voice="Polly.Aditi">Thank you, goodbye.</Say>
</Response>`;

    const call = await client.calls.create({
      to: cleanPhone,
      from: fromPhoneNumber,
      twiml,
      statusCallback: statusBase,
      statusCallbackMethod: 'POST'
    });

    callCache[call.sid] = { storeId: store.id, storeName: store.name, product, available: null };

    return {
      ...store,
      available: false,
      callStatus: 'IN_PROGRESS',
      callSid: call.sid,
      verified: false,
      note: `📞 Live call in progress to ${store.name}...`
    };
  } catch (error) {
    console.error(`Twilio error (${store.name}):`, error.message);
    const sim = simulateAvailability(store, product);
    return {
      ...store,
      ...sim,
      callStatus: 'ERROR',
      verified: false,
      note: `Could not reach ${store.name} — ${sim.note}`
    };
  }
}

function simulateCall(store, product) {
  const delay = 80 + Math.random() * 120;
  return new Promise(resolve => {
    setTimeout(() => {
      const { available, note } = simulateAvailability(store, product);
      resolve({
        ...store,
        available,
        callStatus: 'COMPLETED',
        verified: true,
        note
      });
    }, delay);
  });
}

export function recordCallResponse(storeId, digits) {
  for (const sid of Object.keys(callCache)) {
    if (callCache[sid].storeId === storeId) {
      callCache[sid].available = digits === '1';
      callCache[sid].response = digits;
      callCache[sid].status = 'COMPLETED';
      return callCache[sid];
    }
  }
  return null;
}

export function updateCallStatus(callSid, status) {
  if (callCache[callSid]) callCache[callSid].callStatus = status;
  return callCache[callSid] || null;
}

export function getCallStatus(callSid) {
  return callCache[callSid] || null;
}

export function isConfigured() {
  return !!client;
}
