import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import fs from "fs";

// Helper to check if running inside Windows environment (native, git bash, cygwin, msys2)
function isWindows() {
  return process.platform === "win32" || (process.env.OS && process.env.OS.includes("Windows"));
}

// Helper to check if running inside WSL
function isWSL() {
  if (process.platform !== "linux") return false;
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  if (fs.existsSync("/run/WSL")) return true;
  try {
    if (fs.existsSync("/proc/version")) {
      const version = fs.readFileSync("/proc/version", "utf8").toLowerCase();
      return version.includes("microsoft") || version.includes("wsl");
    }
  } catch (e) {}
  return false;
}

export async function POST(req: NextRequest) {
  return new Promise<NextResponse>((resolve) => {
    let cmd = "";
    
    // PowerShell script to show folder picker
    const psScript = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select AWB Download Folder'; $f.ShowNewFolderButton = $true; if($f.ShowDialog() -eq 'OK'){$f.SelectedPath}`;

    if (isWSL()) {
      // Under WSL, execute powershell.exe on the Windows side
      cmd = `powershell.exe -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`;
    } else if (isWindows()) {
      // Windows environment (handles native cmd, powershell, git bash, msys2, cygwin)
      cmd = `powershell.exe -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`;
    } else {
      // Mac or standard Linux: folder picker dialog fallback (we can just return error or try to run zenity/osascript)
      cmd = `osascript -e 'POSIX path of (choose folder with prompt "Select AWB Download Folder")'`;
    }

    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        console.error("Folder picker error:", error.message);
        resolve(NextResponse.json({ success: false, error: error.message }));
        return;
      }
      
      const selectedPath = stdout.trim();
      if (!selectedPath) {
        // User cancelled the dialog
        resolve(NextResponse.json({ success: true, path: null }));
      } else {
        resolve(NextResponse.json({ success: true, path: selectedPath }));
      }
    });
  });
}
