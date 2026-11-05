import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { pool } from '../../db/pool';
import { ah } from '../../lib/asyncHandler';
import { AppError } from '../../lib/errors';
import { sendMail } from '../../lib/mailer';
import { createLimiter } from '../../lib/throttle';

/** The small Complaints form: anyone (signed in or not) can send one; it is saved and emailed to the Grievance Officer. */
export const publicComplaintsRouter = Router();

const TOPIC_LABEL = { privacy: 'Privacy / personal data', billing: 'Billing or refund', other: 'Something else' } as const;

const complaintSchema = z.object({
  topic: z.enum(['privacy', 'billing', 'other']).default('other'),
  name: z.string({ required_error: 'Enter your name' }).trim().min(1, 'Enter your name').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email').max(254),
  message: z.string().trim().min(10, 'Please describe the problem (at least 10 characters)').max(2000),
});

// 5 complaints per IP address per hour stops spam without getting in a real person's way.
const byIp = createLimiter(5, 60 * 60 * 1000);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

publicComplaintsRouter.post(
  '/complaints',
  ah(async (req, res) => {
    const ip = req.ip ?? 'unknown';
    if (byIp.retryAfter(ip) > 0) throw new AppError(429, 'TOO_MANY_TRIES', 'Too many complaints from here. Please email us instead.');
    const b = complaintSchema.parse(req.body);
    byIp.hit(ip);
    const { rows } = await pool.query(
      `INSERT INTO complaints (topic, name, email, message) VALUES ($1, $2, $3, $4) RETURNING id, created_at AS "createdAt"`,
      [b.topic, b.name, b.email, b.message],
    );
    const reference = `CMP-${String(rows[0].id).padStart(6, '0')}`;

    // Saved either way; a mail hiccup must not lose the complaint or show the person an error.
    const lines = [`Reference: ${reference}`, `Topic: ${TOPIC_LABEL[b.topic]}`, `From: ${b.name} <${b.email}>`, '', b.message];
    await sendMail({
      to: env.GRIEVANCE_EMAIL,
      subject: `[${reference}] Complaint: ${TOPIC_LABEL[b.topic]}`,
      text: `${lines.join('\n')}\n\nReply to the sender within 30 days.`,
      html: `<p><strong>Reference:</strong> ${reference}<br><strong>Topic:</strong> ${TOPIC_LABEL[b.topic]}<br><strong>From:</strong> ${esc(b.name)} &lt;${esc(b.email)}&gt;</p><p style="white-space:pre-wrap">${esc(b.message)}</p><p>Reply to the sender within 30 days.</p>`,
    }).catch((err) => console.error(`complaint ${reference}: email to the Grievance Officer failed`, err));

    res.status(201).json({ reference });
  }),
);
