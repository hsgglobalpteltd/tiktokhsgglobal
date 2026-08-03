import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

// Helper to check if running inside WSL (Windows Subsystem for Linux)
function getWSLDetails() {
  const isLinux = process.platform === "linux";
  if (!isLinux) return { isWSL: false };

  let isWSL = false;
  try {
    if (fs.existsSync("/proc/version")) {
      const version = fs.readFileSync("/proc/version", "utf8").toLowerCase();
      isWSL = version.includes("microsoft") || version.includes("wsl");
    }
  } catch (e) {
    console.error("Error reading /proc/version:", e);
  }

  return { isWSL };
}

// Find Windows User Home directory in WSL
function findWindowsUserPath() {
  const defaultUser = "PC-User";
  const defaultPath = `/mnt/c/Users/${defaultUser}`;
  if (fs.existsSync(defaultPath)) {
    return defaultPath;
  }

  try {
    const usersDir = "/mnt/c/Users";
    if (fs.existsSync(usersDir)) {
      const files = fs.readdirSync(usersDir);
      for (const file of files) {
        if (["default", "public", "all users", "defaultuser0", "desktop.ini"].includes(file.toLowerCase())) {
          continue;
        }
        const userPath = path.join(usersDir, file);
        if (fs.statSync(userPath).isDirectory()) {
          return userPath;
        }
      }
    }
  } catch (err) {
    console.error("Failed to scan Windows Users directory:", err);
  }

  return defaultPath;
}

// Translate WSL path to Windows path format (e.g. /mnt/c/path -> C:\path)
function wslToWindowsPath(wslPath: string): string {
  if (wslPath.startsWith("/mnt/c/")) {
    const withoutMnt = wslPath.substring(7); // "Users/PC-User/..."
    return "C:\\" + withoutMnt.replace(/\//g, "\\");
  }
  return wslPath;
}

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

    const { isWSL } = getWSLDetails();

    let tempDir = "";
    let tempFilePath = "";
    let winTempFilePath = "";

    if (isWSL) {
      // Running under WSL: Write PDF into the Windows Temp folder so the Windows SumatraPDF binary can access it
      const winHome = findWindowsUserPath();
      tempDir = path.join(winHome, "AppData/Local/Temp");
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      tempFilePath = path.join(tempDir, `print_${Date.now()}_${Math.random().toString(36).substring(7)}.pdf`);
      winTempFilePath = wslToWindowsPath(tempFilePath);
    } else {
      // Native Windows or Native Linux
      tempDir = os.tmpdir();
      tempFilePath = path.join(tempDir, `print_${Date.now()}_${Math.random().toString(36).substring(7)}.pdf`);
      winTempFilePath = tempFilePath;
    }

    // 2. Write buffer to temp file
    fs.writeFileSync(tempFilePath, pdfBuffer);

    // 3. Resolve command and print spools
    let printCmd = "";

    if (isWSL) {
      // Find Windows SumatraPDF path under WSL mount
      const winHome = findWindowsUserPath();
      const possibleSumatraPaths = [
        path.join(winHome, "AppData/Local/SumatraPDF/SumatraPDF.exe"),
        "/mnt/c/Program Files/SumatraPDF/SumatraPDF.exe",
        "/mnt/c/Program Files (x86)/SumatraPDF/SumatraPDF.exe"
      ];

      let wslSumatraPath = "";
      for (const p of possibleSumatraPaths) {
        if (fs.existsSync(p)) {
          wslSumatraPath = p;
          break;
        }
      }

      if (!wslSumatraPath) {
        // Default fallback if we cannot find it, execute by name (expects it in Windows path)
        wslSumatraPath = "SumatraPDF.exe";
      }

      printCmd = `"${wslSumatraPath}" -print-to-default -silent "${winTempFilePath}"`;
    } else if (process.platform === "win32") {
      // Native Windows
      const possibleSumatraPaths = [
        "SumatraPDF.exe",
        "SumatraPDF",
        'C:\\Program Files\\SumatraPDF\\SumatraPDF.exe',
        'C:\\Program Files (x86)\\SumatraPDF\\SumatraPDF.exe',
        path.join(os.homedir(), 'AppData\\Local\\SumatraPDF\\SumatraPDF.exe')
      ];

      let sumatraCommand = "";
      for (const p of possibleSumatraPaths) {
        if (p.includes('\\') && fs.existsSync(p)) {
          sumatraCommand = `"${p}"`;
          break;
        }
      }
      if (!sumatraCommand) {
        sumatraCommand = "SumatraPDF";
      }
      printCmd = `${sumatraCommand} -print-to-default -silent "${winTempFilePath}"`;
    } else {
      // Native Linux (Fallback to lpr/lp)
      printCmd = `lp "${tempFilePath}"`;
    }

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
          console.error(`Print execution error: ${error.message}`);
          resolve(
            NextResponse.json(
              { success: false, error: `Print failed: ${error.message}`, stderr },
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
