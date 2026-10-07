/**
 * Lightweight public health endpoint for Render, Railway, and external uptime monitors.
 *
 * This route intentionally does not query the database or Google Sheets. A monitor
 * must be able to wake a sleeping web service without waiting on application data.
 */

const { Router } = require('express');

function healthPayload() {
  return {
    status: 'ok',
    service: 'whatsapp-lead-automation',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  };
}

function respondHealthy(_req, res) {
  res.set('Cache-Control', 'no-store, max-age=0');
  return res.status(200).json(healthPayload());
}

function respondHealthyHead(_req, res) {
  res.set('Cache-Control', 'no-store, max-age=0');
  return res.status(200).end();
}

function createHealthRouter() {
  const router = Router();
  router.get('/', respondHealthy);
  router.head('/', respondHealthyHead);
  return router;
}

module.exports = { createHealthRouter, healthPayload };
