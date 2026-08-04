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

  const [awbDownloadPath, setAwbDownloadPath] = React.useState("");
  const [awbPrintScale, setAwbPrintScale] = React.useState("100");
  const [isPrintTerminal, setIsPrintTerminal] = React.useState(false);

  React.useEffect(() => {
    if (typeof window !== "undefined") {
      setAwbDownloadPath(localStorage.getItem("awb_download_path") || "");
      setAwbPrintScale(localStorage.getItem("awb_print_scale") || "100");
      setIsPrintTerminal(sessionStorage.getItem("terminal_auto_print") === "true");
    }
  }, []);

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

    // Enforce start date cannot be before shop's Sync Start Date
    const selectedShop = status?.shops?.find(s => s.shop_id === histShopId);
    const shopSyncStartDate = selectedShop?.sync_start_date ? Number(selectedShop.sync_start_date) : 0;
    if (shopSyncStartDate && start.getTime() < shopSyncStartDate) {
      const formattedDate = new Date(shopSyncStartDate).toLocaleDateString('en-GB'); // dd/mm/yyyy
      showToast(`Start date cannot be before the shop's Sync Start Date (${formattedDate})`);
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

      const res = await fetch(`https://ib.hsgglobalpteltd.workers.dev/api/tiktok/orders?sync=true&shop_id=${histShopId}&sync_start_date=${startMs}&sync_end_date=${endMs}&_t=${Date.now()}`, {
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

  // Terminal auto print testing functions removed

  const handleChooseFolder = async () => {
    try {
      const res = await fetch("/api/select-folder", { method: "POST" });
      if (!res.ok) throw new Error("Failed to open folder picker");
      const data = await res.json();
      if (data.success && data.path) {
        setAwbDownloadPath(data.path);
        showToast(`Selected folder: ${data.path}`);
      }
    } catch (err: any) {
      console.error("Choose folder error:", err);
      showToast("Error opening folder picker dialog.");
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

  // Dynamic constraints for Historical Sync Date Pickers
  const todayStr = new Date().toISOString().split('T')[0];
  const selectedShop = status?.shops?.find(s => s.shop_id === histShopId);
  const shopSyncStartDate = selectedShop?.sync_start_date ? Number(selectedShop.sync_start_date) : 0;
  const shopSyncStartDateStr = shopSyncStartDate 
    ? new Date(shopSyncStartDate).toISOString().split('T')[0] 
    : undefined;

  let minStartDate = shopSyncStartDateStr;
  let maxStartDate = todayStr;
  let minEndDate = histStartDate || shopSyncStartDateStr;
  let maxEndDate = todayStr;

  if (histStartDate) {
    const startObj = new Date(histStartDate);
    const maxEndObj = new Date(startObj.getTime() + 31 * 24 * 3600 * 1000);
    const maxEndCalculatedStr = maxEndObj.toISOString().split('T')[0];
    maxEndDate = maxEndCalculatedStr < todayStr ? maxEndCalculatedStr : todayStr;
  }
  if (histEndDate) {
    maxStartDate = histEndDate;
    const endObj = new Date(histEndDate);
    const minStartObj = new Date(endObj.getTime() - 31 * 24 * 3600 * 1000);
    const minStartCalculatedStr = minStartObj.toISOString().split('T')[0];
    if (shopSyncStartDateStr) {
      minStartDate = minStartCalculatedStr > shopSyncStartDateStr ? minStartCalculatedStr : shopSyncStartDateStr;
    } else {
      minStartDate = minStartCalculatedStr;
    }
  }

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
                    {["5M", "30M", "1H", "3H", "6H", "12H"].map((val) => {
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

                {/* Time Sync Window (Only visible/enabled for 5M, 30M, 1H and 3H) */}
                {(syncInterval === "5M" || syncInterval === "30M" || syncInterval === "1H" || syncInterval === "3H") && (
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

          {/* Terminal Print Testing Section removed */}

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

          {/* AWB File Download Configuration Section */}
          {isPrintTerminal && (
            <div className="settings-section" style={{ flexShrink: 0, overflow: "visible" }}>
              <div className="section-header">
                <h2 className="section-title">AWB PDF File Download Settings</h2>
                <button
                  type="button"
                  onClick={() => {
                    if (!awbDownloadPath.trim()) {
                      showToast("Error: Local Save Directory Path is mandatory!");
                      return;
                    }
                    const scaleNum = Number(awbPrintScale);
                    if (isNaN(scaleNum) || scaleNum < 10 || scaleNum > 100) {
                      showToast("Error: Print Scale must be a number between 10 and 100!");
                      return;
                    }
                    localStorage.setItem("awb_download_path", awbDownloadPath.trim());
                    localStorage.setItem("enable_awb_download", "true");
                    localStorage.setItem("awb_print_scale", String(scaleNum));
                    showToast("AWB settings saved successfully.");
                  }}
                  className="btn-primary"
                  style={{ height: "36px" }}
                >
                  Save Settings
                </button>
              </div>
              <div className="flex flex-col gap-2.5">
                <p className="helper-note" style={{ margin: 0, fontSize: "11px", color: "#5F6368" }}>
                  Automatically save downloaded AWB PDF documents to a specified local directory. Files will be organized separately by Shop name and month.
                </p>
                
                <div className="flex flex-col gap-1 mt-2">
                  <label className="form-label" style={{ fontWeight: 600, fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}>
                    Local Save Directory Path <span style={{ color: "#D93025" }}>* (Required)</span>
                  </label>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center", maxWidth: "580px" }}>
                    <input
                      type="text"
                      value={awbDownloadPath}
                      onChange={(e) => setAwbDownloadPath(e.target.value)}
                      placeholder="e.g. C:\Users\User\Downloads\AWB"
                      className="form-input"
                      style={{ flex: 1, height: "36px" }}
                    />
                    <button
                      type="button"
                      onClick={handleChooseFolder}
                      className="btn-secondary"
                      style={{ 
                        height: "36px", 
                        padding: "0 16px", 
                        display: "flex", 
                        alignItems: "center", 
                        gap: "6px",
                        borderColor: "#D3E3FD",
                        backgroundColor: "#F8F9FA",
                        color: "#0B57D0",
                        fontWeight: 600,
                        cursor: "pointer"
                      }}
                    >
                      Select Folder
                    </button>
                  </div>
                  <span className="helper-note" style={{ margin: 0, fontSize: "10px", color: "#80868B" }}>
                    Example format: <code>{"{Save Path}\\{Shop Name}\\{YYYY-MM}\\{Order ID}.pdf"}</code>
                  </span>
                </div>

                <div className="flex flex-col gap-1 mt-3">
                  <label className="form-label" style={{ fontWeight: 600, fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}>
                    AWB Print Scale (%) <span style={{ color: "#D93025" }}>* (Required)</span>
                  </label>
                  <input
                    type="number"
                    value={awbPrintScale}
                    onChange={(e) => setAwbPrintScale(e.target.value)}
                    min="10"
                    max="100"
                    className="form-input"
                    style={{ width: "100px", height: "36px", textAlign: "center" }}
                  />
                  <span className="helper-note" style={{ margin: 0, fontSize: "10px", color: "#80868B" }}>
                    Specifies custom scaling percentage (anchored top-left). Default is 100 for normal A6 fit.
                  </span>
                </div>

              </div>
            </div>
          )}

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
                                  max={todayStr}
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
                  min={minStartDate}
                  max={maxStartDate}
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
                  min={minEndDate}
                  max={maxEndDate}
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
