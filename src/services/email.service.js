const formData = require('form-data');
const Mailgun = require('mailgun.js');

let _mg = null;
function getMG() {
  if (!_mg) {
    const mailgun = new Mailgun(formData);
    _mg = mailgun.client({
      username: 'api',
      key: process.env.MAILGUN_API_KEY,
      // EU region? uncomment:
      // url: 'https://api.eu.mailgun.net',
    });
  }
  return _mg;
}

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendVerificationEmail(email, username, otp) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8"/>
      <style>
        body{background:#09080a;font-family:Arial,sans-serif;margin:0;padding:0}
        .wrapper{max-width:520px;margin:40px auto;background:#111013;border:1px solid rgba(255,255,255,0.1);border-radius:20px;overflow:hidden}
        .header{padding:36px 40px 24px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06)}
        .logo{font-size:22px;font-weight:900;color:#f5f0ee;letter-spacing:-0.01em}
        .logo span{color:#ff6a1a}
        .body{padding:36px 40px}
        h2{color:#f5f0ee;font-size:20px;margin:0 0 12px}
        p{color:#8a7e7a;font-size:14px;line-height:1.6;margin:0 0 24px}
        .otp-box{background:#09080a;border:1px solid rgba(255,255,255,0.1);border-radius:14px;padding:24px;text-align:center;margin:24px 0}
        .otp{font-size:40px;font-weight:900;color:#ff6a1a;letter-spacing:12px}
        .expire{color:#52463f;font-size:12px;margin-top:10px}
        .footer{padding:20px 40px;border-top:1px solid rgba(255,255,255,0.06);text-align:center}
        .footer p{color:#52463f;font-size:12px;margin:0}
      </style>
    </head>
    <body>
      <div class="wrapper">
        <div class="header"><div class="logo">wlc<span>.</span>lol</div></div>
        <div class="body">
          <h2>Verify your email</h2>
          <p>Hey <strong style="color:#f5f0ee">@${username}</strong>, welcome to wlc.lol! Use the code below to verify your email and claim your profile.</p>
          <div class="otp-box">
            <div class="otp">${otp}</div>
            <div class="expire">Expires in 10 minutes</div>
          </div>
          <p>If you didn't create an account, ignore this email.</p>
        </div>
        <div class="footer"><p>&copy; 2026 wlc.lol &middot; Built for creators</p></div>
      </div>
    </body>
    </html>
  `;

  await getMG().messages.create(process.env.MAILGUN_DOMAIN, {
    from: process.env.EMAIL_FROM || `wlc.lol <noreply@${process.env.MAILGUN_DOMAIN}>`,
    to: [email],
    subject: `${otp} is your wlc.lol verification code`,
    html,
  });
}

module.exports = { generateOTP, sendVerificationEmail };
