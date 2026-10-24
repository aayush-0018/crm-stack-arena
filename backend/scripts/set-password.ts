/**
 * Sets a user's password from the command line (for the shop owner, run on your own machine).
 * Usage: npm run set-password -- you@example.com
 * The password is typed at a hidden prompt, so it never lands in shell history.
 */
import bcrypt from 'bcrypt';
import readline from 'readline';
import { pool } from '../src/db/pool';

function askHidden(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
  let prompted = false;
  out._writeToOutput = (s: string) => {
    if (!prompted) {
      out.output.write(s);
      prompted = true;
    }
  };
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  const email = (process.argv[2] ?? '').trim().toLowerCase();
  if (!email) throw new Error('Usage: npm run set-password -- you@example.com');

  const { rows } = await pool.query(`SELECT id FROM users WHERE lower(email) = $1`, [email]);
  if (!rows[0]) throw new Error(`No user with email ${email}`);

  const password = await askHidden('New password (min 8 characters): ');
  if (password.length < 8) throw new Error('Password must be at least 8 characters');
  const again = await askHidden('Repeat it: ');
  if (again !== password) throw new Error('Passwords did not match');

  await pool.query(`UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, [
    rows[0].id,
    await bcrypt.hash(password, 12),
  ]);
  console.log(`Password updated for ${email}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
