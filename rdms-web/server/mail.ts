/**
 * Outgoing email for "Talk to Our Team" enquiries. Delivery uses SMTP and is configured only on the server, through
 * environment variables (never in frontend code):
 *   SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS, SMTP_SECURE ("true" for port 465),
 *   MAIL_FROM (default "UniRise <no-reply@mentoredge.co.in>"), ENQUIRY_TO (default corporate@mentoredge.co.in)
 * Every enquiry is also stored in the platform database (table `enquiries`), so nothing is lost if mail is not set up.
 */
import nodemailer from 'nodemailer';

export interface Mail { to: string; subject: string; text: string; replyTo?: string }
export type Mailer = (m: Mail) => Promise<{ ok: boolean; note: string }>;

export const ENQUIRY_TO = process.env.ENQUIRY_TO || 'corporate@mentoredge.co.in';

let transport: nodemailer.Transporter | null | undefined;
function getTransport() {
  if (transport !== undefined) return transport;
  const host = process.env.SMTP_HOST;
  transport = host ? nodemailer.createTransport({
    host, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  }) : null;
  return transport;
}

export const defaultMailer: Mailer = async (m) => {
  const t = getTransport();
  if (!t) {
    console.warn(`[mail] SMTP is not configured; enquiry stored but not emailed to ${m.to}. Set SMTP_HOST (see server/mail.ts).`);
    return { ok: false, note: 'SMTP not configured' };
  }
  try {
    await t.sendMail({ from: process.env.MAIL_FROM || 'UniRise <no-reply@mentoredge.co.in>', to: m.to, subject: m.subject, text: m.text, replyTo: m.replyTo });
    return { ok: true, note: 'sent' };
  } catch (e) {
    console.error('[mail] sending failed:', (e as Error).message);
    return { ok: false, note: `send failed: ${(e as Error).message}`.slice(0, 300) };
  }
};

export function enquiryEmail(e: Record<string, string>): Mail {
  const rows: [string, string][] = [
    ['Institution', e.institutionName], ['Institution type', e.institutionType], ['City', e.city], ['State', e.state], ['Country', e.country],
    ['Contact person', e.contactName], ['Designation', e.designation || '—'], ['Email', e.email], ['Phone', e.phone || '—'],
    ['Approximate faculty', e.facultyCount], ['Area of interest', e.interest || '—'], ['Message', e.message || '—'],
  ];
  return {
    to: ENQUIRY_TO, replyTo: e.email,
    subject: `UniRise enquiry: ${e.institutionName} (${e.city}, ${e.country})`,
    text: `New "Talk to Our Team" enquiry from the UniRise website\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n`,
  };
}
