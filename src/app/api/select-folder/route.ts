import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";

export async function POST(req: NextRequest) {
  return new Promise<NextResponse>((resolve) => {
    // PowerShell script to show folder picker
    const psScript = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select AWB Download Folder'; $f.ShowNewFolderButton = $true; if($f.ShowDialog() -eq 'OK'){$f.SelectedPath}`;
    
    // Always execute powershell.exe on Windows
    const cmd = `powershell.exe -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`;

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
