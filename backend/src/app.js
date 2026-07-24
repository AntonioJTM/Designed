'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const env = require('./config/env');
const apiV1 = require('./routes');
const { notFound, errorHandler } = require('./middlewares/error');

// Construye la aplicación Express (sin arrancarla; ver server.js).
const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(',').map((o) => o.trim()),
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

if (env.nodeEnv !== 'test') {
  app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));
}

// Health check sencillo, fuera del versionado.
app.get('/health', (req, res) => {
  res.json({ data: { estado: 'ok' }, error: null });
});

// API versionada.
app.use('/api/v1', apiV1);

// 404 + manejador de errores (siempre al final).
app.use(notFound);
app.use(errorHandler);

module.exports = app;
