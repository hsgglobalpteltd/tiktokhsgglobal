import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

// Helper to check if running inside Windows environment (native, git bash, cygwin, msys2)
function isWindows() {
  if (process.platform === "win32") return true;
  if (process.env.OS && /windows/i.test(process.env.OS)) return true;
  if (process.env.WINDIR || process.env.SystemRoot) return true;
  if (fs.existsSync("/c/Windows") || fs.existsSync("/mnt/c/Windows") || fs.existsSync("C:/Windows") || fs.existsSync("C:\\Windows")) return true;
  return false;
}

// Translate Windows path to POSIX path format for emulated shells on Windows (Cygwin, MSYS2, Git Bash)
function translateWindowsToPosixPath(winPath: string): string {
  const cleanPath = winPath.replace(/\\/g, "/");
  if (/^[a-zA-Z]:\//.test(cleanPath)) {
    const drive = cleanPath[0].toLowerCase();
    const rest = cleanPath.substring(3);
    
    // Check if it's Cygwin
    if (fs.existsSync("/cygdrive")) {
      return `/cygdrive/${drive}/${rest}`;
    }
    // Git Bash / MSYS2 / standard MINGW
    return `/${drive}/${rest}`;
  }
  return winPath;
}

// Helper to check if running inside WSL (Windows Subsystem for Linux)
function getWSLDetails() {
  if (process.platform !== "linux") return { isWSL: false };
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return { isWSL: true };
  if (fs.existsSync("/run/WSL")) return { isWSL: true };
  try {
    if (fs.existsSync("/proc/version")) {
      const version = fs.readFileSync("/proc/version", "utf8").toLowerCase();
      if (version.includes("microsoft") || version.includes("wsl")) {
        return { isWSL: true };
      }
    }
  } catch (e) {
    console.error("Error reading /proc/version:", e);
  }
  return { isWSL: false };
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

// Translate Windows path to WSL path format (e.g. C:\path -> /mnt/c/path)
function windowsToWslPath(winPath: string): string {
  const cleanPath = winPath.replace(/\\/g, "/");
  if (/^[a-zA-Z]:\//.test(cleanPath)) {
    const drive = cleanPath[0].toLowerCase();
    const rest = cleanPath.substring(3);
    return `/mnt/${drive}/${rest}`;
  }
  return winPath;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { pdfBase64, pdfUrl, downloadPath, enableDownload, saveFiles } = body;

    if (!downloadPath || downloadPath.trim() === "") {
      return NextResponse.json(
        { success: false, error: "Local AWB save directory path is not configured in Settings. Please set it and try again." },
        { status: 400 }
      );
    }

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

    let tempFilePath = "";
    let winTempFilePath = "";
    let shouldDeletePrintFile = false; // Always keep the printed logs now!

    // Normalize path slashes to forward slashes for cross-platform compatibility (works on both Windows & Unix runtimes)
    let localDownloadPath = downloadPath.replace(/\\/g, "/");
    if (isWSL) {
      localDownloadPath = windowsToWslPath(localDownloadPath);
    } else if (process.platform !== "win32" && isWindows()) {
      // POSIX emulation on Windows (Git Bash, Cygwin, MSYS2)
      localDownloadPath = translateWindowsToPosixPath(localDownloadPath);
    }

    // Determine Shop Folder Name
    let shopFolderName = "Mixed Shops";
    const firstShop = saveFiles[0]?.shopName;
    if (firstShop) {
      const allSame = saveFiles.every((f: any) => f.shopName === firstShop);
      if (allSame) {
        shopFolderName = firstShop;
      }
    }
    const cleanShopName = shopFolderName.replace(/[\\/:*?"<>|]/g, "_").trim();

    // Determine Month Folder Name
    let firstCreateTime = Date.now();
    if (saveFiles[0]?.createTime) {
      firstCreateTime = Number(saveFiles[0].createTime) > 1e11 ? Number(saveFiles[0].createTime) : Number(saveFiles[0].createTime) * 1000;
    }
    const firstDate = new Date(firstCreateTime);
    const yyyy = firstDate.getFullYear();
    const mm = String(firstDate.getMonth() + 1).padStart(2, '0');
    const monthFolder = `${yyyy}-${mm}`;

    // 1. Process Auto-Save AWB PDF files if configured (saving Single AWBs)
    if (enableDownload && saveFiles && saveFiles.length > 0) {
      for (const file of saveFiles) {
        try {
          let fileBuffer: Buffer;
          if (file.pdfBase64) {
            fileBuffer = Buffer.from(file.pdfBase64, "base64");
          } else if (file.pdfUrl) {
            const proxyUrl = `https://ib.hsgglobalpteltd.workers.dev/api/proxy?url=${encodeURIComponent(file.pdfUrl)}`;
            const fileRes = await fetch(proxyUrl);
            if (fileRes.ok) {
              const ab = await fileRes.arrayBuffer();
              fileBuffer = Buffer.from(ab);
            } else {
              const directRes = await fetch(file.pdfUrl);
              if (directRes.ok) {
                const ab = await directRes.arrayBuffer();
                fileBuffer = Buffer.from(ab);
              } else {
                console.error(`Failed to download PDF for saving: ${file.pdfUrl}`);
                continue;
              }
            }
          } else {
            continue;
          }

          // Individual files go to: [Download Path] / [Shop Name] / [YYYY-MM] / Single AWB / [Order ID].pdf
          const fileCleanShopName = file.shopName.replace(/[\\/:*?"<>|]/g, "_").trim();
          const fileCreateTime = Number(file.createTime) > 1e11 ? Number(file.createTime) : Number(file.createTime) * 1000;
          const fileDate = new Date(fileCreateTime);
          const fileYyyy = fileDate.getFullYear();
          const fileMm = String(fileDate.getMonth() + 1).padStart(2, '0');
          const fileMonthFolder = `${fileYyyy}-${fileMm}`;

          let targetDir = path.join(localDownloadPath, fileCleanShopName, fileMonthFolder, "Single AWB");
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }

          const targetFilePath = path.join(targetDir, `${file.orderId}.pdf`);
          fs.writeFileSync(targetFilePath, fileBuffer);
          console.log(`Successfully saved AWB to: ${targetFilePath}`);
        } catch (saveErr) {
          console.error(`Failed to save AWB file for order ${file.orderId}:`, saveErr);
        }
      }
    }

    // 2. Save the print job AWB file in the Print Log AWB directory!
    try {
      const now = new Date();
      const YYYY = now.getFullYear();
      const MM = String(now.getMonth() + 1).padStart(2, '0');
      const DD = String(now.getDate()).padStart(2, '0');
      const hh = String(now.getHours()).padStart(2, '0');
      const min = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');
      
      const totalCount = saveFiles && saveFiles.length > 0 ? saveFiles.length : 1;
      const filename = `${YYYY}-${MM}-${DD}_${hh}-${min}-${ss}_TotalAWB_${totalCount}.pdf`;
      
      let targetDir = path.join(localDownloadPath, cleanShopName, monthFolder, "Print Log AWB");
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const targetFilePath = path.join(targetDir, filename);
      fs.writeFileSync(targetFilePath, pdfBuffer);
      console.log(`Successfully saved AWB to print log: ${targetFilePath}`);
      
      tempFilePath = targetFilePath;
      if (isWSL) {
        winTempFilePath = wslToWindowsPath(tempFilePath);
      } else {
        winTempFilePath = tempFilePath;
      }
    } catch (printLogErr) {
      console.error("Failed to save AWB print log:", printLogErr);
      // Fallback inside downloadPath directory if save fails
      let targetDir = localDownloadPath;
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      tempFilePath = path.join(targetDir, `print_${Date.now()}.pdf`);
      fs.writeFileSync(tempFilePath, pdfBuffer);
      if (isWSL) {
        winTempFilePath = wslToWindowsPath(tempFilePath);
      } else {
        winTempFilePath = tempFilePath;
      }
      shouldDeletePrintFile = true;
    }

    // 3. Resolve command and print spools
    let printCmd = "";

    if (isWSL) {
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
        wslSumatraPath = "SumatraPDF.exe";
      }

      printCmd = `"${wslSumatraPath}" -print-to-default -silent "${winTempFilePath}"`;
    } else if (isWindows()) {
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
      printCmd = `lp "${tempFilePath}"`;
    }

    console.log(`Executing print command: ${printCmd}`);

    return new Promise<NextResponse>((resolve) => {
      exec(printCmd, (error, stdout, stderr) => {
        // Clean up temp file
        try {
          if (shouldDeletePrintFile && fs.existsSync(tempFilePath)) {
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
