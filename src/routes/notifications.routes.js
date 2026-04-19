'use strict';

const { Router }  = require('express');
const notifs      = require('../controllers/notifications.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = Router();

router.use(requireAuth);

// User-facing
router.get ('/notifications',              notifs.userList);
router.post('/notifications/:id/dismiss',  notifs.userDismiss);

module.exports = router;