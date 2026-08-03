import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { pdfBase64, pdfUrl } = body;

    let pdfBuffer: Buffer;

    if (pdfBase64) {
      pdfBuffer = Buffer.from(pdfBase64, "base64");
    } else if (pdfUrl) {
      const res = await fetch(pdfUrl);
      if (!res.ok) {
        return NextResponse.json(
          { success: false, error: `Failed to fetch PDF: ${res.statusText}` },
          { status: 400 }
        );
      }
      const arrayBuffer = await res.arrayBuffer();
      pdfBuffer = Buffer.from(arrayBuffer);
    } else {
      return NextResponse.json(
        { success: false, error: "Missing pdfBase64 or pdfUrl parameter" },
        { status: 400 }
      );
    }

    // 1. Create a unique temp file path
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, `print_${Date.now()}_${Math.random().toString(36).substring(7)}.pdf`);

    // 2. Write buffer to temp file
    fs.writeFileSync(tempFilePath, pdfBuffer);

    // 3. Spool to SumatraPDF
    // Check standard paths on Windows
    const possibleSumatraPaths = [
      "SumatraPDF.exe",
      "SumatraPDF",
      'C:\\Program Files\\SumatraPDF\\SumatraPDF.exe',
      'C:\\Program Files (x86)\\SumatraPDF\\SumatraPDF.exe',
      path.join(os.homedir(), 'AppData\\Local\\SumatraPDF\\SumatraPDF.exe')
    ];

    let sumatraCommand = "";
    for (const p of possibleSumatraPaths) {
      if (p.includes('\\')) {
        if (fs.existsSync(p)) {
          sumatraCommand = `"${p}"`;
          break;
        }
      }
    }
    // If no absolute path exists, fallback to default command (expects it in PATH)
    if (!sumatraCommand) {
      sumatraCommand = "SumatraPDF";
    }

    // Build print command: -print-to-default -silent
    const printCmd = `${sumatraCommand} -print-to-default -silent "${tempFilePath}"`;

    console.log(`Executing print command: ${printCmd}`);

    return new Promise<NextResponse>((resolve) => {
      exec(printCmd, (error, stdout, stderr) => {
        // Clean up temp file
        try {
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
          }
        } catch (cleanupErr) {
          console.error("Failed to clean up temp file:", cleanupErr);
        }

        if (error) {
          console.error(`SumatraPDF execution error: ${error.message}`);
          resolve(
            NextResponse.json(
              { success: false, error: `SumatraPDF failed: ${error.message}`, stderr },
              { status: 500 }
            )
          );
        } else {
          console.log("PDF sent to printer successfully");
          resolve(NextResponse.json({ success: true }));
        }
      });
    });

  } catch (err: any) {
    console.error("Print API Error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}
