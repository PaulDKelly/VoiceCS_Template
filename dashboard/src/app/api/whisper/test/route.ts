import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const to = (body?.to as string) || "";
        const from = (body?.from as string) || "";
        const message = (body?.message as string) || "This is a whisper test call.";

        if (!to || !from) {
            return NextResponse.json(
                { error: "Both 'to' and 'from' numbers are required." },
                { status: 400 }
            );
        }

        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;

        if (!accountSid || !authToken) {
            return NextResponse.json(
                { error: "Twilio is not configured on the server." },
                { status: 400 }
            );
        }

        const twiml = `<Response><Say voice="Polly.Amy">${message}</Say></Response>`;

        const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`;
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Authorization": "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
            },
            body: new URLSearchParams({
                To: to,
                From: from,
                Twiml: twiml,
            }),
        });

        if (!res.ok) {
            const errorText = await res.text();
            return NextResponse.json(
                { error: `Twilio call failed: ${errorText}` },
                { status: 502 }
            );
        }

        const data = await res.json();
        return NextResponse.json({ status: "ok", sid: data?.sid || null });
    } catch (err: any) {
        return NextResponse.json(
            { error: err?.message || "Unexpected error" },
            { status: 500 }
        );
    }
}
