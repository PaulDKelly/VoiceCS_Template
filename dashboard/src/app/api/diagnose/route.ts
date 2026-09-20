import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const configPath = process.env.APP_CONFIG_PATH;
    const diagnostics: any = {
        env_APP_CONFIG_PATH: configPath,
        cwd: process.cwd(),
        ls_config: [],
        write_test: null,
        error: null
    };

    try {
        // 1. List files
        if (configPath && fs.existsSync(configPath)) {
            diagnostics.ls_config = fs.readdirSync(configPath);
        } else {
            diagnostics.ls_config = "Directory not found";
        }

        // 2. Try Write
        if (configPath) {
            const testFile = path.join(configPath, 'write_test.txt');
            try {
                fs.writeFileSync(testFile, `Write test at ${new Date().toISOString()}`);
                diagnostics.write_test = "Success";
                // Clean up
                fs.unlinkSync(testFile);
            } catch (writeErr) {
                diagnostics.write_test = `Failed: ${String(writeErr)}`;
            }
        }
    } catch (e) {
        diagnostics.error = String(e);
    }

    return NextResponse.json(diagnostics);
}
