import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { getUserPermissions, hasClientAccess } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizePhone(value: string) {
  return String(value || "").trim();
}

function trimSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function isLikelyHttpUrl(value: string) {
  return /^https?:\/\/[^ ]+$/i.test(value);
}

export async function POST(req: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const permissions = getUserPermissions(user);
    if (!permissions.can_edit_clients) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const to = normalizePhone(String(body?.to || ""));
    const from = normalizePhone(String(body?.from || ""));
    const industry = String(body?.industry || "").trim();
    const client = String(body?.client || "").trim();
    const selectedWorkflow = String(body?.workflow || "").trim();
    const webhookBaseUrl = trimSlash(String(body?.webhookBaseUrl || process.env.VOICE_WEBHOOK_BASE_URL || "").trim());

    if (!to || !from) {
      return NextResponse.json({ error: "Both 'to' and 'from' are required." }, { status: 400 });
    }
    if (!industry || !client) {
      return NextResponse.json({ error: "Industry and client are required." }, { status: 400 });
    }
    if (!hasClientAccess(user, industry, client)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!webhookBaseUrl || !isLikelyHttpUrl(webhookBaseUrl)) {
      return NextResponse.json(
        { error: "A valid voice webhook base URL is required (e.g. https://app-voice-agent.example.com)." },
        { status: 400 }
      );
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) {
      return NextResponse.json({ error: "Twilio is not configured on the server." }, { status: 400 });
    }

    const incomingCallUrl = new URL(`${webhookBaseUrl}/api/incoming-call`);
    incomingCallUrl.searchParams.set("client_id", client);
    incomingCallUrl.searchParams.set("industry", industry);
    incomingCallUrl.searchParams.set("test_mode", "1");
    if (selectedWorkflow) incomingCallUrl.searchParams.set("test_workflow", selectedWorkflow);

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`;
    const twilioRes = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
      },
      body: new URLSearchParams({
        To: to,
        From: from,
        Url: incomingCallUrl.toString(),
      }),
    });

    if (!twilioRes.ok) {
      const errorText = await twilioRes.text();
      return NextResponse.json({ error: `Twilio call failed: ${errorText}` }, { status: 502 });
    }

    const data = await twilioRes.json();
    return NextResponse.json({
      status: "ok",
      sid: data?.sid || null,
      to,
      from,
      industry,
      client,
      workflow: selectedWorkflow || null,
      webhookUrl: incomingCallUrl.toString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
