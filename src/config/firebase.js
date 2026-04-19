const admin = require('firebase-admin');

// Initialize Firebase Admin SDK once
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // \n in env files must be converted back to actual newlines
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const db = admin.firestore();
const auth = admin.auth();

// ─── Firestore collection references ─────────────────────────────────────────
const collections = {
  users:         db.collection('users'),         // user profiles
  usernames:     db.collection('usernames'),     // username → uid index (fast lookup)
  pendingRegs:   db.collection('pendingRegs'),   // temp OTP storage during registration
  links:         db.collection('links'),         // biolink links per user
  sessions:      db.collection('sessions'),      // refresh token store (optional)
  tickets:       db.collection('tickets'),       // support tickets
  notifications: db.collection('notifications'), // global broadcast notifications
};

module.exports = { admin, db, auth, collections };