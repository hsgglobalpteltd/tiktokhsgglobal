import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import fs from "fs";

// Helper to locate powershell.exe across different shell environments
function getPowerShellPath(): string {
  if (process.platform === "win32") {
    return "powershell.exe";
  }

  // Check standard POSIX mount points on Windows
  const possiblePaths = [
    "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
    "/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
    "/cygdrive/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
    "/mnt/c/Windows/System32/powershell.exe",
    "/c/Windows/System32/powershell.exe",
    "/cygdrive/c/Windows/System32/powershell.exe"
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return "powershell.exe";
}

export async function POST(req: NextRequest) {
  return new Promise<NextResponse>((resolve) => {
    // PowerShell script to show folder picker
    const psScript = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select AWB Download Folder'; $f.ShowNewFolderButton = $true; if($f.ShowDialog() -eq 'OK'){$f.SelectedPath}`;
    
    const powershellPath = getPowerShellPath();
    const cmd = `"${powershellPath}" -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`;

    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        console.error("Folder picker error:", error.message);
        resolve(NextResponse.json({ success: false, error: error.message }));
        return;
      }
      
      const selectedPath = stdout.trim();
      if (!selectedPath) {
        resolve(NextResponse.json({ success: true, path: null }));
      } else {
        resolve(NextResponse.json({ success: true, path: selectedPath }));
      }
    });
  });
}
