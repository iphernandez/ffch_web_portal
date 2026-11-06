import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { defineSecret, defineString } from 'firebase-functions/params';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import nodemailer from 'nodemailer';

initializeApp();

const SMTP_PASSWORD = defineSecret('SMTP_PASSWORD');
const SMTP_USER = defineString('SMTP_USER', { description: 'SMTP login, e.g. the Gmail address that sends the emails' });
const SMTP_HOST = defineString('SMTP_HOST', { default: 'smtp.gmail.com' });
const SMTP_PORT = defineString('SMTP_PORT', { default: '465' });
const MAIL_FROM = defineString('MAIL_FROM', { description: 'From header, e.g. F.F.C.H. <ffch@gmail.com>' });

const MAX_RECIPIENTS = 5;
const MAX_BODY_LENGTH = 100_000;

let transporter;

// ---------- Trigger ----------

/** Sends documents the web app writes to `mail/{id}` ({ to: string[], message: { subject, text, html } }). */
export const sendQueuedMail = onDocumentCreated(
  { document: 'mail/{mailId}', secrets: [SMTP_PASSWORD], retry: false, maxInstances: 2 },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    // Eventarc delivers at least once; claiming the doc first prevents duplicate emails.
    if (!(await claim(snapshot.ref))) return;

    const { to, message } = snapshot.data();
    const problem = validate(to, message);
    if (problem) {
      await markDelivery(snapshot.ref, { state: 'ERROR', error: problem });
      return;
    }

    try {
      const info = await getTransporter().sendMail({
        from: MAIL_FROM.value() || SMTP_USER.value(),
        to,
        subject: message.subject,
        text: message.text,
        html: message.html
      });
      await markDelivery(snapshot.ref, { state: 'SUCCESS', messageId: info.messageId ?? null });
    } catch (error) {
      logger.error('Error enviando correo', { mailId: event.params.mailId, error: error.message });
      await markDelivery(snapshot.ref, { state: 'ERROR', error: error.message });
    }
  }
);

// ---------- Helpers ----------

function getTransporter() {
  transporter ??= nodemailer.createTransport({
    host: SMTP_HOST.value(),
    port: Number(SMTP_PORT.value()),
    secure: Number(SMTP_PORT.value()) === 465,
    auth: { user: SMTP_USER.value(), pass: SMTP_PASSWORD.value() }
  });
  return transporter;
}

async function claim(ref) {
  return getFirestore().runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (current.get('delivery')) return false;
    tx.update(ref, { delivery: { state: 'PROCESSING', startedAt: FieldValue.serverTimestamp() } });
    return true;
  });
}

function markDelivery(ref, delivery) {
  return ref.update({ delivery: { ...delivery, endedAt: FieldValue.serverTimestamp() } });
}

function validate(to, message) {
  const recipientsOk =
    Array.isArray(to) &&
    to.length > 0 &&
    to.length <= MAX_RECIPIENTS &&
    to.every((address) => typeof address === 'string' && /^[^\s@]+@[^\s@]+$/.test(address));
  if (!recipientsOk) return 'Destinatarios inválidos';

  if (!message || typeof message.subject !== 'string' || !message.subject.trim()) return 'Falta el asunto';
  const bodies = [message.text, message.html].filter((body) => typeof body === 'string');
  if (!bodies.length) return 'Falta el contenido';
  if (bodies.some((body) => body.length > MAX_BODY_LENGTH)) return 'Contenido demasiado largo';
  return null;
}
