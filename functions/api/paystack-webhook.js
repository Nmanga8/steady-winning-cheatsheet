// Cloudflare Pages Function — receives Paystack's webhook, verifies it is
// really from Paystack, records the order, and emails the buyer their
// download links.
//
// This runs on Cloudflare's servers, not the buyer's browser — so unlike
// the on-page "payment successful" screen, it cannot be faked from dev
// tools. Treat this as your real, trustworthy record of what was actually
// paid for.
//
// Required setup (see the README for click-by-click steps):
//   - Environment variable/secret: PAYSTACK_SECRET_KEY  (starts with sk_live_ or sk_test_)
//   - Environment variable/secret: RESEND_API_KEY        (from resend.com)
//   - Environment variable: SEND_FROM_EMAIL              (e.g. orders@yourdomain.com)
//   - KV namespace binding: ORDERS                        (Workers & Pages → KV)
//   - In Paystack: Settings → API Keys & Webhooks → Webhook URL →
//       https://YOURSITE.pages.dev/api/paystack-webhook

const SITE_URL = "https://puntercheatsheet.nmangaawor.workers.dev"; // <-- replace after your first deploy

const PRODUCT_FILES = [
  { label: "Steady Winning Cheat Sheet (PDF)", path: "/files/Steady-Winning-Cheat-Sheet.pdf" },
  { label: "Editable Bet Tracker (Excel/Sheets)", path: "/files/Steady-Winning-Bet-Tracker.xlsx" },
  { label: "Printable Pre-Bet Checklist (PDF)", path: "/files/Steady-Winning-Pre-Bet-Checklist.pdf" },
  { label: "Checklist Phone Wallpaper (PNG)", path: "/files/Steady-Winning-Checklist-Wallpaper.png" },
];

export async function onRequestPost(context) {
  const { request, env } = context;

  // Paystack signs the raw request body — must read as text BEFORE parsing.
  const rawBody = await request.text();
  const signature = request.headers.get("x-paystack-signature") || "";

  const expected = await hmacSha512Hex(env.PAYSTACK_SECRET_KEY, rawBody);
  if (!timingSafeEqual(expected, signature)) {
    return new Response("Invalid signature", { status: 401 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  if (event.event === "charge.success" && event.data?.status === "success") {
    const { reference, customer, amount } = event.data;
    const email = customer?.email;

    // Record the order (so you have a real log, and so you can avoid
    // emailing the same buyer twice if Paystack retries the webhook).
    const already = await env.ORDERS.get(reference);
    if (!already) {
      await env.ORDERS.put(
        reference,
        JSON.stringify({
          email,
          amount_kobo: amount,
          paid_at: new Date().toISOString(),
        })
      );

      if (email) {
        await sendDeliveryEmail(env, email, reference);
      }
    }
  }

  // Always return 200 quickly so Paystack marks the webhook as delivered.
  return new Response("OK", { status: 200 });
}

async function sendDeliveryEmail(env, toEmail, reference) {
  const linksHtml = PRODUCT_FILES.map(
    (f) => `<li><a href="${SITE_URL}${f.path}">${f.label}</a></li>`
  ).join("");

  const html = `
    <div style="font-family:Arial,sans-serif; color:#16211C;">
      <h2>Your Steady Winning files are ready</h2>
      <p>Thanks for your order (reference ${reference}). Here are your downloads:</p>
      <ul>${linksHtml}</ul>
      <p style="color:#5b6a62; font-size:13px; margin-top:24px;">
        This guide is a decision-support tool, not a guarantee of winnings.
        Please bet only what you can afford to lose.
      </p>
    </div>
  `;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.SEND_FROM_EMAIL,
      to: toEmail,
      subject: "Your Steady Winning download links",
      html,
    }),
  });
}

async function hmacSha512Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
