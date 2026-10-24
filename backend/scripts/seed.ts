/**
 * Local test data: adds 100 customers with orders and invoices to an existing shop.
 * Usage: npm run seed -- [shopId]   (defaults to the only shop in the database)
 *
 * Goes through the same services as the API, so totals, numbering and invoice
 * snapshots follow the real rules. Dates are spread over the last 180 days.
 */
import { pool } from '../src/db/pool';
import { customerInput } from '../src/modules/customers/customers.schemas';
import { createCustomer } from '../src/modules/customers/customers.service';
import { generateInvoice } from '../src/modules/invoices/invoices.service';
import { createOrderSchema } from '../src/modules/orders/orders.schemas';
import { createOrder, setPayment, setStatus } from '../src/modules/orders/orders.service';

const CUSTOMERS = 100;
const DAYS = 180;

// Deterministic RNG so reruns on a fresh DB produce the same data.
let s = 20261022;
const rand = () => {
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];

const FIRST = [
  'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Krishna', 'Ishaan', 'Rohan',
  'Ananya', 'Diya', 'Saanvi', 'Aadhya', 'Pari', 'Anika', 'Navya', 'Riya', 'Meera', 'Kavya',
  'Rahul', 'Amit', 'Suresh', 'Ramesh', 'Mahesh', 'Priya', 'Neha', 'Pooja', 'Sunita', 'Geeta',
  'Vikram', 'Deepak', 'Manoj', 'Sanjay', 'Kiran', 'Lakshmi', 'Asha', 'Rekha', 'Farhan', 'Imran',
];
const LAST = [
  'Sharma', 'Verma', 'Gupta', 'Agarwal', 'Jain', 'Patel', 'Shah', 'Mehta', 'Reddy', 'Nair',
  'Iyer', 'Singh', 'Kumar', 'Yadav', 'Mishra', 'Joshi', 'Chauhan', 'Bansal', 'Khan', 'Das',
];
const AREAS = [
  'MG Road', 'Station Road', 'Gandhi Nagar', 'Civil Lines', 'Shastri Nagar', 'Nehru Colony',
  'Sector 14', 'Model Town', 'Rajendra Nagar', 'Old Market',
];

// [name, unit, min price, max price (rupees), max qty, decimals allowed]
const CATALOG: [string, string | null, number, number, number, boolean][] = [
  ['Basmati Rice', 'kg', 90, 140, 10, true],
  ['Sona Masoori Rice', 'kg', 55, 70, 25, true],
  ['Wheat Atta', 'kg', 38, 52, 20, true],
  ['Toor Dal', 'kg', 140, 180, 5, true],
  ['Moong Dal', 'kg', 110, 140, 5, true],
  ['Chana Dal', 'kg', 80, 105, 5, true],
  ['Sugar', 'kg', 42, 48, 10, true],
  ['Rock Salt', 'kg', 28, 40, 3, false],
  ['Mustard Oil', 'L', 150, 185, 5, false],
  ['Sunflower Oil', 'L', 130, 160, 5, false],
  ['Desi Ghee', 'L', 520, 650, 2, false],
  ['Tea Leaves 250g', 'pcs', 120, 160, 4, false],
  ['Instant Coffee 100g', 'pcs', 280, 340, 2, false],
  ['Milk 1L', 'pcs', 56, 68, 6, false],
  ['Paneer 200g', 'pcs', 85, 100, 3, false],
  ['Curd 400g', 'pcs', 40, 50, 4, false],
  ['Butter 100g', 'pcs', 56, 60, 3, false],
  ['Bread', 'pcs', 40, 55, 3, false],
  ['Eggs (dozen)', 'pcs', 78, 96, 3, false],
  ['Turmeric Powder 200g', 'pcs', 60, 80, 2, false],
  ['Red Chilli Powder 200g', 'pcs', 70, 95, 2, false],
  ['Garam Masala 100g', 'pcs', 65, 90, 2, false],
  ['Jeera 100g', 'pcs', 45, 70, 2, false],
  ['Biscuits Pack', 'pcs', 10, 40, 10, false],
  ['Namkeen 400g', 'pcs', 90, 120, 4, false],
  ['Maggi Noodles', 'pcs', 14, 15, 12, false],
  ['Detergent Powder 1kg', 'pcs', 110, 140, 3, false],
  ['Bath Soap', 'pcs', 35, 55, 8, false],
  ['Toothpaste', 'pcs', 95, 130, 3, false],
  ['Shampoo 180ml', 'pcs', 150, 210, 2, false],
  ['Dishwash Bar', 'pcs', 10, 25, 6, false],
  ['Onion', 'kg', 25, 50, 5, true],
  ['Potato', 'kg', 20, 40, 8, true],
  ['Tomato', 'kg', 20, 60, 4, true],
];

const rupees = (n: number) => n.toFixed(2);

