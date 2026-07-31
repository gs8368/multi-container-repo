const keys = require('./keys');

// Express App Setup
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const requiredConfig = [
  ['REDIS_HOST', keys.redisHost],
  ['PGUSER', keys.pgUser],
  ['PGHOST', keys.pgHost],
  ['PGDATABASE', keys.pgDatabase],
  ['PGPASSWORD', keys.pgPassword],
];

const missingConfig = requiredConfig
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missingConfig.length > 0) {
  console.error('Missing required environment variables:', missingConfig.join(', '));
}

// Postgres Client Setup
const { Pool } = require('pg');

// Local compose usually runs Postgres without SSL, but managed Postgres often requires it.
const shouldUsePgSsl = keys.pgSslMode === 'require';

const pgClient = new Pool({
  user: keys.pgUser,
  host: keys.pgHost,
  database: keys.pgDatabase,
  password: keys.pgPassword,
  port: keys.pgPort,
  ssl: shouldUsePgSsl ? { rejectUnauthorized: false } : false,
});

pgClient.on('connect', (client) => {
  client
    .query('CREATE TABLE IF NOT EXISTS values (number INT)')
    .catch((err) => console.error(err));
});

// Redis Client Setup
const redis = require('redis');
const redisClient = redis.createClient({
  host: keys.redisHost,
  port: keys.redisPort,
  retry_strategy: () => 1000,
});
const redisPublisher = redisClient.duplicate();

// Prevent process crashes when Redis is temporarily unavailable.
redisClient.on('error', (err) => {
  console.error('Redis client error:', err.message);
});

redisPublisher.on('error', (err) => {
  console.error('Redis publisher error:', err.message);
});

// Express route handlers

app.get('/', (req, res) => {
  res.send('Hi');
});

app.get('/values/all', async (req, res) => {
  try {
    const values = await pgClient.query('SELECT * from values');
    res.send(values.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: 'Could not fetch values' });
  }
});

app.get('/values/current', async (req, res) => {
  redisClient.hgetall('values', (err, values) => {
    if (err) {
      console.error(err);
      return res.status(500).send({ error: 'Could not fetch current values' });
    }
    res.send(values);
  });
});

app.post('/values', async (req, res) => {
  if (missingConfig.length > 0) {
    return res.status(503).send({
      error: 'Server is not configured with required environment variables',
      missing: missingConfig,
    });
  }

  const rawIndex = req.body.index;

  if (rawIndex === undefined || rawIndex === null) {
    return res.status(422).send('Index is required');
  }

  if (typeof rawIndex === 'string' && rawIndex.trim() === '') {
    return res.status(422).send('Index is required');
  }

  const index = Number(rawIndex);

  if (!Number.isInteger(index) || index < 0) {
    return res.status(422).send('Index must be a non-negative integer');
  }

  if (index > 40) {
    return res.status(422).send('Index too high');
  }

  try {
    redisClient.hset('values', index, 'Nothing yet!');
    redisPublisher.publish('insert', String(index));
    await pgClient.query('INSERT INTO values(number) VALUES($1)', [index]);
    res.send({ working: true });
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: 'Could not save value', detail: err.message });
  }
});

app.listen(5000, (err) => {
  console.log('Listening');
});
