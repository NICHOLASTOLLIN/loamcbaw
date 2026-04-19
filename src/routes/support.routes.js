'use strict';

const { Router } = require('express');
const support    = require('../controllers/support.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = Router();

router.use(requireAuth);

// Ticket list + create
router.get('/tickets',               support.listTickets);
router.post('/tickets',                    support.createTicket);

// Reply to a ticket
router.post('/tickets/:id/message',        support.addMessage);

module.exports = router;