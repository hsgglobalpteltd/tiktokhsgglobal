"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";

const WORKER_URL = "https://ib.hsgglobalpteltd.workers.dev";

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

  const addLog = React.useCallback((type: "info" | "success" | "error", message: string) => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString("en-GB", { hour12: false });
    setPrintLogs(prev => [
      { timestamp: timeStr, type, message },
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
      "Scan Pack": "/scan-pack",
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
    return new Promise<void>((resolve, reject) => {
      try {
        const iframe = document.createElement("iframe");
        iframe.style.position = "fixed";
        iframe.style.width = "0";
        iframe.style.height = "0";
        iframe.style.border = "none";
        iframe.src = pdfUrl;
        document.body.appendChild(iframe);

        let timeout = setTimeout(() => {
          document.body.removeChild(iframe);
          reject(new Error("Print spool timed out"));
        }, 15000);

        iframe.onload = () => {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();

          // Wait 4 seconds to allow print spooling buffer
          setTimeout(async () => {
            clearTimeout(timeout);
            try {
              // Log print status to backend
              const logRes = await fetch(`${WORKER_URL}/api/tiktok/orders/print-awb?order_id=${encodeURIComponent(orderId)}&shop_id=${encodeURIComponent(shopId)}&action_by=${encodeURIComponent(terminalName)}`);
              if (!logRes.ok) {
                console.warn("Failed to log print-awb in backend status tracker");
              }
              document.body.removeChild(iframe);
              resolve();
            } catch (logErr) {
              document.body.removeChild(iframe);
              resolve(); // Resolve anyway since print was triggered
            }
          }, 4000);
        };
      } catch (err) {
        reject(err);
      }
    });
  }, [terminalName]);

  // 3. Auto Print Loop Engine
  React.useEffect(() => {
    if (status !== "authenticated" || !autoPrintEnabled) return;

    addLog("info", `Auto Print Engine initialized for terminal [${terminalName}]`);

    async function printWorker() {
      if (printingInProgress.current) return;
      if (autoPrintPaused) {
        return;
      }
      printingInProgress.current = true;

      try {
        addLog("info", "Checking for new unprinted orders...");
        const res = await fetch(`${WORKER_URL}/api/tiktok/orders?_t=${Date.now()}`);
        if (!res.ok) throw new Error(`Fetch failed: ${res.statusText}`);
        
        const data = await res.json();
        if (!data.success || !data.orders) throw new Error(data.error || "No orders returned");

        const unprintedOrders = data.orders.filter((order: any) => {
          const isUnpacked = (order.system_status || "").toLowerCase() === "unpacked";
          const isNotPrinted = !order.awb_printed;
          const orderAge = Date.now() - (order.create_time * 1000);
          const passesGracePeriod = orderAge >= 5 * 60 * 1000; // 5 minutes grace period
          
          if (isUnpacked && isNotPrinted && !passesGracePeriod) {
            // Log once for grace period warning
            if (!processedOrderIds.current.has(order.id)) {
              addLog("info", `Order ${order.id} is within the 5-minute grace period. Waiting.`);
              processedOrderIds.current.add(order.id); // Add to processed temp so we don't log it on every check
            }
          }

          return isUnpacked && isNotPrinted && passesGracePeriod;
        });

        // Clear processed set for orders no longer in the pending list
        const activeIds = new Set(data.orders.map((o: any) => o.id));
        for (const id of processedOrderIds.current) {
          if (!activeIds.has(id)) {
            processedOrderIds.current.delete(id);
          }
        }

        if (unprintedOrders.length === 0) {
          printingInProgress.current = false;
          return;
        }

        addLog("info", `Found ${unprintedOrders.length} pending unprinted orders.`);

        for (const order of unprintedOrders) {
          try {
            let docUrl = "";
            const cachedAwb = order.proof_photo || "";
            const hasTracking = order.tracking_number && order.tracking_number !== "N/A" && order.tracking_number.trim() !== "";

            if (cachedAwb && cachedAwb.startsWith("http")) {
              addLog("info", `Using cached AWB from database for order ${order.id}`);
              docUrl = cachedAwb;
            } else if (hasTracking) {
              addLog("info", `AWB tracking number already exists for order ${order.id}. Fetching document URL...`);
              const printRes = await fetch(`${WORKER_URL}/api/tiktok/orders/print-awb?order_id=${encodeURIComponent(order.id)}&shop_id=${encodeURIComponent(order.shop_id)}&action_by=${encodeURIComponent(terminalName)}`);
              if (!printRes.ok) {
                throw new Error(`Failed to retrieve document: ${printRes.statusText}`);
              }
              const printData = await printRes.json();
              if (!printData.success || !printData.doc_url) {
                throw new Error(printData.error || "No document URL returned from server");
              }
              docUrl = printData.doc_url;
            } else {
              addLog("info", `Generating AWB for order ${order.id}...`);
              const createRes = await fetch(`${WORKER_URL}/api/tiktok/orders/create-awb`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  order_id: order.id,
                  shop_id: order.shop_id,
                  action_by: terminalName
                })
              });

              if (!createRes.ok) {
                const errTxt = await createRes.text();
                throw new Error(errTxt || "AWB creation failed");
              }

              const createData = await createRes.json();
              if (!createData.success) {
                throw new Error(createData.error || "Failed to arrange shipment");
              }

              addLog("info", `Retrieving AWB document URL for order ${order.id}...`);
              const printRes = await fetch(`${WORKER_URL}/api/tiktok/orders/print-awb?order_id=${encodeURIComponent(order.id)}&shop_id=${encodeURIComponent(order.shop_id)}&action_by=${encodeURIComponent(terminalName)}`);
              if (!printRes.ok) {
                throw new Error(`Failed to retrieve document: ${printRes.statusText}`);
              }
              const printData = await printRes.json();
              if (!printData.success || !printData.doc_url) {
                throw new Error(printData.error || "No document URL returned from server");
              }
              docUrl = printData.doc_url;
            }

            addLog("info", `AWB document generated. Spooling printing...`);
            await printPdf(docUrl, order.id, order.shop_id);
            addLog("success", `SUCCESS: Printed label for order ${order.id}`);

            // Dispatch global refresh event to refresh screen tables
            window.dispatchEvent(new CustomEvent("db-refresh"));

          } catch (orderErr: any) {
            addLog("error", `ERROR: Failed to print order ${order.id} - ${orderErr.message || orderErr}`);
            processedOrderIds.current.delete(order.id); // Allow retry next loop
          }
        }
      } catch (loopErr: any) {
        addLog("error", `Print loop worker failed: ${loopErr.message}`);
      } finally {
        printingInProgress.current = false;
      }
    }

    const timer = setInterval(printWorker, 30000); // Poll every 30 seconds
    printWorker(); // Run immediately on mount

    return () => clearInterval(timer);
  }, [status, autoPrintEnabled, terminalName, addLog, printPdf, autoPrintPaused]);

  const handleKeypadPress = (val: string) => {
    if (enteredPin.length >= 4) return;
    const newPin = enteredPin + val;
    setEnteredPin(newPin);

    if (newPin.length === 4) {
      if (newPin === terminalPin) {
        sessionStorage.setItem("terminal_auth", "true");
        sessionStorage.setItem("terminal_name", terminalName);
        sessionStorage.setItem("terminal_allowed_pages", JSON.stringify(allowedPages));
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
      {children}

      {/* Floating Kiosk Console Drawer */}
      {autoPrintEnabled && (
        <div className="fixed bottom-4 right-4 z-50 font-primary select-none flex flex-col items-end">
          {/* Main expanded console body */}
          {isConsoleOpen && (
            <div className="w-80 h-72 bg-[#1f1f1f] rounded-xl border border-zinc-700 shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-150 mb-2">
              <header className="px-4 py-2 bg-zinc-800 border-b border-zinc-700 flex justify-between items-center text-xs font-bold text-zinc-300">
                <div className="flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-full animate-pulse ${autoPrintPaused ? "bg-red-500" : "bg-green-500"}`} />
                  <span>{terminalName} - Auto Print Log</span>
                </div>
                <div className="flex items-center gap-2">
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
                  <button 
                    onClick={() => setIsConsoleOpen(false)}
                    className="text-zinc-400 hover:text-white transition text-xs"
                  >
                    ✕
                  </button>
                </div>
              </header>
              
              {/* Scrollable logs viewport */}
              <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1.5 font-mono text-[10px] text-zinc-400">
                {printLogs.length === 0 ? (
                  <span className="italic text-zinc-600 text-center mt-20">No print jobs processed yet.</span>
                ) : (
                  printLogs.map((log, idx) => {
                    let typeColor = "text-zinc-400";
                    if (log.type === "success") typeColor = "text-green-400 font-bold";
                    if (log.type === "error") typeColor = "text-red-400 font-bold";
                    
                    return (
                      <div key={idx} className="flex gap-1.5 leading-relaxed break-words">
                        <span className="text-zinc-600 font-semibold">[{log.timestamp}]</span>
                        <span className={typeColor}>{log.message}</span>
                      </div>
                    );
                  })
                )}
              </div>

              <footer className="px-3 py-1.5 bg-zinc-800/80 border-t border-zinc-700 flex justify-between text-[9px] text-zinc-500 font-semibold">
                <span>Polling synced database: 30s</span>
                <button 
                  onClick={() => setPrintLogs([])}
                  className="hover:text-zinc-300 transition"
                >
                  Clear Console
                </button>
              </footer>
            </div>
          )}

          {/* Trigger button/badge */}
          <button
            onClick={() => setIsConsoleOpen(prev => !prev)}
            className="flex items-center gap-2 px-3 py-2 bg-[#1f1f1f] text-white border border-zinc-700 rounded-full shadow-lg hover:bg-zinc-800 transition outline-none cursor-pointer"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs font-bold">{terminalName} Auto Print</span>
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
