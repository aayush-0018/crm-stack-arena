import { env } from '../config/env';

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Sends one email over HTTPS. Render's free tier blocks SMTP ports, so every provider here
 * is an HTTP API (no Nodemailer). MAIL_PROVIDER=console (the default) just prints the email,
 * which keeps local development fully offline.
 */
export async function sendMail(mail: Mail): Promise<void> {
  switch (env.MAIL_PROVIDER) {
    case 'console':
      console.log(`\n--- email (MAIL_PROVIDER=console, not sent) ---\nTo: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n---\n`);
      return;

    case 'brevo':
      return post('https://api.brevo.com/v3/smtp/email', { 'api-key': env.MAIL_API_KEY! }, {
        sender: { email: env.MAIL_FROM, name: env.MAIL_FROM_NAME },
        to: [{ email: mail.to }],
        subject: mail.subject,
        htmlContent: mail.html,
        textContent: mail.text,
      });

    case 'resend':
      return post('https://api.resend.com/emails', { Authorization: `Bearer ${env.MAIL_API_KEY}` }, {
        from: `${env.MAIL_FROM_NAME} <${env.MAIL_FROM}>`,
        to: [mail.to],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      });
  }
}

async function post(url: string, auth: Record<string, string>, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...auth },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`${env.MAIL_PROVIDER} rejected the email: HTTP ${res.status} ${detail}`);
  }
}
