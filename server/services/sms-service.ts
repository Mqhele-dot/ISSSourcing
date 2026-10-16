/**
 * Optional SMS for notification mirror. Configure Twilio or log-only (SMS_LOG=true).
 */
export async function maybeSendSms(to: string | undefined, body: string): Promise<void> {
  if (!to || !to.trim()) return;
  if (process.env.DISABLE_NOTIFICATION_SMS === "true") return;

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!sid || !token || !from) {
    if (process.env.SMS_LOG === "true" || process.env.NODE_ENV === "development") {
      console.info("[sms] (no Twilio creds) would send to", to, "—", body.slice(0, 120));
    }
    return;
  }

  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const params = new URLSearchParams({ To: to.trim(), From: from, Body: body.slice(0, 1600) });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  if (!res.ok) {
    const t = await res.text();
    console.warn("[sms] Twilio error", res.status, t.slice(0, 200));
  }
}