async function main() {
  const argShop = Number(process.argv[2]) || null;
  const shops = (await pool.query(`SELECT id, name FROM shops ORDER BY id`)).rows as { id: number; name: string }[];
  const shop = argShop ? shops.find((x) => x.id === argShop) : shops.length === 1 ? shops[0] : null;
  if (!shop) {
    throw new Error(argShop ? `Shop ${argShop} not found` : `Found ${shops.length} shops; pass a shop id: npm run seed -- <id>`);
  }
  const owner = (await pool.query(`SELECT id FROM users WHERE shop_id = $1 ORDER BY id LIMIT 1`, [shop.id])).rows[0];
  if (!owner) throw new Error(`Shop ${shop.id} has no user`);
  const shopId = shop.id;
  const userId: number = owner.id;
  console.log(`Seeding shop ${shopId} (${shop.name})…`);

  const usedPhones = new Set<string>(
    (await pool.query(`SELECT phone FROM customers WHERE shop_id = $1`, [shopId])).rows.map((r) => r.phone),
  );
  const { rows: todayRows } = await pool.query(`SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS d`);
  const today = new Date(`${todayRows[0].d}T00:00:00Z`);
  const isoDaysAgo = (n: number) => new Date(today.getTime() - n * 86_400_000).toISOString().slice(0, 10);

  let orders = 0;
  let invoices = 0;
  let outdated = 0;

  for (let i = 0; i < CUSTOMERS; i++) {
    let phone: string;
    do phone = `${pick(['6', '7', '8', '9'])}${String(int(0, 999_999_999)).padStart(9, '0')}`;
    while (usedPhones.has(phone));
    usedPhones.add(phone);

    const first = pick(FIRST);
    const last = pick(LAST);
    const customer = await createCustomer(
      pool,
      shopId,
      customerInput.parse({
        name: `${first} ${last}`,
        phone,
        email: rand() < 0.4 ? `${first}.${last}${int(1, 99)}@example.com`.toLowerCase() : '',
        address: rand() < 0.7 ? `${int(1, 250)}, ${pick(AREAS)}` : '',
        notes: rand() < 0.1 ? 'Prefers home delivery' : '',
      }),
    );

    // Customer joined somewhere in the window; regulars order more often.
    const joinedDaysAgo = int(5, DAYS);
    await pool.query(`UPDATE customers SET created_at = $2::date - interval '1 day' + interval '10 hours', updated_at = created_at WHERE id = $1`, [
      customer.id,
      isoDaysAgo(joinedDaysAgo),
    ]);
    const orderCount = rand() < 0.08 ? 0 : rand() < 0.25 ? int(6, 10) : int(1, 5);

    for (let k = 0; k < orderCount; k++) {
      const daysAgo = Math.floor(Math.pow(rand(), 1.3) * joinedDaysAgo); // more recent orders weigh heavier
      const orderDate = isoDaysAgo(daysAgo);

      const items = Array.from({ length: int(1, 6) }, () => {
        const [name, unit, min, max, maxQty, decimals] = pick(CATALOG);
        const qty = decimals ? (int(2, maxQty * 2) / 2).toString() : String(int(1, maxQty));
        return { itemName: name, quantity: qty, unit, unitPrice: rupees(min + rand() * (max - min)) };
      });
      // Merge duplicate picks so each item appears once.
      const merged = new Map<string, (typeof items)[number]>();
      for (const it of items) if (!merged.has(it.itemName)) merged.set(it.itemName, it);

      const order = (
        await createOrder(
          shopId,
          userId,
          createOrderSchema.parse({
            customerId: customer.id,
            items: [...merged.values()],
            discount: rand() < 0.15 ? String(int(5, 50)) : '0',
            amountPaid: '0',
            orderDate,
            notes: rand() < 0.08 ? 'Deliver after 6 pm' : null,
          }),
        )
      ).order;
      orders++;

      // Payment: older orders are mostly settled.
      const r = rand();
      const paidShare = daysAgo > 30 ? (r < 0.85 ? 1 : r < 0.95 ? 0.5 : 0) : r < 0.55 ? 1 : r < 0.8 ? 0.4 : 0;
      const paid = Math.round(order.totalPaise * paidShare);
      if (paid > 0) await setPayment(shopId, order.id, paid);

      // Status: cancelled ~4%, otherwise completed if older than a few days.
      const cancelled = rand() < 0.04;
      const status = cancelled ? 'cancelled' : daysAgo > 3 || rand() < 0.4 ? 'completed' : 'open';

      // Invoice most non-cancelled orders; dated to the order date.
      if (!cancelled && rand() < 0.85) {
        const { id: invoiceId } = await generateInvoice(shopId, userId, order.id, false);
        invoices++;
        await pool.query(
          `UPDATE invoices SET invoice_date = $2::date,
             issued_at = $2::date + interval '11 hours' + make_interval(mins => $3),
             created_at = $2::date + interval '11 hours' + make_interval(mins => $3)
           WHERE id = $1`,
          [invoiceId, orderDate, int(0, 480)],
        );
        // A few recent invoices get a later payment, so they show as "order changed since invoice".
        if (daysAgo < 20 && paid < order.totalPaise && rand() < 0.25) {
          await setPayment(shopId, order.id, order.totalPaise);
          outdated++;
        }
      }
      if (status !== 'open') await setStatus(shopId, order.id, status);

      // Timestamps follow the order date.
      await pool.query(
        `UPDATE orders SET created_at = $2::date + interval '10 hours' + make_interval(mins => $3),
           updated_at = $2::date + interval '10 hours' + make_interval(mins => $3)
         WHERE id = $1`,
        [order.id, orderDate, int(0, 600)],
      );
    }
  }

  console.log(`Done: ${CUSTOMERS} customers, ${orders} orders, ${invoices} invoices (${outdated} with later payments).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
