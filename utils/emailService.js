const { Resend } = require('resend');

let resend;

function getClient() {
  if (!resend) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is not set — cannot send email.');
    }
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

async function sendEmail({ to, subject, html, text }) {
  const client = getClient();
  const { data, error } = await client.emails.send({
    from: process.env.EMAIL_FROM || 'WorkforceSaaS <onboarding@resend.dev>',
    to,
    subject,
    html,
    text,
  });
  if (error) {
    throw new Error(error.message || 'Failed to send email via Resend.');
  }
  return data;
}

module.exports = { sendEmail };
