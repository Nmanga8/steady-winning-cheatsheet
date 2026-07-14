// This is the main entry point Cloudflare needs to know how to serve your
// site (static files) AND run your Paystack webhook function.
//
// You shouldn't need to edit this file — it just connects the two pieces
// that already exist in your repo: the static site (index.html, assets/,
// files/) and functions/api/paystack-webhook.js.

import { onRequestPost as paystackWebhook } from "./functions/api/paystack-webhook.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/paystack-webhook" && request.method === "POST") {
      return paystackWebhook({ request, env, ctx });
    }

    // Everything else (index.html, images, PDFs, the xlsx tracker, etc.)
    // is served directly from your static files.
    return env.ASSETS.fetch(request);
  },
};
