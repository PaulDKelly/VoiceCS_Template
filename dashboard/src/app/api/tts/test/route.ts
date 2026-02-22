import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Provider = "elevenlabs" | "azure_neural";

const DEFAULT_TEST_TEXT =
    "Hello, this is a short voice test. How can I help you today?";

function xmlEscape(value: string) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function isValidAzureRegion(value: string) {
    const region = String(value || "").trim().toLowerCase();
    return /^[a-z0-9-]{2,32}$/.test(region);
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const provider = (body?.provider as Provider) || "elevenlabs";
        const text = (body?.text as string) || DEFAULT_TEST_TEXT;

        if (provider === "azure_neural") {
            const requestedRegion = String((body?.azureRegion as string) || "").trim();
            const envRegion = String(process.env.AZURE_SPEECH_REGION || "").trim();
            const speechRegion = requestedRegion || envRegion || "";
            let speechKey = process.env.AZURE_SPEECH_KEY;
            const hdRegion = process.env.AZURE_SPEECH_REGION_HD;
            const hdKey = process.env.AZURE_SPEECH_KEY_HD;
            if (hdRegion && hdKey && speechRegion && speechRegion.toLowerCase() === hdRegion.toLowerCase()) {
                speechKey = hdKey;
            }
            const voiceName =
                (body?.azureVoiceName as string) ||
                process.env.AZURE_SPEECH_VOICE ||
                "en-GB-LibbyNeural";
            const azureLang = ((body?.azureLang as string) || "en-GB").trim() || "en-GB";
            const azureStyle = ((body?.azureStyle as string) || "").trim();
            const azureStyleDegreeRaw = body?.azureStyleDegree as number | string | undefined;
            const azureStyleDegree =
                azureStyleDegreeRaw === undefined || azureStyleDegreeRaw === null || azureStyleDegreeRaw === ""
                    ? ""
                    : String(azureStyleDegreeRaw).trim();

            if (!speechKey || !speechRegion) {
                return NextResponse.json(
                    { error: "Azure Speech is not configured on the server." },
                    { status: 400 }
                );
            }
            if (!isValidAzureRegion(speechRegion)) {
                return NextResponse.json(
                    {
                        error:
                            `Invalid Azure Speech region '${speechRegion}'. ` +
                            "Use a region like 'uksouth' or 'westeurope' (not an email or URL).",
                    },
                    { status: 400 }
                );
            }

            const escapedText = xmlEscape(text);
            const escapedVoice = xmlEscape(voiceName);
            const escapedLang = xmlEscape(azureLang);
            const escapedStyle = xmlEscape(azureStyle);
            const escapedStyleDegree = xmlEscape(azureStyleDegree);

            const ssmlBody =
                azureStyle
                    ? `<mstts:express-as style="${escapedStyle}"${escapedStyleDegree ? ` styledegree="${escapedStyleDegree}"` : ""}><lang xml:lang="${escapedLang}">${escapedText}</lang></mstts:express-as>`
                    : `<lang xml:lang="${escapedLang}">${escapedText}</lang>`;

            const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="${escapedLang}"><voice name="${escapedVoice}">${ssmlBody}</voice></speak>`;

            const url = `https://${speechRegion}.tts.speech.microsoft.com/cognitiveservices/v1`;
            const azureRes = await fetch(url, {
                method: "POST",
                headers: {
                    "Ocp-Apim-Subscription-Key": speechKey,
                    "Content-Type": "application/ssml+xml",
                    "X-Microsoft-OutputFormat": "audio-16khz-32kbitrate-mono-mp3",
                    "User-Agent": "voicecs-dashboard",
                },
                body: ssml,
            });

            if (!azureRes.ok) {
                const errorText = await azureRes.text();
                console.error("[Azure TTS] Failed", {
                    status: azureRes.status,
                    statusText: azureRes.statusText,
                    error: errorText,
                    voiceName,
                    region: speechRegion,
                });
                return NextResponse.json(
                    { error: `Azure TTS failed (${azureRes.status}): ${errorText || azureRes.statusText}` },
                    { status: 502 }
                );
            }

            const audioBuffer = await azureRes.arrayBuffer();
            return new NextResponse(Buffer.from(audioBuffer), {
                status: 200,
                headers: {
                    "Content-Type": "audio/mpeg",
                    "Cache-Control": "no-store",
                },
            });
        }

        const elevenKey = process.env.ELEVENLABS_API_KEY;
        const voiceId = (body?.voiceId as string) || "";

        if (!elevenKey) {
            return NextResponse.json(
                { error: "ElevenLabs is not configured on the server." },
                { status: 400 }
            );
        }
        if (!voiceId) {
            return NextResponse.json(
                { error: "ElevenLabs voice id is required." },
                { status: 400 }
            );
        }

        const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;
        const elevenRes = await fetch(url, {
            method: "POST",
            headers: {
                "xi-api-key": elevenKey,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                text,
                model_id: "eleven_multilingual_v2",
            }),
        });

        if (!elevenRes.ok) {
            const errorText = await elevenRes.text();
            return NextResponse.json(
                { error: `ElevenLabs TTS failed: ${errorText}` },
                { status: 502 }
            );
        }

        const audioBuffer = await elevenRes.arrayBuffer();
        return new NextResponse(Buffer.from(audioBuffer), {
            status: 200,
            headers: {
                "Content-Type": "audio/mpeg",
                "Cache-Control": "no-store",
            },
        });
    } catch (err: any) {
        return NextResponse.json(
            { error: err?.message || "Unexpected error" },
            { status: 500 }
        );
    }
}
