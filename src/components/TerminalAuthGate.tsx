"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { PDFDocument } from "pdf-lib";

const WORKER_URL = "https://ib.hsgglobalpteltd.workers.dev";

const triggerBlobDownload = (blob: Blob, filename: string) => {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
};

interface PrintLog {
  timestamp: string;
  type: "info" | "success" | "error";
  message: string;
}

export function TerminalAuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const [status, setStatus] = React.useState<"loading" | "unregistered" | "prompt_pin" | "authenticated">("loading");
  const [clientIp, setClientIp] = React.useState("");
  const [terminalName, setTerminalName] = React.useState("");
  const [allowedPages, setAllowedPages] = React.useState<string[]>([]);
  const [terminalPin, setTerminalPin] = React.useState("");
  const [autoPrintEnabled, setAutoPrintEnabled] = React.useState(false);
  
  const [enteredPin, setEnteredPin] = React.useState("");
  const [pinError, setPinError] = React.useState(false);

  // Console Log States
  const [autoPrintPaused, setAutoPrintPaused] = React.useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("auto_print_paused") === "true";
    }
    return false;
  });

  const [isConsoleOpen, setIsConsoleOpen] = React.useState(false);
  const [printLogs, setPrintLogs] = React.useState<PrintLog[]>([]);
  const processedOrderIds = React.useRef<Set<string>>(new Set());
  const printingInProgress = React.useRef(false);
  const printTimerRef = React.useRef<any>(null);

  const [nextCheckTime, setNextCheckTime] = React.useState<number | null>(null);
  const [countdownText, setCountdownText] = React.useState<string>("");

  React.useEffect(() => {
    if (!nextCheckTime) {
      setCountdownText("");
      return;
    }

    const updateCountdown = () => {
      const diffMs = nextCheckTime - Date.now();
      if (diffMs <= 0) {
        setCountdownText("0S");
        return;
      }

      const totalSec = Math.floor(diffMs / 1000);
      const hours = Math.floor(totalSec / 3600);
      const minutes = Math.floor((totalSec % 3600) / 60);
      const seconds = totalSec % 60;

      let text = "";
      if (hours > 0) {
        text += `${hours}H`;
      }
      if (minutes > 0 || hours > 0) {
        text += `${minutes}M`;
      }
      text += `${seconds}S`;

      setCountdownText(text);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [nextCheckTime]);

  // Dragging States
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = React.useState(false);
  const dragStart = React.useRef({ x: 0, y: 0 });
  const dragOffset = React.useRef({ x: 0, y: 0 });
  const hasMovedRef = React.useRef(false);
  
  // Inactivity Timer
  const [isLowOpacity, setIsLowOpacity] = React.useState(true);
  const inactivityTimerRef = React.useRef<any>(null);

  const startInactivityTimer = React.useCallback(() => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }
    inactivityTimerRef.current = setTimeout(() => {
      setIsConsoleOpen(false);
      setIsLowOpacity(true);
    }, 30000); // 30 seconds
  }, []);

  const clearInactivityTimer = React.useCallback(() => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
  }, []);

  const handleMouseEnter = React.useCallback(() => {
    clearInactivityTimer();
    setIsLowOpacity(false);
  }, [clearInactivityTimer]);

  const handleMouseLeave = React.useCallback(() => {
    startInactivityTimer();
  }, [startInactivityTimer]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only drag on left click
    setIsDragging(true);
    hasMovedRef.current = false;
    dragStart.current = { x: e.clientX, y: e.clientY };
    dragOffset.current = { ...position };
    e.preventDefault();
  };

  React.useEffect(() => {
    if (isConsoleOpen) {
      startInactivityTimer();
    }
    return () => clearInactivityTimer();
  }, [isConsoleOpen, startInactivityTimer, clearInactivityTimer]);

  React.useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        hasMovedRef.current = true;
      }
      setPosition({
        x: dragOffset.current.x + dx,
        y: dragOffset.current.y + dy
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  const addLog = React.useCallback((type: "info" | "success" | "error", message: string, noTimestamp = false) => {
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-GB");
    const timeStr = now.toLocaleTimeString("en-GB", { hour12: false });
    const fullTimeStr = noTimestamp ? "" : `${dateStr} ${timeStr.substring(0, 5)}`;
    setPrintLogs(prev => [
      { timestamp: fullTimeStr, type, message },
      ...prev.slice(0, 99) // Keep last 100 logs
    ]);
  }, []);

  const verifyIP = React.useCallback(async () => {
    try {
      const localIp = localStorage.getItem("local_terminal_ip") || "";
      const res = await fetch(`${WORKER_URL}/api/tiktok/terminals/verify-ip?client_local_ip=${encodeURIComponent(localIp)}&_t=${Date.now()}`);
      if (!res.ok) throw new Error("Verification request failed");
      
      const data = await res.json();
      setClientIp(data.ip || "");
      
      if (data.registered) {
        setTerminalName(data.name || "");
        setAllowedPages(data.allowedPages || []);
        setTerminalPin(data.pin || "");
        setAutoPrintEnabled(!!data.autoPrint);

        sessionStorage.setItem("terminal_name", data.name || "");
        sessionStorage.setItem("terminal_allowed_pages", JSON.stringify(data.allowedPages || []));
        sessionStorage.setItem("terminal_ip", data.ip || "");
        sessionStorage.setItem("terminal_auto_print", String(!!data.autoPrint));

        const isAuth = sessionStorage.getItem("terminal_auth") === "true";
        if (isAuth) {
          setStatus("authenticated");
        } else {
          setStatus("prompt_pin");
        }
      } else {
        setStatus("unregistered");
      }
    } catch (err) {
      console.error("IP verification failed:", err);
      // Fallback to unregistered or retry
      setStatus("unregistered");
    }
  }, []);

  // 1. Fetch IP check on startup
  React.useEffect(() => {
    verifyIP();
  }, [verifyIP]);

  // 2. Allowed Route Redirection (Route Guard)
  React.useEffect(() => {
    if (status !== "authenticated") return;

    const pageRouteMap: Record<string, string> = {
      "Dashboard": "/dashboard",
      "Orders": "/orders",
      "Scan Parcel": "/scan-parcel",
      "Scan Handover": "/scan-handover",
      "Setting": "/setting"
    };

    const currentModule = Object.keys(pageRouteMap).find(
      key => pageRouteMap[key] === pathname
    );

    // If accessing an unauthorized page path, redirect to homepage menu route "/"
    if (currentModule && !allowedPages.includes(currentModule)) {
      router.push("/");
    }
  }, [pathname, status, allowedPages, router]);

  // Helper function to print a PDF url in a hidden iframe (Chrome kiosk-printing friendly)
  const printPdf = React.useCallback((pdfUrl: string, orderId: string, shopId: string) => {
    return new Promise<void>(async (resolve, reject) => {
      try {
        // Fetch PDF bytes via backend proxy to avoid CORS blocks
        const proxyUrl = `${WORKER_URL}/api/proxy?url=${encodeURIComponent(pdfUrl)}`;
        const res = await fetch(proxyUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status} trying to download PDF`);
        const blob = await res.blob();

        const blobToBase64 = (b: Blob): Promise<string> => {
          return new Promise((resVal, rejVal) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64data = reader.result as string;
              resVal(base64data.split(',')[1]);
            };
            reader.onerror = rejVal;
            reader.readAsDataURL(b);
          });
        };
        const base64 = await blobToBase64(blob);

        // Trigger browser downloads directly for print (scaled) and upload single to R2
        const now = new Date();
        const DD = String(now.getDate()).padStart(2, '0');
        const MM = String(now.getMonth() + 1).padStart(2, '0');
        const YYYY = now.getFullYear();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        
        const filename = `AutoPrintAWB_${DD}${MM}${YYYY}_${hh}${mm}_1.pdf`;
        
        // Download combined AWB PDF to browser (triggers PowerShell watcher)
        triggerBlobDownload(blob, filename);

        // Upload individual original single AWB PDF (No Scale) directly to R2 bucket
        try {
          const currentYearMonth = `${MM}${YYYY}`;
          const r2Filename = `Tiktok AWB/Unknown Shop/${currentYearMonth}/${orderId}.pdf`;
          const uploadUrl = `${WORKER_URL}/api/upload?filename=${encodeURIComponent(r2Filename)}`;

          fetch(uploadUrl, {
            method: "POST",
            headers: { "Content-Type": "application/pdf" },
            body: blob
          }).then(uploadRes => {
            if (uploadRes.ok) {
              console.log(`Successfully uploaded single AWB to R2: ${r2Filename}`);
            } else {
              console.error(`Failed to upload single AWB to R2: ${r2Filename}. Status: ${uploadRes.status}`);
            }
          }).catch(uploadErr => {
            console.error(`Failed to upload single AWB to R2: ${r2Filename}`, uploadErr);
          });
        } catch (err) {
          console.error(`Failed to upload single AWB for order ${orderId} to R2:`, err);
        }

        try {
          // Log print status to backend
          const logRes = await fetch(`${WORKER_URL}/api/tiktok/orders/print-awb?order_id=${encodeURIComponent(orderId)}&shop_id=${encodeURIComponent(shopId)}&action_by=${encodeURIComponent(terminalName)}`);
          if (!logRes.ok) {
            console.warn("Failed to log print-awb in backend status tracker");
          }
        } catch (logErr) {
          console.error("Failed to log print-awb:", logErr);
        }
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }, [terminalName]);

  // Helper function to print a merged PDF Blob URL in a hidden iframe
  const printMergedPdfs = React.useCallback((blobUrl: string, orders: any[]) => {
    return new Promise<void>(async (resolve, reject) => {
      try {
        const resBlob = await fetch(blobUrl);
        if (!resBlob.ok) throw new Error("Failed to fetch merged blob from URL");
        const blob = await resBlob.blob();

        const blobToBase64 = (b: Blob): Promise<string> => {
          return new Promise((resVal, rejVal) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64data = reader.result as string;
              resVal(base64data.split(',')[1]);
            };
            reader.onerror = rejVal;
            reader.readAsDataURL(b);
          });
        };
        const base64 = await blobToBase64(blob);

        const saveFilesInfo = orders.map(order => ({
          pdfUrl: order.doc_url,
          shopName: order.shop_name || "Unknown Shop",
          orderId: order.id,
          createTime: order.create_time
        }));

        // Trigger browser downloads directly for bulk print (scaled) and upload individual to R2
        const now = new Date();
        const DD = String(now.getDate()).padStart(2, '0');
        const MM = String(now.getMonth() + 1).padStart(2, '0');
        const YYYY = now.getFullYear();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        
        const filename = `AutoPrintAWB_${DD}${MM}${YYYY}_${hh}${mm}_${saveFilesInfo.length}.pdf`;
        
        // Download combined AWB PDF to browser (triggers PowerShell watcher)
        triggerBlobDownload(blob, filename);

        // Upload individual original single AWB PDFs (No Scale) directly to R2 bucket
        for (const file of saveFilesInfo) {
          try {
            if (!file.pdfUrl) continue;
            
            const proxyUrl = `${WORKER_URL}/api/proxy?url=${encodeURIComponent(file.pdfUrl)}`;
            const fileRes = await fetch(proxyUrl);
            if (!fileRes.ok) throw new Error(`HTTP ${fileRes.status}`);
            const fileData = await fileRes.arrayBuffer();

            const cleanShopName = file.shopName.replace(/[\\/:*?"<>|]/g, "_").trim();
            const createTime = Number(file.createTime) > 1e11 ? Number(file.createTime) : Number(file.createTime) * 1000;
            const dateObj = new Date(createTime);
            const shopMM = String(dateObj.getMonth() + 1).padStart(2, '0');
            const shopYYYY = dateObj.getFullYear();
            const monthStr = `${shopMM}${shopYYYY}`;

            const r2Filename = `Tiktok AWB/${cleanShopName}/${monthStr}/${file.orderId}.pdf`;
            const uploadUrl = `${WORKER_URL}/api/upload?filename=${encodeURIComponent(r2Filename)}`;

            fetch(uploadUrl, {
              method: "POST",
              headers: { "Content-Type": "application/pdf" },
              body: fileData
            }).then(uploadRes => {
              if (uploadRes.ok) {
                console.log(`Successfully uploaded single AWB to R2: ${r2Filename}`);
              } else {
                console.error(`Failed to upload single AWB to R2: ${r2Filename}. Status: ${uploadRes.status}`);
              }
            }).catch(uploadErr => {
              console.error(`Failed to upload single AWB to R2: ${r2Filename}`, uploadErr);
            });
          } catch (err) {
            console.error(`Failed to upload single AWB for order ${file.orderId} to R2:`, err);
          }
        }

        // Log print status to backend for all orders in batch
        for (const order of orders) {
          try {
            const logRes = await fetch(`${WORKER_URL}/api/tiktok/orders/print-awb?order_id=${encodeURIComponent(order.id)}&shop_id=${encodeURIComponent(order.shop_id)}&action_by=${encodeURIComponent(terminalName)}`);
            if (!logRes.ok) {
              console.warn(`Failed to log print-awb in backend for order ${order.id}`);
            }
          } catch (logErr) {
            console.error(`Error logging print-awb for order ${order.id}:`, logErr);
          }
        }
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }, [terminalName]);

  // 3. Auto Print Loop Engine
  const printWorker = React.useCallback(async (isManual = false) => {
    if (printingInProgress.current) return;
    if (autoPrintPaused) {
      return;
    }
    printingInProgress.current = true;

    try {
      // ----------------------------------------------------
      // PHASE 1: TikTok Auto-Sync (Using Manual Sync Endpoint & Param)
      // ----------------------------------------------------
      addLog("info", "Initial Auto Sync");

      // 1. Fetch current cached orders from Supabase (without sync)
      let prevOrders: any[] = [];
      try {
        const cacheRes = await fetch(`${WORKER_URL}/api/tiktok/orders?sync=false&_t=${Date.now()}`);
        if (cacheRes.ok) {
          const cacheData = await cacheRes.json();
          if (cacheData.success) {
            prevOrders = cacheData.orders || [];
          }
        }
      } catch (err) {
        console.error("Cache fetch failed:", err);
      }

      // 2. Perform live sync from TikTok (for the last 15 days, exact same call as manual refresh)
      const fifteenDaysAgo = Date.now() - 15 * 24 * 3600 * 1000;
      const resSync = await fetch(`${WORKER_URL}/api/tiktok/orders?sync=true&sync_start_date=${fifteenDaysAgo}&_t=${Date.now()}`, {
        cache: "no-store"
      });
      if (!resSync.ok) {
        throw new Error(`Sync fetch failed: ${resSync.statusText}`);
      }
      const dataSync = await resSync.json();
      if (!dataSync.success) {
        throw new Error(dataSync.error || "Failed to sync orders from TikTok");
      }

      let currentOrdersList = dataSync.orders || [];

      // 3. Compute and log changes
      const prevMap = new Map(prevOrders.map((o: any) => [o.id, o]));
      let hasChanges = false;
      for (const newOrd of currentOrdersList) {
        const prevOrd = prevMap.get(newOrd.id);
        if (!prevOrd) {
          addLog("success", `ID : ${newOrd.id} New Order`, true);
          hasChanges = true;
        } else {
          const prevStatus = prevOrd.actual_status || "";
          const newStatus = newOrd.actual_status || "";
          const prevSysStatus = prevOrd.system_status || "";
          const newSysStatus = newOrd.system_status || "";
          if (prevStatus !== newStatus || prevSysStatus !== newSysStatus) {
            addLog("success", `ID : ${newOrd.id} Status Update`, true);
            hasChanges = true;
          }
        }
      }

      if (!hasChanges) {
        addLog("info", "no new data", true);
      }

      addLog("success", "Auto Sync Complete Success");

      // ----------------------------------------------------
      // PHASE 2: Auto-Generate AWB
      // ----------------------------------------------------
      addLog("info", "Initial Auto Generate AWB");

      // Filter for orders that are "Unpacked" and not printed, and actual status is printable
      const getUnprintedOrdersList = (orders: any[]) => {
        return orders.filter((order: any) => {
          const isUnpacked = (order.system_status || "").toLowerCase() === "unpacked";
          const isNotPrinted = !order.awb_printed;
          
          const statusLower = (order.actual_status || "").toLowerCase();
          const cannotPrint = ["pick_up", "in_transit", "shipped", "delivered", "cancelled", "completed"].includes(statusLower);

          return isUnpacked && isNotPrinted && !cannotPrint;
        });
      };

      let unprintedOrders = getUnprintedOrdersList(currentOrdersList);
      const ordersMissingAwb = unprintedOrders.filter((order: any) => !order.tracking_number || order.tracking_number === "N/A");

      if (ordersMissingAwb.length > 0) {
        let generatedAny = false;

        for (const order of ordersMissingAwb) {
          try {
            const awbRes = await fetch(`${WORKER_URL}/api/tiktok/orders/create-awb`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ order_id: order.id, shop_id: order.shop_id, action_by: terminalName })
            });
            if (awbRes.ok) {
              const awbData = await awbRes.json();
              if (awbData.success) {
                addLog("success", `ID : ${order.id} AWB Generated`, true);
                generatedAny = true;
              } else {
                addLog("error", `ID : ${order.id} AWB Generation Failed: ${awbData.error || "Unknown error"}`, true);
              }
            } else {
              addLog("error", `ID : ${order.id} AWB Generation Failed: HTTP ${awbRes.statusText}`, true);
            }
          } catch (err: any) {
            addLog("error", `ID : ${order.id} AWB Generation Failed: ${err.message || err}`, true);
          }
        }

        // Perform a quick sync to pull the newly registered tracking numbers
        if (generatedAny) {
          try {
            const quickSyncRes = await fetch(`${WORKER_URL}/api/tiktok/orders?sync=true&sync_start_date=${fifteenDaysAgo}&_t=${Date.now()}`, {
              cache: "no-store"
            });
            if (quickSyncRes.ok) {
              const quickSyncData = await quickSyncRes.json();
              if (quickSyncData.success) {
                currentOrdersList = quickSyncData.orders || [];
                unprintedOrders = getUnprintedOrdersList(currentOrdersList);
              }
            }
          } catch (syncErr) {
            console.error("Quick sync failed after AWB generation:", syncErr);
          }
        }
      } else {
        addLog("info", "no new order to generate", true);
      }

      addLog("success", "Auto Generate AWB Complete Success");

      // ----------------------------------------------------
      // PHASE 3: AWB Download & Print
      // ----------------------------------------------------
      addLog("info", "Initial Auto Print AWB");

      // Only print orders that now have tracking numbers
      const ordersToPrint = unprintedOrders.filter((order: any) => order.tracking_number && order.tracking_number !== "N/A");

      if (ordersToPrint.length > 0) {
        const printedOrderIds: any[] = [];
        const pdfUrls = [];

        for (const order of ordersToPrint) {
          try {
            const printRes = await fetch(`${WORKER_URL}/api/tiktok/orders/print-awb?order_id=${encodeURIComponent(order.id)}&shop_id=${encodeURIComponent(order.shop_id)}&action_by=${encodeURIComponent(terminalName)}&skip_log=true`);
            if (printRes.ok) {
              const printData = await printRes.json();
              if (printData.success && printData.doc_url) {
                pdfUrls.push(printData.doc_url);
                order.doc_url = printData.doc_url;
                printedOrderIds.push(order);
                addLog("success", `ID : ${order.id} AWB Printed`, true);
              } else {
                addLog("error", `ID : ${order.id} Print Document Retrieval Failed: ${printData.error || "No URL returned"}`, true);
              }
            } else {
              addLog("error", `ID : ${order.id} Print Document Retrieval Failed: HTTP ${printRes.statusText}`, true);
            }
          } catch (orderErr: any) {
            const errStr = String(orderErr.message || orderErr);
            addLog("error", `ID : ${order.id} Print Document Retrieval Failed: ${errStr}`, true);

            // If the order has already been picked up (TikTok API error), mark as printed in DB to remove from queue
            if (errStr.toLowerCase().includes("pickup") || errStr.toLowerCase().includes("picked up")) {
              try {
                await fetch(`${WORKER_URL}/api/tiktok/orders/print-awb?order_id=${encodeURIComponent(order.id)}&shop_id=${encodeURIComponent(order.shop_id)}&action_by=${encodeURIComponent(terminalName)}`);
              } catch (logErr) {
                console.error(`Failed to mark picked-up order ${order.id} as printed:`, logErr);
              }
            }
          }
        }

        if (pdfUrls.length > 0) {
          // Download and merge PDFs
          const mergedPdf = await PDFDocument.create();
          const scalePercentVal = Number(localStorage.getItem("awb_print_scale") || "100");
          const printScale = scalePercentVal / 100;

          for (const url of pdfUrls) {
            const proxyUrl = `${WORKER_URL}/api/proxy?url=${encodeURIComponent(url)}`;
            const pdfRes = await fetch(proxyUrl);
            if (!pdfRes.ok) throw new Error(`HTTP ${pdfRes.status} trying to download PDF`);
            const pdfBytes = await pdfRes.arrayBuffer();
            const pdf = await PDFDocument.load(pdfBytes);
            const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
            copiedPages.forEach((page) => {
              const { width, height } = page.getSize();
              const targetWidth = 283.46; // A6 width in points
              const targetHeight = 425.20; // A6 height in points

              const scaleX = targetWidth / width;
              const scaleY = targetHeight / height;
              const baseScale = Math.min(scaleX, scaleY);
              const scale = baseScale * printScale;

              page.scaleContent(scale, scale);

              const dx = 0;
              const dy = targetHeight - (height * scale);
              page.translateContent(dx, dy);

              page.setSize(targetWidth, targetHeight);
              mergedPdf.addPage(page);
            });
          }

          const mergedPdfBytes = await mergedPdf.save();
          const blob = new Blob([mergedPdfBytes as any], { type: "application/pdf" });
          const mergedBlobUrl = URL.createObjectURL(blob);

          await printMergedPdfs(mergedBlobUrl, printedOrderIds);
          URL.revokeObjectURL(mergedBlobUrl);
        }
      } else {
        addLog("info", "no new order to print", true);
      }

      addLog("success", "Auto Print AWB Complete Success");

      // Dispatch global refresh event to refresh screen tables
      window.dispatchEvent(new CustomEvent("db-refresh"));

    } catch (err: any) {
      addLog("error", `Auto Sync/Print pipeline failed: ${err.message || err}`);
    } finally {
      printingInProgress.current = false;
    }
  }, [status, autoPrintEnabled, terminalName, addLog, printPdf, printMergedPdfs, autoPrintPaused]);

  React.useEffect(() => {
    if (status !== "authenticated" || !autoPrintEnabled) return;

    addLog("info", `Auto Print Engine initialized for terminal [${terminalName}]`);

    async function scheduleNextPrint() {
      try {
        const settingsRes = await fetch(`${WORKER_URL}/api/tiktok/settings?_t=${Date.now()}`);
        if (!settingsRes.ok) throw new Error("Failed to fetch settings");
        const settings = await settingsRes.json() as any;

        const interval = settings.sync_interval || "1H";
        const workingDays = (settings.sync_working_days || "Mon,Tue,Wed,Thu,Fri").split(",");
        const timeFrom = settings.sync_time_from || "09:00";
        const timeTo = settings.sync_time_to || "18:00";

        const [fromH, fromM] = timeFrom.split(":").map(Number);
        const [toH, toM] = timeTo.split(":").map(Number);
        const fromMin = fromH * 60 + (fromM || 0);
        const toMin = toH * 60 + (toM || 0);

        if (interval === "5M") {
          const now = new Date();
          const sgDate = new Date(now.getTime() + (8 * 60 * 60 * 1000));
          const sgDayStr = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][sgDate.getUTCDay()];
          const sgHour = sgDate.getUTCHours();
          
          let isInWindow = true;
          const currentMin = sgHour * 60 + sgDate.getUTCMinutes();
          
          if (!workingDays.includes(sgDayStr) || currentMin < fromMin || currentMin > toMin) {
            isInWindow = false;
          }
          
          const delay = 5 * 60 * 1000;
          if (printTimerRef.current) clearTimeout(printTimerRef.current);
          
          if (!isInWindow) {
            setNextCheckTime(Date.now() + delay);
            printTimerRef.current = setTimeout(async () => {
              scheduleNextPrint();
            }, delay);
            return;
          }
          
          setNextCheckTime(Date.now() + delay);
          printTimerRef.current = setTimeout(async () => {
            await printWorker();
            scheduleNextPrint();
          }, delay);
          return;
        }

        if (interval === "30M") {
          const now = new Date();
          const sgDate = new Date(now.getTime() + (8 * 60 * 60 * 1000));
          const sgDayStr = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][sgDate.getUTCDay()];
          const sgHour = sgDate.getUTCHours();
          
          let isInWindow = true;
          const currentMin = sgHour * 60 + sgDate.getUTCMinutes();
          
          if (!workingDays.includes(sgDayStr) || currentMin < fromMin || currentMin > toMin) {
            isInWindow = false;
          }
          
          const min = now.getMinutes();
          let targetMin = 5;
          let hourOffset = 0;
          if (min < 5) {
            targetMin = 5;
          } else if (min < 35) {
            targetMin = 35;
          } else {
            targetMin = 5;
            hourOffset = 1;
          }
          
          const targetTime = new Date();
          targetTime.setHours(targetTime.getHours() + hourOffset);
          targetTime.setMinutes(targetMin, 0, 0);
          
          if (!isInWindow) {
            const delay = 30 * 60 * 1000;
            setNextCheckTime(Date.now() + delay);
            if (printTimerRef.current) clearTimeout(printTimerRef.current);
            printTimerRef.current = setTimeout(async () => {
              scheduleNextPrint();
            }, delay);
            return;
          }
          
          const delay = targetTime.getTime() - Date.now();
          setNextCheckTime(Date.now() + delay);
          if (printTimerRef.current) clearTimeout(printTimerRef.current);
          printTimerRef.current = setTimeout(async () => {
            await printWorker();
            scheduleNextPrint();
          }, delay);
          return;
        }

        let found = false;
        let testTime = new Date();

        for (let i = 0; i < 48; i++) {
          const nowMs = testTime.getTime();
          const sgDate = new Date(nowMs + (8 * 60 * 60 * 1000));
          const sgHour = sgDate.getUTCHours();
          const sgDayStr = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][sgDate.getUTCDay()];

          if (workingDays.includes(sgDayStr)) {
            let isHourMatch = false;
            if (interval === "1H") {
              isHourMatch = true;
            } else if (interval === "3H" && sgHour % 3 === 0) {
              isHourMatch = true;
            } else if (interval === "6H" && sgHour % 6 === 0) {
              isHourMatch = true;
            } else if (interval === "12H" && sgHour % 12 === 0) {
              isHourMatch = true;
            }

            if (isHourMatch) {
              let isInWindow = true;
              if (interval === "1H" || interval === "3H") {
                const currentMin = sgHour * 60 + 5; // print check runs 5 minutes past the hour
                if (currentMin < fromMin || currentMin > toMin) {
                  isInWindow = false;
                }
              }

              if (isInWindow) {
                const targetUtcMs = Date.UTC(
                  sgDate.getUTCFullYear(),
                  sgDate.getUTCMonth(),
                  sgDate.getUTCDate(),
                  sgHour - 8,
                  5, // minute 5
                  0,
                  0
                );
                const targetLocalTime = new Date(targetUtcMs);

                if (targetLocalTime.getTime() > Date.now() + 1000) {
                  const delay = targetLocalTime.getTime() - Date.now();
                  setNextCheckTime(Date.now() + delay);

                  if (printTimerRef.current) clearTimeout(printTimerRef.current);
                  printTimerRef.current = setTimeout(async () => {
                    await printWorker();
                    scheduleNextPrint();
                  }, delay);

                  found = true;
                  break;
                }
              }
            }
          }
          testTime.setHours(testTime.getHours() + 1);
          testTime.setMinutes(5);
        }

        if (!found) {
          const delay = 15 * 60 * 1000;
          setNextCheckTime(Date.now() + delay);
          if (printTimerRef.current) clearTimeout(printTimerRef.current);
          printTimerRef.current = setTimeout(async () => {
            await printWorker();
            scheduleNextPrint();
          }, delay);
        }
      } catch (err: any) {
        addLog("error", `Failed to schedule next print check: ${err.message}. Retrying in 5 minutes.`);
        setNextCheckTime(Date.now() + 5 * 60 * 1000);
        if (printTimerRef.current) clearTimeout(printTimerRef.current);
        printTimerRef.current = setTimeout(scheduleNextPrint, 5 * 60 * 1000);
      }
    }

    // Run print worker once immediately on startup/authorization
    printWorker();
    scheduleNextPrint();

    // Event listener for manual synchronizations
    const handleManualSync = async () => {
      addLog("info", "Manual sync detected. Starting print check immediately...");
      setNextCheckTime(null);
      if (printTimerRef.current) clearTimeout(printTimerRef.current);
      await printWorker(true);
      scheduleNextPrint();
    };
    window.addEventListener("tiktok-manual-sync", handleManualSync);

    return () => {
      if (printTimerRef.current) clearTimeout(printTimerRef.current);
      window.removeEventListener("tiktok-manual-sync", handleManualSync);
    };
  }, [status, autoPrintEnabled, terminalName, addLog, printPdf, printMergedPdfs, autoPrintPaused, printWorker]);


  const handleKeypadPress = (val: string) => {
    if (enteredPin.length >= 4) return;
    const newPin = enteredPin + val;
    setEnteredPin(newPin);

    if (newPin.length === 4) {
      if (newPin === terminalPin) {
        sessionStorage.setItem("terminal_auth", "true");
        sessionStorage.setItem("terminal_name", terminalName);
        sessionStorage.setItem("terminal_allowed_pages", JSON.stringify(allowedPages));
        sessionStorage.setItem("terminal_auto_print", String(autoPrintEnabled));
        setStatus("authenticated");
      } else {
        setPinError(true);
        setTimeout(() => {
          setEnteredPin("");
          setPinError(false);
        }, 500);
      }
    }
  };

  const handleBackspace = () => {
    setEnteredPin(prev => prev.slice(0, -1));
  };

  const handleClear = () => {
    setEnteredPin("");
  };

  // Rendering loading state
  if (status === "loading") {
    return (
      <div className="fixed inset-0 bg-[#F8F9FA] flex flex-col items-center justify-center font-primary select-none">
        <div className="w-10 h-10 border-4 border-zinc-200 border-t-[#0B57D0] rounded-full animate-spin mb-4" />
        <span className="text-xs font-bold text-zinc-500">Verifying Terminal IP Address...</span>
      </div>
    );
  }

  // Rendering unregistered blocked page
  if (status === "unregistered") {
    return (
      <div className="fixed inset-0 bg-red-50 flex flex-col items-center justify-center p-6 text-center font-primary select-none">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center text-red-600 mb-6 animate-pulse">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-red-950 mb-2">Unauthorized Terminal Access</h2>
        <p className="text-sm text-red-700 max-w-md leading-relaxed mb-6">
          Your client IP address <strong className="font-mono bg-red-100 px-1.5 py-0.5 rounded border border-red-200">{clientIp}</strong> is not registered. Please contact your system administrator to authorize this terminal.
        </p>
        
        {/* Local IP Override Configurator */}
        <div className="bg-white rounded-xl border border-red-200 p-6 w-full max-w-xs shadow-md flex flex-col gap-3.5">
          <label className="text-[11px] font-bold text-zinc-500 uppercase text-left block">
            Local IPv4 Override
          </label>
          <input 
            type="text" 
            id="local-ip-input"
            defaultValue={localStorage.getItem("local_terminal_ip") || ""}
            placeholder="e.g. 192.168.1.105"
            className="px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:border-[#0b57d0]"
            style={{ textAlign: "center" }}
          />
          <button
            onClick={() => {
              const input = document.getElementById("local-ip-input") as HTMLInputElement;
              if (input) {
                localStorage.setItem("local_terminal_ip", input.value.trim());
                setStatus("loading");
                verifyIP();
              }
            }}
            className="w-full px-4 py-2 bg-[#0b57d0] hover:bg-[#0842a0] text-white text-xs font-bold rounded-lg transition duration-150 shadow-sm cursor-pointer"
          >
            Save Local IP & Retry
          </button>
        </div>
      </div>
    );
  }

  // Rendering PIN passcode input gate
  if (status === "prompt_pin") {
    return (
      <div className="fixed inset-0 bg-[#F8F9FA] flex items-center justify-center p-4 font-primary select-none">
        <div className="w-full max-w-sm flex flex-col items-center">
          <div className="text-center mb-8">
            <h2 className="text-lg font-bold text-[#1f1f1f] mb-1">Terminal Gate Access</h2>
            <p className="text-xs text-zinc-500 font-semibold">
              Enter 4-digit PIN for terminal <strong>{terminalName}</strong>
            </p>
            <span className="inline-block mt-2 font-mono text-[10px] bg-zinc-200/50 text-zinc-500 px-2 py-0.5 rounded border border-zinc-200">
              IP: {clientIp}
            </span>
          </div>

          {/* PIN Indicators */}
          <div className={`flex gap-4 mb-10 transition duration-150 ${pinError ? "animate-bounce" : ""}`}>
            {[0, 1, 2, 3].map(idx => (
              <div 
                key={idx} 
                className={`w-3.5 h-3.5 rounded-full border-2 transition duration-150 ${
                  pinError 
                    ? "bg-red-500 border-red-500" 
                    : idx < enteredPin.length 
                      ? "bg-[#0b57d0] border-[#0b57d0]" 
                      : "border-zinc-400"
                }`}
              />
            ))}
          </div>

          {/* Numeric Keypad Grid */}
          <div className="grid grid-cols-3 gap-3.5 w-full max-w-[270px]">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(num => (
              <button 
                key={num}
                onClick={() => handleKeypadPress(num)}
                className="w-16 h-16 rounded-full bg-white border border-zinc-200 text-lg font-bold text-zinc-800 flex items-center justify-center hover:bg-zinc-50 active:bg-zinc-100 transition shadow-sm outline-none cursor-pointer"
              >
                {num}
              </button>
            ))}
            <button 
              onClick={handleClear}
              className="w-16 h-16 rounded-full text-xs font-bold text-zinc-500 hover:text-zinc-800 transition outline-none cursor-pointer"
            >
              Clear
            </button>
            <button 
              onClick={() => handleKeypadPress("0")}
              className="w-16 h-16 rounded-full bg-white border border-zinc-200 text-lg font-bold text-zinc-800 flex items-center justify-center hover:bg-zinc-50 active:bg-zinc-100 transition shadow-sm outline-none cursor-pointer"
            >
              0
            </button>
            <button 
              onClick={handleBackspace}
              className="w-16 h-16 rounded-full flex items-center justify-center text-zinc-500 hover:text-zinc-800 transition outline-none cursor-pointer"
              title="Delete"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414-6.414A2 2 0 0010.828 5H21a2 2 0 012 2v10a2 2 0 01-2 2H10.828a2 2 0 01-1.414-.586L3 12z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Render children (Authenticated app) with the Print Console Drawer
  return (
    <>
      {children}      {/* Floating Kiosk Console Drawer */}
      {status === "authenticated" && autoPrintEnabled && (
        <div 
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          style={{
            transform: `translate(${position.x}px, ${position.y}px)`,
            zIndex: 10000
          }}
          className={`fixed bottom-4 right-4 font-primary select-none flex flex-col items-end transition-opacity duration-300 ${
            isLowOpacity ? "opacity-30" : "opacity-100"
          }`}
        >
          {/* Main expanded console body */}
          {isConsoleOpen && (
            <div className="w-80 h-72 bg-[#1f1f1f] rounded-xl border border-zinc-700 shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-150 mb-2">
              <header className="px-4 py-2 bg-zinc-800 border-b border-zinc-700 flex justify-between items-center text-xs font-bold text-zinc-300">
                <div className="flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-full animate-pulse ${autoPrintPaused ? "bg-red-500" : "bg-green-500"}`} />
                  <span>{terminalName} System Log</span>
                </div>
                <div className="flex items-center gap-2">
                  {autoPrintEnabled && (
                    <button
                      onClick={() => {
                        const newPaused = !autoPrintPaused;
                        setAutoPrintPaused(newPaused);
                        localStorage.setItem("auto_print_paused", String(newPaused));
                        addLog("info", newPaused ? "Auto Print paused." : "Auto Print resumed.");
                      }}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold transition outline-none ${
                        autoPrintPaused 
                          ? "bg-green-600 hover:bg-green-700 text-white" 
                          : "bg-red-600 hover:bg-red-700 text-white"
                      }`}
                    >
                      {autoPrintPaused ? "Resume" : "Pause"}
                    </button>
                  )}
                  <button 
                    onClick={() => setIsConsoleOpen(false)}
                    className="text-zinc-400 hover:text-white transition text-xs font-bold px-1"
                  >
                    ✕
                  </button>
                </div>
              </header>
              
              {/* Scrollable logs viewport */}
              <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1.5 font-mono text-[10px] text-zinc-400">
                {printLogs.length === 0 ? (
                  <span className="italic text-zinc-600 text-center mt-20">No events logged yet.</span>
                ) : (
                  printLogs.map((log, idx) => {
                    let typeColor = "text-zinc-400";
                    if (log.type === "success") typeColor = "text-green-400 font-bold";
                    if (log.type === "error") typeColor = "text-red-400 font-bold";
                    
                    return (
                      <div key={idx} className="flex gap-1.5 leading-relaxed break-words">
                        {log.timestamp && (
                          <span className="text-zinc-600 font-semibold">{log.timestamp}</span>
                        )}
                        <span className={typeColor}>{log.message}</span>
                      </div>
                    );
                  })
                )}
              </div>
 
              <footer className="px-3 py-1.5 bg-zinc-800/80 border-t border-zinc-700 flex justify-between items-center text-[9px] text-zinc-500 font-semibold">
                <span>{countdownText ? `Next Sync: ${countdownText}` : "Polling synced database: 30s"}</span>
                <div className="flex gap-3">
                  {autoPrintEnabled && (
                    <button 
                      onClick={() => {
                        addLog("info", "Manually triggering Auto Print check...");
                        printWorker(true);
                      }}
                      className="text-blue-400 hover:text-blue-300 transition uppercase font-bold"
                    >
                      Auto Print
                    </button>
                  )}
                  <button 
                    onClick={() => setPrintLogs([])}
                    className="hover:text-zinc-300 transition"
                  >
                    Clear Console
                  </button>
                </div>
              </footer>
            </div>
          )}
 
          {/* Trigger button/badge */}
          <button
            onMouseDown={handleMouseDown}
            onClick={(e) => {
              if (hasMovedRef.current) {
                e.preventDefault();
                return;
              }
              setIsConsoleOpen(prev => !prev);
            }}
            className={`flex items-center gap-2 px-3 py-2 bg-[#1f1f1f] text-white border border-zinc-700 rounded-full shadow-lg hover:bg-zinc-800 transition outline-none select-none ${
              isDragging ? "cursor-grabbing" : "cursor-grab"
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs font-bold">{terminalName} System Log</span>
            <svg 
              className={`w-3.5 h-3.5 text-zinc-400 transition-transform duration-150 ${isConsoleOpen ? "rotate-180" : ""}`}
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24" 
              xmlns="http://www.w3.org/2000/svg"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
            </svg>
          </button>
        </div>
      )}
    </>
  );
}
