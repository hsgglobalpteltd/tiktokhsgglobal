import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { pdfBase64, pdfUrl, downloadPath, enableDownload, saveFiles } = body;

    const hasDownloadPath = downloadPath && downloadPath.trim() !== "";

    // 1. Process Auto-Save AWB PDF files if configured (saving Single AWBs)
    if (hasDownloadPath && enableDownload && saveFiles && saveFiles.length > 0) {
      const localDownloadPath = downloadPath.trim();
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

          // Individual files go directly to: [Download Path] / [Shop Name] / [MMYYYY] / [Order ID].pdf
          const fileCleanShopName = file.shopName.replace(/[\\/:*?"<>|]/g, "_").trim();
          const fileCreateTime = Number(file.createTime) > 1e11 ? Number(file.createTime) : Number(file.createTime) * 1000;
          const fileDate = new Date(fileCreateTime);
          const fileMm = String(fileDate.getMonth() + 1).padStart(2, '0');
          const fileYyyy = fileDate.getFullYear();
          const fileMonthFolder = `${fileMm}${fileYyyy}`; // MMYYYY format

          const targetDir = path.join(localDownloadPath, fileCleanShopName, fileMonthFolder);
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

    // 2. Save the print job AWB file in the 0000 AWB Print Log directory under download path!
    if (hasDownloadPath) {
      const localDownloadPath = downloadPath.trim();
      const printJobDir = path.join(localDownloadPath, "0000 AWB Print Log");
      if (!fs.existsSync(printJobDir)) {
        fs.mkdirSync(printJobDir, { recursive: true });
      }

      let pdfBuffer: Buffer | null = null;
      if (pdfBase64) {
        pdfBuffer = Buffer.from(pdfBase64, "base64");
      } else if (pdfUrl) {
        const res = await fetch(pdfUrl);
        if (res.ok) {
          const arrayBuffer = await res.arrayBuffer();
          pdfBuffer = Buffer.from(arrayBuffer);
        }
      }

      if (pdfBuffer) {
        const now = new Date();
        const DD = String(now.getDate()).padStart(2, '0');
        const MM = String(now.getMonth() + 1).padStart(2, '0');
        const YYYY = now.getFullYear();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        
        const dateStr = `${DD}${MM}${YYYY}`;
        const timeStr = `${hh}${mm}`;
        
        const totalCount = saveFiles && saveFiles.length > 0 ? saveFiles.length : 1;
        const filename = `${dateStr}_${timeStr}_${totalCount}.pdf`;

        const targetFilePath = path.join(printJobDir, filename);
        fs.writeFileSync(targetFilePath, pdfBuffer);
        console.log(`Successfully saved AWB to print location: ${targetFilePath}`);
      } else {
        console.warn("Could not retrieve print PDF bytes (missing pdfBase64 and pdfUrl)");
      }
    }

    return NextResponse.json({ success: true });

  } catch (err: any) {
    console.error("Print API error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
