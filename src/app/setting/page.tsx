"use client";

import * as React from "react";
import { TopBar } from "../../components/TopBar";

interface RecentOrder {
  id: string;
  status: string;
  courier: string;
  tracking_number: string;
}

interface Shop {
  shop_id: string;
  shop_name: string;
  region: string;
  recent_orders?: RecentOrder[];
  sync_start_date?: number;
}

interface ConnectionStatus {
  connected: boolean;
  is_expired: boolean;
  seller_name: string;
  seller_id: string;
  shop_cipher: string;
  auth_url: string;
  shops: Shop[];
}

interface ScopeStatus {
  ok: boolean;
  message: string;
}

interface ScopesCheckResult {
  connected: boolean;
  shop_info?: ScopeStatus;
  order_info?: ScopeStatus;
  fulfillment?: ScopeStatus;
}

export default function SettingPage() {
  const [appKey, setAppKey] = React.useState("");
  const [appSecret, setAppSecret] = React.useState("");
  const [syncInterval, setSyncInterval] = React.useState("1H");
  const [syncWorkingDays, setSyncWorkingDays] = React.useState<string[]>(["Mon", "Tue", "Wed", "Thu", "Fri"]);
  const [syncTimeFrom, setSyncTimeFrom] = React.useState("09:00");
  const [syncTimeTo, setSyncTimeTo] = React.useState("18:00");
  
  // Baseline states for change detection
  const [initialSyncInterval, setInitialSyncInterval] = React.useState("1H");
  const [initialSyncWorkingDays, setInitialSyncWorkingDays] = React.useState<string[]>(["Mon", "Tue", "Wed", "Thu", "Fri"]);
  const [initialSyncTimeFrom, setInitialSyncTimeFrom] = React.useState("09:00");
  const [initialSyncTimeTo, setInitialSyncTimeTo] = React.useState("18:00");

  const [status, setStatus] = React.useState<ConnectionStatus | null>(null);
  const [scopesCheck, setScopesCheck] = React.useState<ScopesCheckResult | null>(null);
  const [isLoadingKeys, setIsLoadingKeys] = React.useState(true);
  const [isLoadingStatus, setIsLoadingStatus] = React.useState(true);
  const [isCheckingScopes, setIsCheckingScopes] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isEditingApi, setIsEditingApi] = React.useState(false);
  const [isSavingSync, setIsSavingSync] = React.useState(false);
  const [toastMessage, setToastMessage] = React.useState<string | null>(null);
  
  // Historical sync block states
  const [histShopId, setHistShopId] = React.useState("");
  const [histStartDate, setHistStartDate] = React.useState("");
  const [histEndDate, setHistEndDate] = React.useState("");
  const [histLogs, setHistLogs] = React.useState<string[]>([]);
  const [isSyncingHistBlock, setIsSyncingHistBlock] = React.useState(false);
  const [cooldownSeconds, setCooldownSeconds] = React.useState(0);

  // Load initial cooldown if any
  React.useEffect(() => {
    const lastSync = localStorage.getItem("last_historical_sync_timestamp");
    if (lastSync) {
      const elapsed = Date.now() - Number(lastSync);
      const remaining = Math.ceil((3 * 60 * 1000 - elapsed) / 1000);
      if (remaining > 0) {
        setCooldownSeconds(remaining);
      }
    }
  }, []);

  // Cooldown countdown tick
  React.useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const t = setTimeout(() => {
      setCooldownSeconds(prev => prev - 1);
    }, 1000);
    return () => clearTimeout(t);
  }, [cooldownSeconds]);

  const handleHistoricalSyncBlock = async () => {
    if (!histShopId) {
      showToast("Please select a shop first");
      return;
    }
    if (!histStartDate || !histEndDate) {
      showToast("Please select both start and end dates");
      return;
    }

    const start = new Date(histStartDate);
    const end = new Date(histEndDate);
    const today = new Date();
    
    // Reset hours to compare dates only
    today.setHours(23, 59, 59, 999);
    
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    oneYearAgo.setHours(0,0,0,0);

    if (start.getTime() < oneYearAgo.getTime()) {
      showToast("Start date cannot be more than 1 year in the past");
      return;
    }
    if (end.getTime() > today.getTime()) {
      showToast("End date cannot be in the future");
      return;
    }
    if (start.getTime() > end.getTime()) {
      showToast("Start date must be before end date");
      return;
    }

    const diffDays = Math.ceil((end.getTime() - start.getTime()) / (24 * 3600 * 1000));
    if (diffDays > 31) {
      showToast("Maximum date range is 31 days per sync request");
      return;
    }

    // Check cooldown
    const lastSync = localStorage.getItem("last_historical_sync_timestamp");
    if (lastSync) {
      const elapsed = Date.now() - Number(lastSync);
      const remaining = Math.ceil((3 * 60 * 1000 - elapsed) / 1000);
      if (remaining > 0) {
        showToast(`Please wait ${remaining} seconds before requesting again (cooldown active)`);
        return;
      }
    }

    setIsSyncingHistBlock(true);
    setHistLogs(prev => [...prev, `[System] Starting historical sync for range ${histStartDate} to ${histEndDate}...`]);

    try {
      const startMs = start.getTime();
      const endMs = end.getTime();

      const res = await fetch(`https://ib.hsgglobalpteltd.workers.dev/api/tiktok/orders?sync=true&sync_start_date=${startMs}&sync_end_date=${endMs}&_t=${Date.now()}`, {
        cache: "no-store"
      });

      if (!res.ok) {
        throw new Error(`Sync request failed with status: ${res.status}`);
      }

      const data = await res.json() as any;
      if (data && data.success) {
        // Record successful sync time to activate 3-minute cooldown
        const nowMs = Date.now();
        localStorage.setItem("last_historical_sync_timestamp", nowMs.toString());
        setCooldownSeconds(180); // 3 minutes

        const syncedOrders = data.syncedOrders || [];
        if (syncedOrders.length === 0) {
          setHistLogs(prev => [...prev, `[System] Sync complete: No new orders found in TikTok Shop for this period.`]);
        } else {
          const newLogs: string[] = [];
          syncedOrders.forEach((order: any) => {
            // Format order date to dd/mm/yyyy
            const orderDate = new Date(order.create_time * 1000);
            const dd = String(orderDate.getDate()).padStart(2, '0');
            const mm = String(orderDate.getMonth() + 1).padStart(2, '0');
            const yyyy = orderDate.getFullYear();
            const dateStr = `${dd}/${mm}/${yyyy}`;
            newLogs.push(`${dateStr} ID:${order.id} Success`);
          });
          setHistLogs(prev => [...prev, ...newLogs, `[System] Sync complete! Synced ${syncedOrders.length} orders successfully.`]);
        }
        showToast("Historical sync finished successfully!");
        fetchStatus();
      } else {
        throw new Error(data?.error || "Unknown error occurred on server");
      }
    } catch (err: any) {
      console.error(err);
      setHistLogs(prev => [...prev, `[Error] ${err.message || "Failed to complete historical sync"}`]);
      showToast("Historical sync failed.");
    } finally {
      setIsSyncingHistBlock(false);
    }
  };

  React.useEffect(() => {
    fetchKeys();
    fetchStatus();
    fetchScopes();
  }, []);

  const fetchKeys = async () => {
    try {
      setIsLoadingKeys(true);
      const res = await fetch("https://ib.hsgglobalpteltd.workers.dev/api/tiktok/settings?_t=" + Date.now(), { cache: "no-store" });
      if (res.ok) {
        const data = await res.json() as any;
        setAppKey(data.app_key || "");
        setAppSecret(data.app_secret || "");
        
        const interval = data.sync_interval || "1H";
        const daysStr = data.sync_working_days || "Mon,Tue,Wed,Thu,Fri";
        const days = daysStr.split(",").filter(Boolean);
        const timeFrom = data.sync_time_from || "09:00";
        const timeTo = data.sync_time_to || "18:00";

        setSyncInterval(interval);
        setSyncWorkingDays(days);
        setSyncTimeFrom(timeFrom);
        setSyncTimeTo(timeTo);

        setInitialSyncInterval(interval);
        setInitialSyncWorkingDays(days);
        setInitialSyncTimeFrom(timeFrom);
        setInitialSyncTimeTo(timeTo);
      }
    } catch (err) {
      console.error("Failed to load keys", err);
    } finally {
      setIsLoadingKeys(false);
    }
  };

  const fetchStatus = async () => {
    try {
      setIsLoadingStatus(true);
      const res = await fetch("https://ib.hsgglobalpteltd.workers.dev/api/tiktok/auth/status?_t=" + Date.now(), { cache: "no-store" });
      if (res.ok) {
        const data = await res.json() as ConnectionStatus;
        setStatus(data);
      }
    } catch (err) {
      console.error("Failed to load connection status", err);
    } finally {
      setIsLoadingStatus(false);
    }
  };

  const fetchScopes = async () => {
    try {
      setIsCheckingScopes(true);
      const res = await fetch("https://ib.hsgglobalpteltd.workers.dev/api/tiktok/auth/check-scopes?_t=" + Date.now(), { cache: "no-store" });
      if (res.ok) {
        const data = await res.json() as ScopesCheckResult;
        setScopesCheck(data);
      }
    } catch (err) {
      console.error("Failed to check scopes connection", err);
    } finally {
      setIsCheckingScopes(false);
    }
  };

  const handleSaveKeys = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSaving(true);
      const res = await fetch("https://ib.hsgglobalpteltd.workers.dev/api/tiktok/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          app_key: appKey, 
          app_secret: appSecret
        })
      });
      if (res.ok) {
        showToast("Settings saved successfully");
        setIsEditingApi(false);
        fetchStatus();
        fetchScopes();
      } else {
        showToast("Error saving credentials");
      }
    } catch (err) {
      showToast("Network error occurred");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveSyncSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSavingSync(true);
      const res = await fetch("https://ib.hsgglobalpteltd.workers.dev/api/tiktok/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          sync_interval: syncInterval,
          sync_working_days: syncWorkingDays.join(","),
          sync_time_from: syncTimeFrom,
          sync_time_to: syncTimeTo
        })
      });
      if (res.ok) {
        showToast("Sync settings saved successfully");
        setInitialSyncInterval(syncInterval);
        setInitialSyncWorkingDays(syncWorkingDays);
        setInitialSyncTimeFrom(syncTimeFrom);
        setInitialSyncTimeTo(syncTimeTo);
      } else {
        showToast("Error saving sync settings");
      }
    } catch (err) {
      showToast("Network error occurred");
    } finally {
      setIsSavingSync(false);
    }
  };

  const handleRecheckAll = () => {
    fetchStatus();
    fetchScopes();
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const formatSyncDate = (timestamp: number) => {
    if (!timestamp) return "N/A";
    const d = new Date(timestamp);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  };

  const [printLogs, setPrintLogs] = React.useState<string[]>([]);
  const [countdown, setCountdown] = React.useState(0);
  const countdownIntervalRef = React.useRef<any>(null);

  const handleTestPrint = () => {
    if (countdown > 0) return;
    setCountdown(60);
    setPrintLogs(prev => [
      ...prev,
      `[System] Initiating AWB combined print test...`,
      `[System] Countdown timer activated: 60 seconds (grace period verification).`
    ]);

    countdownIntervalRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownIntervalRef.current);
          runCombinedPrint();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  React.useEffect(() => {
    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, []);

  const runCombinedPrint = async () => {
    setPrintLogs(prev => [...prev, "[System] Countdown finished. Fetching unprinted orders from server..."]);
    showToast("Starting combined print job...");
    try {
      const res = await fetch(`https://ib.hsgglobalpteltd.workers.dev/api/tiktok/orders?_t=${Date.now()}`);
      if (!res.ok) throw new Error("Failed to fetch orders from server");
      
      const data = await res.json() as any;
      if (!data.success || !data.orders) throw new Error(data.error || "No orders returned");

      const terminalName = sessionStorage.getItem("terminal_name") || "Test Terminal";

      // Filter: status unpacked, awb not printed, age >= 5 mins, not shipped/transit/cancelled
      const unprintedOrders = data.orders.filter((order: any) => {
        const isUnpacked = (order.system_status || "").toLowerCase() === "unpacked";
        const isNotPrinted = !order.awb_printed;
        
        const statusLower = (order.actual_status || "").toLowerCase();
        const cannotPrint = ["pick_up", "in_transit", "shipped", "delivered", "cancelled"].includes(statusLower);

        const orderAge = Date.now() - (order.create_time * 1000);
        return isUnpacked && isNotPrinted && !cannotPrint && orderAge >= 5 * 60 * 1000;
      });

      if (unprintedOrders.length === 0) {
        setPrintLogs(prev => [...prev, "[System] Sync: No active unpacked/unprinted orders found matching print rules (min age 5 mins)."]);
        showToast("No pending unprinted orders to test.");
        return;
      }

      setPrintLogs(prev => [...prev, `[System] Found ${unprintedOrders.length} candidate orders for printing. Generating AWBs...`]);
      showToast(`Generating AWBs for ${unprintedOrders.length} orders...`);
      const docUrls: string[] = [];
      const printedOrdersInfo: { id: string, shop_id: string }[] = [];

      for (const order of unprintedOrders) {
        const orderDate = new Date(order.create_time * 1000);
        const dd = String(orderDate.getDate()).padStart(2, '0');
        const mm = String(orderDate.getMonth() + 1).padStart(2, '0');
        const yyyy = orderDate.getFullYear();
        const dateStr = `${dd}/${mm}/${yyyy}`;

        try {
          let docUrl = "";
          const hasTracking = order.tracking_number && order.tracking_number !== "N/A" && order.tracking_number.trim() !== "";

          if (hasTracking) {
            const printRes = await fetch(`https://ib.hsgglobalpteltd.workers.dev/api/tiktok/orders/print-awb?order_id=${encodeURIComponent(order.id)}&shop_id=${encodeURIComponent(order.shop_id)}&action_by=${encodeURIComponent(terminalName)}`);
            if (printRes.ok) {
              const printData = await printRes.json() as any;
              if (printData.success && printData.doc_url) {
                docUrl = printData.doc_url;
              }
            }
          } else {
            const createRes = await fetch("https://ib.hsgglobalpteltd.workers.dev/api/tiktok/orders/create-awb", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                order_id: order.id,
                shop_id: order.shop_id,
                action_by: terminalName
              })
            });
            if (createRes.ok) {
              const createData = await createRes.json() as any;
              if (createData.success) {
                const printRes = await fetch(`https://ib.hsgglobalpteltd.workers.dev/api/tiktok/orders/print-awb?order_id=${encodeURIComponent(order.id)}&shop_id=${encodeURIComponent(order.shop_id)}&action_by=${encodeURIComponent(terminalName)}`);
                if (printRes.ok) {
                  const printData = await printRes.json() as any;
                  if (printData.success && printData.doc_url) {
                    docUrl = printData.doc_url;
                  }
                }
              }
            }
          }

          if (docUrl) {
            docUrls.push(docUrl);
            printedOrdersInfo.push({ id: order.id, shop_id: order.shop_id });
            setPrintLogs(prev => [...prev, `${dateStr} ID:${order.id} Success`]);
          } else {
            throw new Error("Unable to retrieve PDF URL");
          }
        } catch (err: any) {
          console.error(`Failed to create AWB for order ${order.id}:`, err);
          setPrintLogs(prev => [...prev, `${dateStr} ID:${order.id} Failed (${err.message})`]);
        }
      }

      if (docUrls.length === 0) {
        throw new Error("Failed to generate shipping documents for candidate orders.");
      }

      setPrintLogs(prev => [...prev, "[System] PDF documents fetched. Merging AWBs into a combined job..."]);
      showToast("Downloading and merging AWBs...");
      const { PDFDocument } = await import("pdf-lib");
      const mergedPdf = await PDFDocument.create();

      for (const docUrl of docUrls) {
        try {
          const proxyUrl = `https://ib.hsgglobalpteltd.workers.dev/api/proxy?url=${encodeURIComponent(docUrl)}`;
          const pdfRes = await fetch(proxyUrl);
          if (pdfRes.ok) {
            const pdfBytes = await pdfRes.arrayBuffer();
            const pdf = await PDFDocument.load(pdfBytes);
            const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
            copiedPages.forEach((page) => {
              mergedPdf.addPage(page);
            });
          }
        } catch (err) {
          console.error("Failed to fetch/merge PDF:", err);
        }
      }

      setPrintLogs(prev => [...prev, "[System] Spooling combined PDF to local printer..."]);
      showToast("Spooling merged shipping documents to printer...");
      const mergedPdfBytes = await mergedPdf.save();
      const blob = new Blob([mergedPdfBytes as any], { type: "application/pdf" });
      const blobUrl = URL.createObjectURL(blob);

      // Print in hidden iframe
      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "none";
      iframe.src = blobUrl;
      document.body.appendChild(iframe);

      iframe.onload = () => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(async () => {
          document.body.removeChild(iframe);
          URL.revokeObjectURL(blobUrl);
          
          // Log printed status in backend for all
          for (const info of printedOrdersInfo) {
            try {
              await fetch(`https://ib.hsgglobalpteltd.workers.dev/api/tiktok/orders/print-awb?order_id=${encodeURIComponent(info.id)}&shop_id=${encodeURIComponent(info.shop_id)}&action_by=${encodeURIComponent(terminalName)}`);
            } catch {}
          }
          setPrintLogs(prev => [...prev, "[System] Merged PDF spooled successfully. Print completed."]);
          showToast("Combined print job spooled successfully.");
          // Trigger page updates
          window.dispatchEvent(new CustomEvent("db-refresh"));
        }, 4000);
      };
    } catch (err: any) {
      setPrintLogs(prev => [...prev, `[Error] Test print failed: ${err.message}`]);
      showToast(`Test print failed: ${err.message}`);
    }
  };

  const handleUpdateSyncStartDate = async (shopId: string, timestamp: number) => {
    try {
      const res = await fetch("https://ib.hsgglobalpteltd.workers.dev/api/tiktok/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          shop_id: shopId, 
          sync_start_date: timestamp
        })
      });
      if (res.ok) {
        showToast("Sync start date updated successfully");
        fetchStatus();
      } else {
        showToast("Error updating sync start date");
      }
    } catch (err) {
      showToast("Network error occurred");
    }
  };

  const hasSyncChanges = 
    syncInterval !== initialSyncInterval ||
    syncTimeFrom !== initialSyncTimeFrom ||
    syncTimeTo !== initialSyncTimeTo ||
    JSON.stringify([...syncWorkingDays].sort()) !== JSON.stringify([...initialSyncWorkingDays].sort());

  return (
    <div className="blank-route-page" style={{ display: "block", overflowY: "auto", position: "fixed", inset: 0 }}>
      <TopBar title="Setting" />

      {/* Main Settings Canvas Container */}
      <div className="settings-container">
        
        {/* Left Column Wrapper */}
        <div className="flex flex-col gap-5 pr-1" style={{ height: "auto", minWidth: "0" }}>
          
          {/* Connection Credentials Section */}
          <div className="settings-section" style={{ flexShrink: 0, overflow: "visible" }}>
            
            {/* Header (Always Visible) */}
            <div className="flex justify-between items-center" style={{ marginBottom: "16px" }}>
              <h2 className="section-title">TikTok API Credentials</h2>
              {!isLoadingKeys && (
                <div>
                  {!isEditingApi ? (
                    <button 
                      type="button"
                      onClick={() => setIsEditingApi(true)}
                      className="btn-secondary"
                    >
                      Edit API Settings
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <button 
                        onClick={handleSaveKeys}
                        disabled={isSaving}
                        className="btn-primary"
                      >
                        {isSaving ? "Saving..." : "Save Setting Api"}
                      </button>
                      <button 
                        type="button"
                        onClick={() => {
                          setIsEditingApi(false);
                          fetchKeys();
                        }}
                        className="btn-secondary"
                        style={{ borderColor: "#E0E2E6", color: "#5F6368" }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {isLoadingKeys ? (
              <div className="empty-shops-state" style={{ borderStyle: "none" }}>Loading credentials...</div>
            ) : (
              <form onSubmit={handleSaveKeys} className="settings-form">
                <div className="flex gap-4">
                  <div className="form-group" style={{ flex: 4 }}>
                    <label className="form-label">TikTok App Key</label>
                    <input 
                      type="text" 
                      value={appKey} 
                      onChange={(e) => setAppKey(e.target.value)}
                      placeholder="Enter App Key"
                      className="form-input"
                      disabled={!isEditingApi}
                    />
                  </div>

                  <div className="form-group" style={{ flex: 6 }}>
                    <label className="form-label">TikTok App Secret</label>
                    <input 
                      type="password" 
                      value={appSecret} 
                      onChange={(e) => setAppSecret(e.target.value)}
                      placeholder="Enter App Secret"
                      className="form-input"
                      disabled={!isEditingApi}
                    />
                  </div>
                </div>
              </form>
            )}

            {/* Scope Verification List Section (Moved directly under API fields) */}
            <div style={{ marginTop: "24px", borderTop: "1px solid #E0E2E6", paddingTop: "16px" }}>
              <h3 className="form-label" style={{ fontWeight: 600, marginBottom: "8px" }}>Scope Authorization Health</h3>
              {isCheckingScopes ? (
                <div className="empty-shops-state" style={{ borderStyle: "none" }}>Checking API scopes health...</div>
              ) : (
                <div className="scope-card-list">
                  
                  {/* 1. Global Shop Info Scope */}
                  <div className="scope-card-item">
                    <div className="scope-details">
                      <span className="scope-name">Global Shop Information</span>
                      <span className="scope-key">seller.shop.info</span>
                    </div>
                    {scopesCheck?.shop_info?.ok ? (
                      <span className="scope-badge success">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="10 3 4.5 8.5 2 6"></polyline></svg>
                        Healthy
                      </span>
                    ) : (
                      <span className="scope-badge error" title={scopesCheck?.shop_info?.message}>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="9.5" y1="2.5" x2="2.5" y2="9.5"></line><line x1="2.5" y1="2.5" x2="9.5" y2="9.5"></line></svg>
                        Error
                      </span>
                    )}
                  </div>

                  {/* 2. Order Information Scope */}
                  <div className="scope-card-item">
                    <div className="scope-details">
                      <span className="scope-name">Order Information</span>
                      <span className="scope-key">seller.order.info</span>
                    </div>
                    {scopesCheck?.order_info?.ok ? (
                      <span className="scope-badge success">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="10 3 4.5 8.5 2 6"></polyline></svg>
                        Healthy
                      </span>
                    ) : (
                      <span className="scope-badge error" title={scopesCheck?.order_info?.message}>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="9.5" y1="2.5" x2="2.5" y2="9.5"></line><line x1="2.5" y1="2.5" x2="9.5" y2="9.5"></line></svg>
                        Error
                      </span>
                    )}
                  </div>

                  {/* 3. Fulfillment Basic Scope */}
                  <div className="scope-card-item">
                    <div className="scope-details">
                      <span className="scope-name">Fulfillment Basic</span>
                      <span className="scope-key">seller.fulfillment.basic</span>
                    </div>
                    {scopesCheck?.fulfillment?.ok ? (
                      <span className="scope-badge success">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="10 3 4.5 8.5 2 6"></polyline></svg>
                        Healthy
                      </span>
                    ) : (
                      <span className="scope-badge error" title={scopesCheck?.fulfillment?.message}>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="9.5" y1="2.5" x2="2.5" y2="9.5"></line><line x1="2.5" y1="2.5" x2="9.5" y2="9.5"></line></svg>
                        Error
                      </span>
                    )}
                  </div>

                </div>
              )}
            </div>
          </div>

          {/* Auto-Sync Settings Section */}
          <div className="settings-section" style={{ flex: "1 0 auto", overflow: "visible" }}>
            
            {/* Header (contains save button only if there are changes) */}
            <div className="flex justify-between items-center" style={{ marginBottom: "16px" }}>
              <h2 className="section-title">Auto-Sync Settings</h2>
              {hasSyncChanges && (
                <button 
                  onClick={handleSaveSyncSettings}
                  disabled={isSavingSync}
                  className="btn-primary"
                >
                  {isSavingSync ? "Saving..." : "Save Sync Settings"}
                </button>
              )}
            </div>
            
            <form onSubmit={handleSaveSyncSettings} className="settings-form">
              {/* Horizontal row combining Sync Interval and Time Sync Between */}
              <div className="flex flex-wrap items-end gap-6 mb-4">
                {/* Sync Interval Radio Button Group */}
                <div className="flex-1 min-w-[280px]">
                  <label className="form-label block mb-2">Sync Interval</label>
                  <div className="flex items-center gap-2">
                    {["1H", "3H", "6H", "12H"].map((val) => {
                      const isSelected = syncInterval === val;
                      return (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setSyncInterval(val)}
                          className={`px-4 py-2 text-xs font-semibold rounded-lg border transition duration-150 cursor-pointer outline-none ${
                            isSelected 
                              ? "bg-[#EAF1FB] border-[#C2E7FF] text-[#0B57D0]" 
                              : "bg-transparent border-[#E0E2E6] text-[#5F6368] hover:bg-[#F8F9FA]"
                          }`}
                        >
                          {val}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Time Sync Window (Only visible/enabled for 1H and 3H) */}
                {(syncInterval === "1H" || syncInterval === "3H") && (
                  <div className="flex-shrink-0" style={{ minWidth: "260px" }}>
                    <label className="form-label block mb-2">Time Sync Between</label>
                    <div className="flex items-center gap-2">
                      <input 
                        type="time" 
                        value={syncTimeFrom}
                        onChange={(e) => setSyncTimeFrom(e.target.value)}
                        className="form-input"
                        style={{ maxWidth: "120px", height: "36px" }}
                      />
                      <span className="text-xs text-[#5F6368]">to</span>
                      <input 
                        type="time" 
                        value={syncTimeTo}
                        onChange={(e) => setSyncTimeTo(e.target.value)}
                        className="form-input"
                        style={{ maxWidth: "120px", height: "36px" }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Working Days Selector */}
              <div className="form-group" style={{ marginBottom: "16px" }}>
                <label className="form-label">Working Days</label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => {
                    const isSelected = syncWorkingDays.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => {
                          if (isSelected) {
                            setSyncWorkingDays(syncWorkingDays.filter(d => d !== day));
                          } else {
                            setSyncWorkingDays([...syncWorkingDays, day]);
                          }
                        }}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition duration-150 cursor-pointer outline-none ${
                          isSelected 
                            ? "bg-[#EAF1FB] border-[#C2E7FF] text-[#0B57D0]" 
                            : "bg-transparent border-[#E0E2E6] text-[#5F6368] hover:bg-[#F8F9FA]"
                        }`}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              </div>
            </form>
          </div>

          {/* Terminal Print Testing Section */}
          <div className="settings-section" style={{ flexShrink: 0, overflow: "visible" }}>
            <div className="section-header">
              <h2 className="section-title">Terminal Auto Print Testing</h2>
              <div className="flex gap-2">
                {countdown > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (countdownIntervalRef.current) {
                        clearInterval(countdownIntervalRef.current);
                        countdownIntervalRef.current = null;
                      }
                      setCountdown(0);
                      showToast("Test print countdown stopped.");
                      setPrintLogs(prev => [...prev, "[System] Test print countdown stopped by user."]);
                    }}
                    className="btn-secondary"
                    style={{
                      padding: "0 16px",
                      fontSize: "12px",
                      fontWeight: "600",
                      height: "36px",
                      borderRadius: "100px",
                      borderColor: "#ea868f",
                      color: "#dc3545",
                      cursor: "pointer"
                    }}
                  >
                    Stop Print
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleTestPrint}
                  disabled={countdown > 0}
                  className="btn-primary"
                  style={{
                    padding: "0 16px",
                    fontSize: "12px",
                    fontWeight: "600",
                    height: "36px",
                    borderRadius: "100px",
                    cursor: countdown > 0 ? "not-allowed" : "pointer"
                  }}
                >
                  {countdown > 0 ? `Pending (${countdown}s)` : "Test Print"}
                </button>
              </div>
            </div>
            
            <div className="flex flex-col gap-2.5">
              <p className="helper-note" style={{ margin: 0, fontSize: "11px", color: "#5F6368" }}>
                Trigger a manual test print spooler. This will fetch all active unprinted orders from the server, verify the 5-minute grace period, generate their AWBs, merge them, and print them in a combined document.
              </p>
              
              {/* Monospace log terminal */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "12px" }}>
                <span className="form-label" style={{ fontWeight: 600, fontSize: "12px" }}>Print Spooler Logs</span>
                <div 
                  className="no-scrollbar"
                  style={{ 
                    height: "260px", 
                    overflowY: "auto", 
                    backgroundColor: "#0B0F19", 
                    color: "#4AF626", 
                    fontFamily: "monospace", 
                    fontSize: "11px", 
                    padding: "12px", 
                    borderRadius: "8px",
                    border: "1px solid #1E293B",
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px"
                  }}
                >
                  {printLogs.length === 0 ? (
                    <span style={{ color: "#64748B", fontStyle: "italic" }}>Print console idle. Click Test Print to run diagnostic print test.</span>
                  ) : (
                    printLogs.map((log, idx) => (
                      <div key={idx} style={{ wordBreak: "break-all", whiteSpace: "pre-wrap" }}>{log}</div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Terminal IP Configuration Section */}
          <div className="settings-section" style={{ flexShrink: 0, overflow: "visible" }}>
            <div className="section-header">
              <h2 className="section-title">Terminal IP Configuration</h2>
              <button
                type="button"
                onClick={() => {
                  const input = document.getElementById("local-ip-settings") as HTMLInputElement;
                  if (input) {
                    localStorage.setItem("local_terminal_ip", input.value.trim());
                    showToast("Local IP override saved successfully. Reloading...");
                    setTimeout(() => {
                      window.location.reload();
                    }, 1500);
                  }
                }}
                className="btn-primary"
                style={{ height: "36px" }}
              >
                Save Local IP
              </button>
            </div>
            <div className="flex flex-col gap-2.5">
              <p className="helper-note" style={{ margin: 0, fontSize: "11px", color: "#5F6368" }}>
                Distinguish multiple machines sharing the same local network by setting a local IPv4 address override.
              </p>
              <div className="flex gap-2.5 mt-2">
                <input
                  type="text"
                  id="local-ip-settings"
                  defaultValue={localStorage.getItem("local_terminal_ip") || ""}
                  placeholder="e.g. 192.168.1.100"
                  className="form-input"
                  style={{ maxWidth: "200px", height: "36px", textAlign: "center" }}
                />
              </div>
            </div>
          </div>

        </div>

      {/* Right Column Wrapper */}
      <div className="flex flex-col gap-5" style={{ height: "auto", minWidth: "0" }}>

        {/* Integration Authorization & Linked Shops */}
        <div className="settings-section" style={{ flexShrink: 0, overflow: "visible" }}>
          <div className="section-header">
            <h2 className="section-title">TikTok Shop Connections</h2>
            <button 
              onClick={handleRecheckAll} 
              disabled={isLoadingStatus || isCheckingScopes}
              className="btn-secondary"
            >
              {isLoadingStatus || isCheckingScopes ? "Checking..." : "Re-check Connection"}
            </button>
          </div>

          {isLoadingStatus ? (
            <div className="empty-shops-state" style={{ borderStyle: "none" }}>Checking connection status...</div>
          ) : (
            <div className="settings-form">
              
              {/* Connection Status Flag */}
              <div className="status-badge-row">
                <div className="status-info-col">
                  <span className="status-badge-label">Authentication Status</span>
                  {status?.connected ? (
                    <span className="status-badge-val status-text connected">
                      <span className="status-dot connected"></span> Connected
                    </span>
                  ) : (
                    <span className="status-badge-val status-text disconnected">
                      <span className="status-dot disconnected"></span> Disconnected
                    </span>
                  )}
                </div>
              </div>

              {/* Linked Shop List Table */}
              <div>
                <h3 className="form-label" style={{ fontWeight: 600, marginBottom: "8px" }}>Linked Shops</h3>
                {status?.connected && status.shops && status.shops.length > 0 ? (
                  <div className="shops-table-wrapper">
                    <table className="shops-table" style={{ width: "100%", tableLayout: "fixed" }}>
                      <thead>
                        <tr>
                          <th style={{ width: "180px" }}>Shop Details</th>
                          <th style={{ width: "150px" }}>Sync Start Date</th>
                          <th>Last 5 Orders</th>
                        </tr>
                      </thead>
                      <tbody>
                        {status.shops.map((shop) => (
                          <tr key={shop.shop_id}>
                            <td style={{ verticalAlign: "top", padding: "12px 16px" }}>
                              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                <span style={{ fontWeight: 600, fontSize: "14px", color: "var(--text-primary)" }}>{shop.shop_name}</span>
                                <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>ID: <code style={{ fontSize: "11px" }}>{shop.shop_id === "default" ? "N/A" : shop.shop_id}</code></span>
                                <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>Region: <span style={{ fontWeight: 500 }}>{shop.region}</span></span>
                              </div>
                            </td>
                            <td style={{ verticalAlign: "top", padding: "12px 16px" }}>
                              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                <input 
                                  type="date" 
                                  value={shop.sync_start_date ? new Date(shop.sync_start_date).toISOString().split('T')[0] : ""} 
                                  disabled={shop.shop_id === "default"}
                                  onChange={async (e) => {
                                    if (e.target.value) {
                                      // Get local selected date timestamp
                                      const selectedDateMs = new Date(e.target.value).getTime();
                                      await handleUpdateSyncStartDate(shop.shop_id, selectedDateMs);
                                    }
                                  }}
                                  className="form-input"
                                  style={{ maxWidth: "150px", padding: "6px 10px", fontSize: "12px" }}
                                />
                                {shop.sync_start_date && (
                                  <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                                    Active: {formatSyncDate(shop.sync_start_date)}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td style={{ padding: "0", verticalAlign: "top" }}>
                              {shop.recent_orders && shop.recent_orders.length > 0 ? (
                                <div className="no-scrollbar" style={{ display: "flex", flexDirection: "row", overflowX: "auto" }}>
                                  {shop.recent_orders.map((order, idx) => (
                                    <div 
                                      key={order.id} 
                                      style={{ 
                                        padding: "8px 12px", 
                                        borderRight: idx < (shop.recent_orders?.length || 0) - 1 ? "1px solid #E0E2E6" : "none",
                                        display: "flex",
                                        flexDirection: "column",
                                        justifyContent: "space-between",
                                        gap: "8px",
                                        minWidth: "220px",
                                        flexShrink: 0
                                      }}
                                    >
                                      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                        <span style={{ fontSize: "12px", fontFamily: "monospace", fontWeight: 500 }}>{order.id}</span>
                                        {order.courier && order.tracking_number && order.courier !== "N/A" ? (
                                          <span style={{ fontSize: "11px", color: "#5F6368" }}>
                                            {order.courier}: <code style={{ fontSize: "11px" }}>{order.tracking_number}</code>
                                          </span>
                                        ) : (
                                          <span style={{ fontSize: "11px", color: "#80868B" }}>No shipping tracking details yet</span>
                                        )}
                                      </div>
                                      <div>
                                        <span style={{
                                          padding: "2px 6px",
                                          borderRadius: "4px",
                                          fontSize: "11px",
                                          fontWeight: 600,
                                          backgroundColor: order.status === "COMPLETED" ? "#E6F4EA" : order.status === "CANCELLED" ? "#FCE8E6" : "#E8F0FE",
                                          color: order.status === "COMPLETED" ? "#137333" : order.status === "CANCELLED" ? "#C5221F" : "#1A73E8"
                                        }}>
                                          {order.status}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div style={{ padding: "8px 12px", color: "#80868B" }}>No orders found for this shop.</div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-shops-state">
                    No shops have been authorized to the system yet.
                  </div>
                )}
              </div>

              {/* Authorize Shop Action Link */}
              <div style={{ marginTop: "16px" }}>
                <a 
                  href="https://services.tiktokshop.com/open/authorize?service_id=7665903523104081672"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary"
                >
                  Authorize TikTok Shop
                </a>
                <p className="helper-note">
                  Opens the official partner authentication portal. Make sure your redirect URI is set to: <br/>
                  <code className="helper-code">
                    https://ib.hsgglobalpteltd.workers.dev/api/tiktok/auth/callback
                  </code>
                </p>
              </div>

            </div>
          )}
        </div>

        {/* Historical Order Sync Section */}
        <div className="settings-section" style={{ flexShrink: 0, overflow: "visible" }}>
          <div className="section-header">
            <h2 className="section-title">Historical Sync Manager</h2>
            <button
              type="button"
              onClick={handleHistoricalSyncBlock}
              disabled={isSyncingHistBlock || cooldownSeconds > 0}
              className="btn-primary"
              style={{
                height: "36px",
                padding: "0 24px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "100px",
                fontWeight: 600,
                fontSize: "12px",
                cursor: (isSyncingHistBlock || cooldownSeconds > 0) ? "not-allowed" : "pointer"
              }}
            >
              {isSyncingHistBlock ? "Syncing..." : cooldownSeconds > 0 ? `Cooldown (${cooldownSeconds}s)` : "Sync Range"}
            </button>
          </div>
          
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <p className="helper-note" style={{ margin: "0" }}>
              Query and sync historical TikTok Shop orders within a specific date range. To protect resource performance, the search is capped to a maximum of 31 days.
            </p>
            
            <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", alignItems: "flex-end" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label className="form-label" style={{ fontWeight: 600, fontSize: "12px" }}>Select Shop</label>
                <select
                  value={histShopId}
                  onChange={(e) => setHistShopId(e.target.value)}
                  className="form-input"
                  style={{ width: "200px", height: "36px", padding: "0 10px" }}
                >
                  <option value="">-- Choose Shop --</option>
                  {status?.shops?.filter(s => s.shop_id !== "default").map(shop => (
                    <option key={shop.shop_id} value={shop.shop_id}>{shop.shop_name}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label className="form-label" style={{ fontWeight: 600, fontSize: "12px" }}>Start Date</label>
                <input
                  type="date"
                  value={histStartDate}
                  onChange={(e) => setHistStartDate(e.target.value)}
                  className="form-input"
                  style={{ width: "160px", height: "36px", padding: "0 10px" }}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label className="form-label" style={{ fontWeight: 600, fontSize: "12px" }}>End Date</label>
                <input
                  type="date"
                  value={histEndDate}
                  onChange={(e) => setHistEndDate(e.target.value)}
                  className="form-input"
                  style={{ width: "160px", height: "36px", padding: "0 10px" }}
                />
              </div>
            </div>

            {/* Terminal logs list block */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span className="form-label" style={{ fontWeight: 600, fontSize: "12px" }}>Sync Terminal Output Logs</span>
              <div 
                className="no-scrollbar"
                style={{ 
                  height: "260px", 
                  overflowY: "auto", 
                  backgroundColor: "#0B0F19", 
                  color: "#4AF626", 
                  fontFamily: "monospace", 
                  fontSize: "11px", 
                  padding: "12px", 
                  borderRadius: "8px",
                  border: "1px solid #1E293B",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px"
                }}
              >
                {histLogs.length === 0 ? (
                  <span style={{ color: "#64748B", fontStyle: "italic" }}>Terminal output idle. Select date range and click Sync to monitor progress here.</span>
                ) : (
                  histLogs.map((log, idx) => (
                    <div key={idx} style={{ wordBreak: "break-all", whiteSpace: "pre-wrap" }}>{log}</div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

      </div>

    </div>

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="toast-msg">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
