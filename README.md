# wlc.lol — Backend API

Node.js + Express backend for the wlc.lol biolink platform.  
Uses **Firebase Firestore** as the database and **Nodemailer** for email OTP.

---

## Project Structure

```
wlc-backend/
├── src/
│   ├── index.js                        ← Express app + server start
│   ├── config/
│   │   └── firebase.js                 ← Firebase Admin SDK init
│   ├── middleware/
│   │   ├── auth.middleware.js           ← JWT verification
│   │   └── rateLimiter.middleware.js    ← Rate limiting configs
│   ├── routes/
│   │   ├── auth.routes.js              ← Register / Login / Logout / Me
│   │   ├── profile.routes.js           ← Public profile + update
│   │   └── links.routes.js             ← CRUD for biolinks
│   └── services/
│       └── email.service.js            ← OTP email sending
├── public/                             ← Put your HTML files here
│   ├── index.html
│   ├── login.html
│   ├── register.html
│   └── dashboard.html
├── firestore.rules                     ← Deploy to Firebase
├── firestore.indexes.json              ← Deploy to Firebase
├── .env.example                        ← Copy to .env and fill in
└── package.json
```

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Set up Firebase

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create a new project (or use existing)
3. Enable **Firestore Database** (start in production mode)
4. Go to **Project Settings → Service Accounts → Generate new private key**
5. Open the downloaded JSON and copy the values to your `.env`:

```
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

### 3. Configure email (Gmail)

1. Enable 2FA on your Google account
2. Go to [App Passwords](https://myaccount.google.com/apppasswords)
3. Generate a password for "Mail"
4. Add to `.env`:
```
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=xxxx xxxx xxxx xxxx   ← the 16-char app password
```

### 4. Copy your HTML files

```bash
mkdir -p public
cp /path/to/your/index.html public/
cp /path/to/your/login.html public/
cp /path/to/your/register.html public/
cp /path/to/your/dashboard.html public/
```

### 5. Copy and fill your .env

```bash
cp .env.example .env
# then edit .env with your values
```

### 6. Deploy Firestore rules and indexes

```bash
# Install Firebase CLI if needed
npm install -g firebase-tools
firebase login
firebase init firestore   # select your project
firebase deploy --only firestore
```

### 7. Start the server

```bash
# Development (auto-restart)
npm run dev

# Production
npm start
```

---

## API Endpoints

### Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register/check-username` | Check username availability |
| POST | `/api/auth/register/send-code` | Send OTP to email |
| POST | `/api/auth/register/resend-code` | Resend OTP |
| POST | `/api/auth/verify-code` | Verify OTP code |
| POST | `/api/auth/register/complete` | Create account |
| POST | `/api/auth/login` | Sign in |
| POST | `/api/auth/logout` | Sign out (clears cookie) |
| GET  | `/api/auth/me` | Get current user 🔒 |

### Profile

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/profile/:username` | Get public profile + links |
| PUT | `/api/profile` | Update own profile 🔒 |

### Links

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/api/links` | Get all your links 🔒 |
| POST   | `/api/links` | Add a link 🔒 |
| PUT    | `/api/links/:id` | Edit a link 🔒 |
| DELETE | `/api/links/:id` | Delete a link 🔒 |
| POST   | `/api/links/reorder` | Reorder links 🔒 |
| POST   | `/api/links/:id/click` | Track a click (public) |

🔒 = requires JWT (via `Authorization: Bearer <token>` header or `token` cookie)

---

## Firestore Data Structure

```
users/
  {uid}/
    uid, username, usernameLower, email,
    passwordHash, displayName, bio, avatarUrl,
    theme, isVerified, isPro, linkCount,
    createdAt, updatedAt, lastLoginAt

usernames/
  {usernameLower}/           ← index for fast username lookup
    uid, username, claimedAt

pendingRegs/
  {email}/                   ← temporary, deleted after registration
    username, email, otpHash,
    expiresAt, verified, attempts, createdAt

links/
  {linkId}/
    uid, title, url, icon,
    position, isActive, clickCount,
    createdAt, updatedAt
```

---

## Security features

- Passwords hashed with **bcrypt** (cost factor 12)
- OTPs hashed with **bcrypt** before storage
- JWT stored in **httpOnly cookie** (XSS-safe)
- **Rate limiting** on all sensitive endpoints
- **Generic error messages** on login (prevents email enumeration)
- **Max 5 OTP attempts** before invalidation
- **10-minute OTP expiry**
- **Atomic username claiming** via Firestore batch write
- Reserved username blocklist
- Input validation with **express-validator**
- Security headers via **helmet**

---

## Deployment (Railway / Render)

1. Push to GitHub
2. Connect repo to [Railway](https://railway.app) or [Render](https://render.com)
3. Add all your `.env` variables in the platform's dashboard
4. Set start command: `npm start`
5. Set `NODE_ENV=production` and `FRONTEND_URL=https://yourdomain.com`
