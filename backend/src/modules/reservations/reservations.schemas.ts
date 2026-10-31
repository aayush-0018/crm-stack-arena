import { z } from 'zod';
import { phoneInput } from '../../lib/phone';
import { dateInput, optionalEmail, optionalText } from '../../lib/validation';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 19:30');

export const settingsSchema = z
  .object({
    opensAt: time,
    closesAt: time,
    closedDays: z
      .array(z.number().int().min(0).max(6))
      .max(6, 'Keep at least one day open')
      .transform((d) => [...new Set(d)].sort()),
    slotMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
    durationMinutes: z.number().int().min(30, 'At least 30 minutes').max(360, 'At most 6 hours'),
    maxParty: z.number().int().min(1).max(50),
    daysAhead: z.number().int().min(1).max(180),
    minNoticeMinutes: z.number().int().min(0).max(2880),
  })
  .refine((s) => s.closesAt > s.opensAt, { path: ['closesAt'], message: 'Closing time must be after opening time' });

/** A booking taken by staff (phone call, walk-up). Tables are optional: none = pick a free one. */
export const reservationSchema = z.object({
  name: z.string({ required_error: 'Name is required' }).trim().min(1, 'Name is required').max(60),
  phone: phoneInput,
  email: optionalEmail.transform((v) => (v ? v.toLowerCase() : null)),
  partySize: z.number({ invalid_type_error: 'How many people?' }).int().min(1, 'At least 1 person').max(100),
  date: dateInput,
  time,
  durationMinutes: z.number().int().min(15).max(720),
  tableIds: z.array(z.number().int().positive()).max(10, 'At most 10 tables for one booking').default([]),
  notes: optionalText(300),
});
export type ReservationInput = z.infer<typeof reservationSchema>;

export const statusSchema = z.object({ status: z.enum(['booked', 'seated', 'finished', 'cancelled', 'no_show']) });

export const dayQuery = z.object({ date: dateInput });

// ---------------------------------------------------------------------------------------------
// Online booking
// ---------------------------------------------------------------------------------------------

export const slotsQuery = z.object({ date: dateInput, party: z.coerce.number().int().min(1).max(50) });
export const floorQuery = slotsQuery.extend({ time });

export const bookingCodeSchema = z.object({
  name: z.string({ required_error: 'Name is required' }).trim().min(1, 'Name is required').max(60),
  phone: phoneInput,
  email: z.string({ required_error: 'Email is required' }).trim().toLowerCase().email('Enter a valid email').max(254),
});

export const bookingConfirmSchema = z.object({
  challenge: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/),
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  date: dateInput,
  time,
  partySize: z.number().int().min(1).max(50),
  /** The table the guest picked on the floor plan; missing = the best free one. */
  tableId: z.number().int().positive().nullish(),
  notes: optionalText(300),
});
export type BookingConfirm = z.infer<typeof bookingConfirmSchema>;
