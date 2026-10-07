/**
 * WhatsApp API routes.
 *
 * @module api/routes/whatsapp
 */

const { Router } = require('express');
const QRCode = require('qrcode');
const container = require('../../container');
const { requireAdmin } = require('../admin-auth');

const router = Router();

router.get('/status', (_req, res) => {
  try {
    const client = container.whatsapp.getClient();
    const info = client.info;
    const lifecycle = container.whatsapp.getStatus();

    if (lifecycle.connected && info && info.wid) {
      res.json({
        ...lifecycle,
        connected: true,
        phoneNumber: info.wid.user || null,
        name: info.pushname || null,
        platform: info.platform || null,
      });
    } else {
      res.json({ ...lifecycle, connected: false, phoneNumber: null, name: null, platform: null });
    }
  } catch {
    res.json({ ...container.whatsapp.getStatus(), connected: false, phoneNumber: null, name: null, platform: null });
  }
});

router.get('/qr', requireAdmin, async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const qr = container.whatsapp.getQr();
    if (qr) {
      const base64 = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
      res.json({ qr: base64, available: true });
    } else {
      res.json({ qr: null, available: false });
    }
  } catch {
    res.json({ qr: null, available: false });
  }
});

router.get('/qr-image', requireAdmin, async (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  try {
    const qr = container.whatsapp.getQr();
    if (!qr) return res.status(404).json({ error: 'No QR required or available yet' });
    res.type('png').send(await QRCode.toBuffer(qr, { width: 400, margin: 2 }));
  } catch (error) { next(error); }
});

router.post('/reconnect', requireAdmin, async (_req, res, next) => {
  try {
    const whatsapp = container.whatsapp;
    await whatsapp.reconnect();
    res.json({ success: true, message: 'WhatsApp reconnection started' });
  } catch (err) {
    next(err);
  }
});

router.post('/disconnect', requireAdmin, async (_req, res, next) => {
  try {
    await container.whatsapp.destroy();
    res.json({ success: true, message: 'WhatsApp client disconnected' });
  } catch (err) {
    next(err);
  }
});

router.post('/reset-session', requireAdmin, async (_req, res, next) => {
  try {
    await container.whatsapp.resetSession();
    res.json({ success: true, message: 'Stored session reset; a fresh QR login is required' });
  } catch (error) { next(error); }
});

module.exports = router;
