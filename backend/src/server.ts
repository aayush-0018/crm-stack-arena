import { app } from './app';
import { env } from './config/env';
import { pool } from './db/pool';

const server = app.listen(env.PORT, env.HOST, () => {
  console.log(`CRM API listening on http://${env.HOST}:${env.PORT}`);
});

const shutdown = () => {
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
