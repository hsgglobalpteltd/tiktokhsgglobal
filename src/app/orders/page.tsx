"use client";

import * as React from "react";
import { TopBar } from "../../components/TopBar";
import { PDFDocument } from "pdf-lib";

interface OrderItem {
  product_name: string;
  sku_name: string;
  seller_sku: string;
  sku_image: string;
  quantity: number;
  sale_price: string;
  currency: string;
}

interface IssueItem {
  id: string;
  title: string;
  note: string;
  done: boolean;
}

interface Order {
  id: string;
  shop_id: string;
  shop_name: string;
  create_time: number;
  actual_status: string;
  system_status: string;
  recipient_name: string;
  shipping_provider: string;
  tracking_number: string;
  total_amount: string;
  currency: string;
  items: OrderItem[];
  package_list?: any[];
  packed_by?: string;
  packed_at?: number;
  proof_photo?: string;
  awb_printed?: boolean;
  issues?: IssueItem[];
  logs?: any[];
  before_pack_photo?: string;
  transit_at?: number;
  delivered_at?: number;
}

interface Shop {
  id: string;
  name: string;
}

const formatStatusLabel = (status: string) => {
  switch ((status || "").toUpperCase()) {
    case "AWAITING_SHIPMENT": return "Awaiting Shipment";
    case "AWAITING_COLLECTION": return "Awaiting Collection";
    case "IN_TRANSIT":
    case "SHIPPED":
    case "PICK_UP":
      return "In Transit";
    case "DELIVERED":
    case "COMPLETED":
      return "Delivered";
    case "CANCELLED": return "Cancelled";
    default: return (status || "").toLowerCase().replace(/_/g, " ");
  }
};

const computeOrderSyncStats = (prevOrders: Order[], newOrders: Order[]) => {
  let newCount = 0;
  const statusTransitions: Record<string, number> = {};

  const prevMap = new Map(prevOrders.map(o => [o.id, o]));
  for (const newOrd of newOrders) {
    const prevOrd = prevMap.get(newOrd.id);
    if (!prevOrd) {
      newCount++;
    } else {
      const prevStatus = formatStatusLabel(prevOrd.actual_status);
      const newStatus = formatStatusLabel(newOrd.actual_status);
      if (prevStatus !== newStatus) {
        const transitionKey = `${prevStatus} -> ${newStatus}`;
        statusTransitions[transitionKey] = (statusTransitions[transitionKey] || 0) + 1;
      }
    }
  }

  const details: string[] = [];
  if (newCount > 0) {
    details.push(`• ${newCount} new order${newCount > 1 ? 's' : ''} fetched successfully`);
  }
  for (const [transition, count] of Object.entries(statusTransitions)) {
    const parts = transition.split(" -> ");
    details.push(`• ${count} order${count > 1 ? 's' : ''} status updated from ${parts[0]} to ${parts[1]} successfully`);
  }

  return { newCount, details };
};

export default function OrdersPage() {
  const [shops, setShops] = React.useState<Shop[]>([]);
  const [orders, setOrders] = React.useState<Order[]>([]);
  const [terminalName, setTerminalName] = React.useState("PC Office");
  React.useEffect(() => {
    if (typeof window !== "undefined") {
      const name = sessionStorage.getItem("terminal_name");
      if (name) setTerminalName(name);
    }
  }, []);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSyncing, setIsSyncing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Filter & Sort State
  const [selectedShopId, setSelectedShopId] = React.useState<string>("all");
  const [selectedTab, setSelectedTab] = React.useState<string>("all");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [sortBy, setSortBy] = React.useState<"newest" | "oldest">("newest");
  const [toastMessage, setToastMessage] = React.useState<string | null>(null);
  const [selectedOrderItems, setSelectedOrderItems] = React.useState<Order | null>(null);
  const [awbLoadingOrderId, setAwbLoadingOrderId] = React.useState<string | null>(null);

  // Bulk AWB selection state
  const [selectedOrderIds, setSelectedOrderIds] = React.useState<Set<string>>(new Set());
  const [isBulkPrinting, setIsBulkPrinting] = React.useState(false);
  const [bulkPrintProgress, setBulkPrintProgress] = React.useState<string>("");

  // Confirmation popup state
  const [printConfirmData, setPrintConfirmData] = React.useState<{
    isOpen: boolean;
    orderId?: string;
    shopId?: string;
    isBulk: boolean;
    bulkOrderIds?: string[];
    printedOrderIds?: string[];
  }>({ isOpen: false, isBulk: false });

  // Pagination & rows per page state
  const [currentPage, setCurrentPage] = React.useState(1);
  const [rowsPerPage, setRowsPerPage] = React.useState<number | "custom">(50);
  const [customRowsInput, setCustomRowsInput] = React.useState("50");

  // Month & Date filters state
  const [selectedMonth, setSelectedMonth] = React.useState<string>("all");
  const [startDate, setStartDate] = React.useState<string>("");
  const [endDate, setEndDate] = React.useState<string>("");
  const [isFiltersExpanded, setIsFiltersExpanded] = React.useState(false);

  // Issues popup state
  const [issuesOrder, setIssuesOrder] = React.useState<Order | null>(null);
  const [newIssueTitle, setNewIssueTitle] = React.useState("");
  const [newIssueNote, setNewIssueNote] = React.useState("");

  // Logs popup state
  const [selectedOrderForLogs, setSelectedOrderForLogs] = React.useState<Order | null>(null);

  React.useEffect(() => {
    setSelectedOrderIds(new Set());
    setCurrentPage(1);
  }, [selectedShopId, selectedTab, searchQuery, selectedMonth, startDate, endDate, rowsPerPage, customRowsInput]);
  const fetchOrders = async (sync = false, silent = false) => {
    try {
      if (sync) {
        setIsSyncing(true);
      } else if (orders.length === 0 && !silent) {
        setIsLoading(true);
      }
      if (!silent) {
        setError(null);
      }
      const activeOnlyParam = silent ? "&active_only=true" : "";
      const res = await fetch(`https://ib.hsgglobalpteltd.workers.dev/api/tiktok/orders?sync=${sync}${activeOnlyParam}&_t=${Date.now()}`, {
        cache: "no-store"
      });
      if (!res.ok) {
        throw new Error(`Failed to load orders: ${res.statusText}`);
      }
      const data = await res.json() as any;
      if (data.success) {
        setShops(data.shops || []);
        if (silent) {
          setOrders(prev => {
            const updatedOrders = data.orders || [];
            
            // Compute sync changes
            const stats = computeOrderSyncStats(prev, updatedOrders);
            if (stats.newCount > 0 || stats.details.length > 0) {
              window.dispatchEvent(new CustomEvent("tiktok-bg-update", {
                detail: { count: stats.newCount, details: stats.details }
              }));
            }

            const prevMap = new Map(prev.map(o => [o.id, o]));
            updatedOrders.forEach((o: any) => {
              prevMap.set(o.id, o);
            });
            return Array.from(prevMap.values()).sort((a, b) => b.create_time - a.create_time);
          });
        } else {
          setOrders(data.orders || []);
        }
        if (sync && !silent) {
          showToast("Orders refreshed successfully");
        }
      } else {
        throw new Error(data.error || "Unknown error occurred");
      }
    } catch (err: any) {
      console.error("Error fetching orders:", err);
      if (!silent) {
        setError(err.message || "Failed to load orders dashboard data.");
      }
    } finally {
      if (!silent) {
        setIsLoading(false);
        setIsSyncing(false);
      }
    }
  };

  React.useEffect(() => {
    fetchOrders(false);

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchOrders(false, true);
      }
    }, 30000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchOrders(false, true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const handleRefreshClick = async () => {
    if (isLoading || isSyncing) return;
    window.dispatchEvent(new CustomEvent("tiktok-sync-start", { detail: { manual: true } }));
    
    let prevOrdersList: Order[] = [];
    setOrders(prev => {
      prevOrdersList = prev;
      return prev;
    });

    try {
      setIsSyncing(true);
      setError(null);

      // 1. Fetch from cache first (instant, no loading screen since orders already exist)
      const resCache = await fetch(`https://ib.hsgglobalpteltd.workers.dev/api/tiktok/orders?sync=false&_t=${Date.now()}`, {
        cache: "no-store"
      });
      if (resCache.ok) {
        const dataCache = await resCache.json() as any;
        if (dataCache.success) {
          setShops(dataCache.shops || []);
          setOrders(dataCache.orders || []);
          prevOrdersList = dataCache.orders || [];
        }
      }

      // 2. Perform live sync in the background (Quick Sync for the last 15 days only)
      const fifteenDaysAgo = Date.now() - 15 * 24 * 3600 * 1000;
      const resSync = await fetch(`https://ib.hsgglobalpteltd.workers.dev/api/tiktok/orders?sync=true&sync_start_date=${fifteenDaysAgo}&_t=${Date.now()}`, {
        cache: "no-store"
      });
      if (!resSync.ok) {
        throw new Error(`Failed to refresh orders: ${resSync.statusText}`);
      }
      const dataSync = await resSync.json() as any;
      if (dataSync.success) {
        setShops(dataSync.shops || []);
        setOrders(dataSync.orders || []);
        
        // Compute manual sync changes
        const stats = computeOrderSyncStats(prevOrdersList, dataSync.orders || []);
        
        showToast("Orders refreshed successfully");
        window.dispatchEvent(new CustomEvent("tiktok-sync-end", { 
          detail: { success: true, count: stats.newCount, details: stats.details, manual: true } 
        }));
        window.dispatchEvent(new CustomEvent("tiktok-manual-sync"));
      } else {
        throw new Error(dataSync.error || "Unknown error occurred");
      }
    } catch (err: any) {
      console.error("Refresh error:", err);
      setError(err.message || "Failed to refresh orders.");
      window.dispatchEvent(new CustomEvent("tiktok-sync-end", { 
        detail: { success: false, error: err.message, manual: true } 
      }));
    } finally {
      setIsSyncing(false);
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast(`Copied: ${text}`);
  };

  const handleCreateAWB = async (orderId: string, shopId: string) => {
    if (awbLoadingOrderId) return;
    window.dispatchEvent(new CustomEvent("tiktok-action", { detail: { action: "Create AWB", orderId } }));
    try {
      setAwbLoadingOrderId(orderId);
      const res = await fetch(`https://ib.hsgglobalpteltd.workers.dev/api/tiktok/orders/create-awb`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ order_id: orderId, shop_id: shopId, action_by: "Admin" })
      });

      if (!res.ok) {
        const errorData = await res.json() as any;
        throw new Error(errorData.error || `Failed to create AWB: ${res.statusText}`);
      }

      const data = await res.json() as any;
      if (data.success) {
        showToast(`AWB created successfully for order: ${orderId}`);
        window.dispatchEvent(new CustomEvent("tiktok-action", { detail: { action: "Create AWB Success", orderId } }));
        if (data.order) {
          setOrders(prev => prev.map(o => o.id === orderId ? { ...o, ...data.order } : o));
        } else {
          await fetchOrders(false);
        }
      } else {
        throw new Error(data.error || "Failed to create AWB");
      }
    } catch (err: any) {
      console.error("Create AWB error:", err);
      showToast(`Error: ${err.message || "Failed to create AWB"}`);
      window.dispatchEvent(new CustomEvent("tiktok-action", { detail: { action: "Create AWB Failure", orderId, error: err.message } }));
    } finally {
      setAwbLoadingOrderId(null);
    }
  };
  const handlePrintAWB = async (orderId: string, shopId: string, force = false) => {
    if (awbLoadingOrderId) return;
    const order = orders.find(o => o.id === orderId);
    if (order && order.awb_printed && !force) {
      setPrintConfirmData({
        isOpen: true,
        orderId,
        shopId,
        isBulk: false
      });
      return;
    }
    try {
      setAwbLoadingOrderId(orderId);
      const res = await fetch(`https://ib.hsgglobalpteltd.workers.dev/api/tiktok/orders/print-awb?order_id=${encodeURIComponent(orderId)}&shop_id=${encodeURIComponent(shopId)}&action_by=${encodeURIComponent(terminalName)}`, {
        method: "GET"
      });

      if (!res.ok) {
        const errorData = await res.json() as any;
        throw new Error(errorData.error || `Failed to print AWB: ${res.statusText}`);
      }

      const data = await res.json() as any;
      if (data.success && data.doc_url) {
        window.open(data.doc_url, "_blank");
        showToast("Opening AWB in a new tab...");
        // Update local state so AWB printed flag updates instantly
        setOrders(prev => prev.map(o => o.id === orderId ? { ...o, awb_printed: true } : o));
      } else {
        throw new Error(data.error || "No document URL returned");
      }
    } catch (err: any) {
      console.error("Print AWB error:", err);
      showToast(`Error: ${err.message || "Failed to print AWB"}`);
    } finally {
      setAwbLoadingOrderId(null);
    }
  };

  const handleBulkPrint = async (orderIds?: string[]) => {
    const idsToPrint = orderIds || Array.from(selectedOrderIds);
    if (idsToPrint.length === 0 || isBulkPrinting) return;
    setIsBulkPrinting(true);
    setBulkPrintProgress("Preparing...");

    const docUrls: string[] = [];
    const failedOrders: string[] = [];

    try {
      let count = 0;
      for (const orderId of idsToPrint) {
        count++;
        setBulkPrintProgress(`Fetching ${count}/${idsToPrint.length}...`);
        const order = orders.find(o => o.id === orderId);
        if (!order) continue;

        try {
          const res = await fetch(`https://ib.hsgglobalpteltd.workers.dev/api/tiktok/orders/print-awb?order_id=${encodeURIComponent(order.id)}&shop_id=${encodeURIComponent(order.shop_id)}&action_by=${encodeURIComponent(terminalName)}`, {
            method: "GET"
          });

          if (!res.ok) {
            const errorData = await res.json() as any;
            throw new Error(errorData.error || `HTTP error! status: ${res.status}`);
          }

          const data = await res.json() as any;
          if (data.success && data.doc_url) {
            docUrls.push(data.doc_url);
          } else {
            throw new Error(data.error || "No document URL returned");
          }
        } catch (err: any) {
          console.error(`Error fetching AWB for order ${orderId}:`, err);
          failedOrders.push(orderId);
        }
      }

      if (docUrls.length === 0) {
        throw new Error("Failed to retrieve AWB URLs for all selected orders.");
      }

      setBulkPrintProgress("Merging PDFs...");
      const mergedPdf = await PDFDocument.create();
      let mergedPageCount = 0;

      for (const docUrl of docUrls) {
        try {
          const proxyUrl = `https://ib.hsgglobalpteltd.workers.dev/api/proxy?url=${encodeURIComponent(docUrl)}`;
          const pdfRes = await fetch(proxyUrl);
          if (!pdfRes.ok) {
            throw new Error(`Failed to download PDF from proxy: ${pdfRes.status}`);
          }
          const pdfBytes = await pdfRes.arrayBuffer();
          const pdf = await PDFDocument.load(pdfBytes);
          const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
          copiedPages.forEach((page) => {
            mergedPdf.addPage(page);
            mergedPageCount++;
          });
        } catch (err) {
          console.error(`Failed to merge PDF from URL ${docUrl}:`, err);
        }
      }

      if (mergedPageCount === 0) {
        throw new Error("No PDF pages could be successfully merged.");
      }

      setBulkPrintProgress("Finalizing...");
      const mergedPdfBytes = await mergedPdf.save();
      const blob = new Blob([mergedPdfBytes as any], { type: "application/pdf" });
      const blobUrl = URL.createObjectURL(blob);
      
      window.open(blobUrl, "_blank");
      showToast("AWBs combined and opened in a new tab!");

      // Update local state so AWB printed flag updates instantly for successfully printed orders
      const printedSet = new Set(idsToPrint.filter(id => !failedOrders.includes(id)));
      setOrders(prev => prev.map(o => printedSet.has(o.id) ? { ...o, awb_printed: true } : o));

      setSelectedOrderIds(new Set());

      if (failedOrders.length > 0) {
        showToast(`Merged successfully. Failed orders: ${failedOrders.join(", ")}`);
      }
    } catch (err: any) {
      console.error("Bulk print error:", err);
      showToast(`Error: ${err.message || "Failed to merge and print AWBs"}`);
    } finally {
      setIsBulkPrinting(false);
      setBulkPrintProgress("");
    }
  };

  const triggerBulkPrint = () => {
    if (selectedOrderIds.size === 0) return;
    const selectedIdsArray = Array.from(selectedOrderIds);
    const printedIds = selectedIdsArray.filter(id => {
      const order = orders.find(o => o.id === id);
      return order && order.awb_printed;
    });

    if (printedIds.length > 0) {
      setPrintConfirmData({
        isOpen: true,
        isBulk: true,
        bulkOrderIds: selectedIdsArray,
        printedOrderIds: printedIds
      });
    } else {
      handleBulkPrint(selectedIdsArray);
    }
  };

  const formatDate = (unixSeconds: number) => {
    if (!unixSeconds) return "N/A";
    const date = new Date(unixSeconds * 1000);
    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  // Status Filters classification helper
  const matchesTab = (order: Order, tab: string) => {
    const actual = (order.actual_status || "").toUpperCase();
    const system = (order.system_status || "").toLowerCase();

    switch (tab) {
      case "all":
        return true;
      case "pending_pack":
        return actual === "AWAITING_COLLECTION" && system === "unpacked";
      case "pending_collection":
        return actual === "AWAITING_COLLECTION" && system === "packed";
      case "in_transit":
        return actual === "IN_TRANSIT";
      case "delivered":
        return actual === "DELIVERED" || actual === "COMPLETED";
      default:
        return true;
    }
  };

  // Pre-filter by Shop ID
  const shopFilteredOrders = orders.filter(
    (o) => selectedShopId === "all" || o.shop_id === selectedShopId
  );

  // Compute counts based on the current shop filter
  const counts = {
    all: shopFilteredOrders.length,
    pending_pack: shopFilteredOrders.filter((o) => matchesTab(o, "pending_pack")).length,
    pending_collection: shopFilteredOrders.filter((o) => matchesTab(o, "pending_collection")).length,
    in_transit: shopFilteredOrders.filter((o) => matchesTab(o, "in_transit")).length,
    delivered: shopFilteredOrders.filter((o) => matchesTab(o, "delivered")).length
  };

  // Get list of unique months present in orders for the dropdown
  const availableMonths = React.useMemo(() => {
    const months = new Set<string>();
    orders.forEach(o => {
      if (o.create_time) {
        const date = new Date(o.create_time * 1000);
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        months.add(`${yyyy}-${mm}`);
      }
    });
    return Array.from(months).sort((a, b) => b.localeCompare(a));
  }, [orders]);

  const formatMonthName = (yearMonth: string) => {
    const [yyyy, mm] = yearMonth.split('-');
    const date = new Date(parseInt(yyyy), parseInt(mm) - 1, 1);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  // Filter and Search
  const seenIds = new Set<string>();
  const processedOrders = shopFilteredOrders
    .filter((o) => matchesTab(o, selectedTab))
    .filter((o) => {
      if (seenIds.has(o.id)) return false;
      seenIds.add(o.id);

      // Search Query Filter
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchId = (o.id || "").toLowerCase().includes(q);
        const matchName = (o.recipient_name || "").toLowerCase().includes(q);
        const matchItem = o.items.some((item) =>
          (item.product_name || "").toLowerCase().includes(q) ||
          (item.seller_sku || "").toLowerCase().includes(q)
        );
        if (!matchId && matchName && !matchItem) {
          // If we had matchName wait, if search is matched by any, it's fine.
          // Let's use the original search matching:
        }
        if (!(matchId || matchName || matchItem)) return false;
      }

      // Month Filter
      if (selectedMonth !== "all") {
        const date = new Date(o.create_time * 1000);
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        if (`${yyyy}-${mm}` !== selectedMonth) return false;
      }

      // Date Range Filter
      if (startDate) {
        const startSec = new Date(startDate + "T00:00:00").getTime() / 1000;
        if (o.create_time < startSec) return false;
      }
      if (endDate) {
        const endSec = new Date(endDate + "T23:59:59").getTime() / 1000;
        if (o.create_time > endSec) return false;
      }

      return true;
    })
    .sort((a, b) => {
      return sortBy === "newest"
        ? b.create_time - a.create_time
        : a.create_time - b.create_time;
    });

  // Pagination Slice
  const limit = rowsPerPage === "custom" ? parseInt(customRowsInput) || 50 : rowsPerPage;
  const totalPages = Math.ceil(processedOrders.length / limit) || 1;
  const startIndex = (currentPage - 1) * limit;
  const endIndex = startIndex + limit;
  const paginatedOrders = processedOrders.slice(startIndex, endIndex);

  // Selection helpers (based on paginated current page list!)
  const printEligibleVisibleOrders = paginatedOrders.filter(order =>
    !["IN_TRANSIT", "SHIPPED", "DELIVERED", "COMPLETED", "CANCELLED", "FAILED"].includes((order.actual_status || "").toUpperCase())
  );

  const isAllSelected = printEligibleVisibleOrders.length > 0 && printEligibleVisibleOrders.every(o => selectedOrderIds.has(o.id));

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedOrderIds(prev => {
        const next = new Set(prev);
        printEligibleVisibleOrders.forEach(o => next.delete(o.id));
        return next;
      });
    } else {
      setSelectedOrderIds(prev => {
        const next = new Set(prev);
        printEligibleVisibleOrders.forEach(o => next.add(o.id));
        return next;
      });
    }
  };

  // Get status color badges classes
  const getStatusBadgeStyle = (status: string) => {
    const s = status.toUpperCase();
    if (s === "AWAITING_SHIPMENT" || s === "AWAITING_COLLECTION") {
      return { bg: "#FFF4E5", text: "#B76E00" };
    }
    if (s === "IN_TRANSIT" || s === "SHIPPED") {
      return { bg: "#E8F0FE", text: "#1A73E8" };
    }
    if (s === "DELIVERED" || s === "COMPLETED") {
      return { bg: "#E6F4EA", text: "#137333" };
    }
    if (s === "CANCELLED" || s === "FAILED") {
      return { bg: "#FCE8E6", text: "#C5221F" };
    }
    return { bg: "#F1F3F4", text: "#5F6368" };
  };

  const getDisplayStatus = (order: Order) => {
    const actual = (order.actual_status || "").toUpperCase();
    const system = (order.system_status || "").toLowerCase();

    if (actual === "AWAITING_COLLECTION" || actual === "AWAITING_SHIPMENT") {
      if (system === "packed") {
        return {
          text: "Pending Collection",
          bg: "#E8F0FE",
          color: "#1A73E8"
        };
      } else {
        return {
          text: "Pending Pack",
          bg: "#FFF4E5",
          color: "#B76E00"
        };
      }
    }

    const style = getStatusBadgeStyle(order.actual_status);
    return {
      text: order.actual_status.replace(/_/g, " "),
      bg: style.bg,
      color: style.text
    };
  };

  const handleUpdateIssues = async (orderId: string, updatedIssues: IssueItem[]) => {
    // Optimistic UI Update
    setOrders(prev => prev.map(o => {
      if (o.id === orderId) {
        const updated = { ...o, issues: updatedIssues };
        if (issuesOrder && issuesOrder.id === orderId) {
          setIssuesOrder(updated);
        }
        return updated;
      }
      return o;
    }));

    try {
      const res = await fetch(`https://ib.hsgglobalpteltd.workers.dev/api/tiktok/orders/update-issues`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          order_id: orderId,
          issues: updatedIssues
        })
      });
      if (!res.ok) {
        throw new Error("Failed to save issues to server");
      }
    } catch (err) {
      console.error(err);
      setToastMessage("Failed to save issues to database. Please check your connection.");
      setTimeout(() => setToastMessage(null), 3000);
    }
  };

  return (
    <div className="blank-route-page">
      <TopBar title="Orders" />

      {toastMessage && <div className="toast-msg">{toastMessage}</div>}

      <div className="flex flex-col w-full h-[calc(100vh-32px)] px-6 pb-6 pt-2 box-border overflow-hidden select-none">
        
        {/* Shops Tab Navigation */}
        <div className="flex items-center gap-1 border-b border-[#E0E2E6] pb-1 mb-4 overflow-x-auto whitespace-nowrap">
          <button
            onClick={() => setSelectedShopId("all")}
            className={`px-4 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-all duration-200 cursor-pointer outline-none ${
              selectedShopId === "all"
                ? "border-[#0B57D0] text-[#0B57D0] bg-[#EAF1FB]"
                : "border-transparent text-[#5F6368] hover:text-[#1F1F1F] hover:bg-[#F8F9FA]"
            }`}
          >
            All Shops
          </button>
          {shops.map((shop) => (
            <button
              key={shop.id}
              onClick={() => setSelectedShopId(shop.id)}
              className={`px-4 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-all duration-200 cursor-pointer outline-none ${
                selectedShopId === shop.id
                  ? "border-[#0B57D0] text-[#0B57D0] bg-[#EAF1FB]"
                  : "border-transparent text-[#5F6368] hover:text-[#1F1F1F] hover:bg-[#F8F9FA]"
              }`}
            >
              {shop.name}
            </button>
          ))}
        </div>

        {/* Dashboard Content Card */}
        <div className="flex-1 flex flex-col bg-white border border-[#E0E2E6] rounded-2xl shadow-sm overflow-hidden min-h-0">
          
          {/* Sub-Tabs Selector & Search controls (Row 1) */}
          <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center border-b border-[#E0E2E6] p-4 gap-4 bg-[#FDFDFD]">
            
            {/* Status Tabs */}
            <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap scrollbar-none">
              {[
                { key: "all", label: "All" },
                { key: "pending_pack", label: "Pending Pack" },
                { key: "pending_collection", label: "Pending Collection" },
                { key: "in_transit", label: "In Transit" },
                { key: "delivered", label: "Delivered" }
              ].map((tab) => {
                const count = counts[tab.key as keyof typeof counts];
                const isActive = selectedTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setSelectedTab(tab.key)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all cursor-pointer outline-none ${
                      isActive
                        ? "bg-[#EAF1FB] border-[#C2E7FF] text-[#0B57D0]"
                        : "bg-transparent border-transparent text-[#5F6368] hover:bg-[#F1F3F4] hover:text-[#1F1F1F]"
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                        isActive ? "bg-[#C2E7FF] text-[#0842A0]" : "bg-[#F1F3F4] text-[#5F6368]"
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Search, Filter Toggle & Refresh Actions */}
            <div className="flex items-center gap-3">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search order ID, SKU, customer..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full md:w-64 border border-[#E0E2E6] rounded-full px-4 py-1.5 text-xs text-[#1F1F1F] placeholder-[#5F6368] bg-[#FCFDFE] focus:outline-none focus:border-[#0B57D0] focus:ring-1 focus:ring-[#0B57D0]"
                />
              </div>

              {/* Filters Toggle Button */}
              <button
                onClick={() => setIsFiltersExpanded(!isFiltersExpanded)}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer outline-none ${
                  isFiltersExpanded || startDate || endDate || selectedMonth !== "all" || rowsPerPage !== 50 || sortBy !== "newest"
                    ? "bg-[#EAF1FB] border-[#C2E7FF] text-[#0B57D0]"
                    : "bg-transparent border-[#E0E2E6] text-[#5F6368] hover:bg-[#F1F3F4]"
                }`}
                style={{ height: "32px" }}
                title="Toggle advanced filters"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
                </svg>
                <span>Filters</span>
                {(startDate || endDate || selectedMonth !== "all" || rowsPerPage !== 50 || sortBy !== "newest") && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#0B57D0]" />
                )}
              </button>

              {/* Bulk Print Button */}
              {selectedOrderIds.size > 0 && (
                <button
                  onClick={triggerBulkPrint}
                  disabled={isBulkPrinting}
                  className="btn-primary"
                  style={{
                    padding: "8px 16px",
                    fontSize: "12px",
                    fontWeight: "600",
                    height: "32px",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    backgroundColor: "#0B57D0"
                  }}
                >
                  {isBulkPrinting ? (
                    <>
                      <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                      </svg>
                      {bulkPrintProgress}
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                      </svg>
                      Print AWB ({selectedOrderIds.size})
                    </>
                  )}
                </button>
              )}

              {/* Refresh Button */}
              <button
                onClick={handleRefreshClick}
                disabled={isLoading || isSyncing}
                className="btn-primary"
                style={{
                  padding: "8px 16px",
                  fontSize: "12px",
                  fontWeight: "600",
                  height: "32px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px"
                }}
              >
                {isSyncing ? (
                  <>
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                    Refreshing...
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                    </svg>
                    Refresh Orders
                  </>
                )}
              </button>
            </div>

          </div>

          {/* Advanced Filters (Row 2) - Collapsible */}
          {isFiltersExpanded && (
            <div className="flex flex-wrap items-center gap-6 px-4 py-3 bg-[#FCFCFD] border-b border-[#E0E2E6] animate-[fadeIn_0.15s_ease-out]">
              {/* Sort selector */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-[#5F6368] uppercase tracking-wider">Sort:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="border border-[#E0E2E6] rounded-full px-3 py-1 text-xs text-[#1F1F1F] bg-white focus:outline-none cursor-pointer"
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </select>
              </div>

              {/* Month Dropdown */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-[#5F6368] uppercase tracking-wider">Month:</span>
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="border border-[#E0E2E6] rounded-full px-3 py-1 text-xs text-[#1F1F1F] bg-white focus:outline-none cursor-pointer"
                >
                  <option value="all">All Months</option>
                  {availableMonths.map((m) => (
                    <option key={m} value={m}>
                      {formatMonthName(m)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Date Range Picker */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-[#5F6368] uppercase tracking-wider">Date:</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="border border-[#E0E2E6] rounded-full px-2.5 py-0.5 text-xs text-[#1F1F1F] bg-white focus:outline-none cursor-pointer"
                />
                <span className="text-xs text-[#5F6368] font-medium">-</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="border border-[#E0E2E6] rounded-full px-2.5 py-0.5 text-xs text-[#1F1F1F] bg-white focus:outline-none cursor-pointer"
                />
                {(startDate || endDate) && (
                  <button
                    onClick={() => {
                      setStartDate("");
                      setEndDate("");
                    }}
                    className="text-xs text-[#0B57D0] hover:text-[#0842A0] font-semibold cursor-pointer border-none bg-transparent outline-none"
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Rows limit */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-[#5F6368] uppercase tracking-wider">Limit:</span>
                <select
                  value={rowsPerPage}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "custom") {
                      setRowsPerPage("custom");
                    } else {
                      setRowsPerPage(parseInt(val));
                    }
                  }}
                  className="border border-[#E0E2E6] rounded-full px-3 py-1 text-xs text-[#1F1F1F] bg-white focus:outline-none cursor-pointer"
                >
                  <option value={50}>50 rows</option>
                  <option value={100}>100 rows</option>
                  <option value={300}>300 rows</option>
                  <option value={500}>500 rows</option>
                  <option value="custom">Custom</option>
                </select>
                {rowsPerPage === "custom" && (
                  <input
                    type="number"
                    min="1"
                    value={customRowsInput}
                    onChange={(e) => setCustomRowsInput(e.target.value)}
                    className="w-16 border border-[#E0E2E6] rounded-full px-2 py-0.5 text-xs text-center text-[#1F1F1F] bg-white focus:outline-none focus:border-[#0B57D0]"
                    placeholder="Num"
                  />
                )}
              </div>
            </div>
          )}

          {/* Orders Data List Card Body */}
          <div className="flex-1 overflow-y-scroll overflow-x-auto min-h-0">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center h-64 text-sm text-[#5F6368] italic">
                <svg className="w-8 h-8 animate-spin text-[#0B57D0] mb-2" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                Loading orders...
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center h-64 text-sm text-[#C5221F] font-medium p-6 text-center">
                <svg className="w-8 h-8 text-[#C5221F] mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                {error}
                <button onClick={handleRefreshClick} className="mt-4 btn-primary">Try Again</button>
              </div>
            ) : processedOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-sm text-[#5F6368] italic p-6">
                No orders match your filter criteria.
              </div>
            ) : (
                <table className="w-full border-collapse text-left text-xs table-fixed min-w-[1015px]">
                   <thead>
                    <tr className="border-b border-[#E0E2E6]">
                      <th className="p-3 w-[40px] text-center sticky top-0 bg-[#F8F9FA] z-10 shadow-[0_1px_0_0_#E0E2E6]">
                        <input
                          type="checkbox"
                          checked={isAllSelected}
                          onChange={toggleSelectAll}
                          className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                      </th>
                      <th className="p-3 font-semibold text-[#1F1F1F] w-[26%] sticky top-0 bg-[#F8F9FA] z-10 shadow-[0_1px_0_0_#E0E2E6]">Order ID & Date</th>
                      <th className="p-3 font-semibold text-[#1F1F1F] w-[15%] sticky top-0 bg-[#F8F9FA] z-10 shadow-[0_1px_0_0_#E0E2E6]">Shop</th>
                      <th className="p-3 font-semibold text-[#1F1F1F] w-[12%] sticky top-0 bg-[#F8F9FA] z-10 shadow-[0_1px_0_0_#E0E2E6]">Items</th>
                      <th className="p-3 font-semibold text-[#1F1F1F] w-[26%] sticky top-0 bg-[#F8F9FA] z-10 shadow-[0_1px_0_0_#E0E2E6]">Tracking</th>
                      <th className="p-3 font-semibold text-[#1F1F1F] w-[21%] sticky top-0 bg-[#F8F9FA] z-10 shadow-[0_1px_0_0_#E0E2E6]">Status</th>
                      <th className="p-3 font-semibold text-[#1F1F1F] w-[265px] max-w-[265px] sticky top-0 bg-[#F8F9FA] z-10 shadow-[0_1px_0_0_#E0E2E6]">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                     {paginatedOrders.map((order) => {
                      const displayStatus = getDisplayStatus(order);
                      const isSelected = selectedOrderIds.has(order.id);
                      const isEligible = !["IN_TRANSIT", "SHIPPED", "DELIVERED", "COMPLETED", "CANCELLED", "FAILED"].includes((order.actual_status || "").toUpperCase());
                      return (
                        <tr key={`${order.shop_id}_${order.id}`} className="border-b border-[#F1F3F4] hover:bg-slate-50 transition duration-150">
                          <td className="p-3 text-center align-top">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={!isEligible}
                              onChange={() => {
                                setSelectedOrderIds(prev => {
                                  const next = new Set(prev);
                                  if (next.has(order.id)) {
                                    next.delete(order.id);
                                  } else {
                                    next.add(order.id);
                                  }
                                  return next;
                                });
                              }}
                              className={`w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer ${!isEligible ? "opacity-30 cursor-not-allowed" : ""}`}
                            />
                          </td>
                          {/* ID & Date */}
                          <td className="p-3 align-top">
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className="font-mono font-semibold text-[#1F1F1F] text-xs truncate max-w-[140px]" title={order.id}>
                                {order.id}
                              </span>
                              <button
                                onClick={() => copyToClipboard(order.id)}
                                className="text-[#5F6368] hover:text-[#1F1F1F] cursor-pointer outline-none"
                                title="Copy order ID"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                </svg>
                              </button>
                            </div>
                            <span className="text-[10px] text-[#5F6368] block">
                              {formatDate(order.create_time)}
                            </span>
                          </td>

                          {/* Shop */}
                          <td className="p-3 align-top font-medium text-[#1F1F1F] truncate" title={order.shop_name}>
                            {order.shop_name}
                          </td>

                          {/* Items badge toggle */}
                          <td className="p-3 align-top">
                            <button
                              onClick={() => setSelectedOrderItems(order)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#E0E2E6] hover:bg-[#EAF1FB] hover:border-[#C2E7FF] hover:text-[#0B57D0] transition duration-150 cursor-pointer text-xs font-semibold text-[#5F6368] outline-none"
                            >
                              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                              </svg>
                              <span>
                                {order.items.reduce((s, i) => s + i.quantity, 0)} {order.items.reduce((s, i) => s + i.quantity, 0) === 1 ? "Item" : "Items"}
                              </span>
                            </button>
                          </td>

                          {/* Tracking */}
                          <td className="p-3 align-top">
                            <div className="flex flex-col gap-0.5">
                              <span className="font-medium text-[#1F1F1F] truncate block max-w-[160px]" title={order.shipping_provider || "N/A"}>
                                {order.shipping_provider || "N/A"}
                              </span>
                              {order.tracking_number && order.tracking_number !== "N/A" && order.tracking_number.trim() !== "" ? (
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono text-[#5F6368] text-[10px] truncate max-w-[120px]" title={order.tracking_number}>
                                    {order.tracking_number}
                                  </span>
                                  <button
                                    onClick={() => copyToClipboard(order.tracking_number)}
                                    className="text-[#5F6368] hover:text-[#1F1F1F] cursor-pointer outline-none flex-shrink-0"
                                    title="Copy tracking number"
                                  >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                    </svg>
                                  </button>
                                </div>
                              ) : (
                                <span className="text-[10px] text-[#9AA0A6] italic">No tracking yet</span>
                              )}
                            </div>
                          </td>

                           {/* Status */}
                          <td className="p-3 align-top">
                            <span
                              className="px-2.5 py-1 rounded-full text-[10px] font-bold inline-block text-center uppercase"
                              style={{ backgroundColor: displayStatus.bg, color: displayStatus.color }}
                            >
                              {displayStatus.text}
                            </span>
                          </td>

                          {/* Action */}
                          <td className="p-3 align-top">
                            <div className="flex items-center gap-2">
                              {!["IN_TRANSIT", "SHIPPED", "DELIVERED", "COMPLETED", "CANCELLED", "FAILED"].includes((order.actual_status || "").toUpperCase()) && (
                                <>
                                  {!(order.tracking_number && order.tracking_number !== "N/A" && order.tracking_number.trim() !== "") ? (
                                    <button
                                      onClick={() => handleCreateAWB(order.id, order.shop_id)}
                                      disabled={awbLoadingOrderId !== null}
                                      className="btn-primary"
                                      style={{
                                        padding: "6px 12px",
                                        fontSize: "11px",
                                        fontWeight: "600",
                                        height: "28px",
                                        borderRadius: "6px",
                                        whiteSpace: "nowrap"
                                      }}
                                    >
                                      {awbLoadingOrderId === order.id ? "Creating..." : "Create AWB"}
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => handlePrintAWB(order.id, order.shop_id)}
                                      disabled={awbLoadingOrderId !== null}
                                      className="btn-secondary"
                                      style={{
                                        padding: "6px 12px",
                                        fontSize: "11px",
                                        fontWeight: "600",
                                        height: "28px",
                                        borderRadius: "6px",
                                        whiteSpace: "nowrap"
                                      }}
                                    >
                                      {awbLoadingOrderId === order.id ? "Printing..." : order.awb_printed ? "Print Again" : "Print AWB"}
                                    </button>
                                  )}
                                </>
                              )}

                              {/* Issue Button */}
                              {(() => {
                                const issues = order.issues || [];
                                const hasPending = issues.some(iss => !iss.done);
                                return (
                                  <button
                                    onClick={() => {
                                      setIssuesOrder(order);
                                      setNewIssueTitle("");
                                      setNewIssueNote("");
                                    }}
                                    className={`px-2.5 py-1 text-[11px] font-bold rounded-lg border transition duration-150 cursor-pointer outline-none flex items-center gap-1 h-[28px] ${
                                      hasPending
                                        ? "bg-[#FFEAD2] border-[#FFB74D] text-[#E65100] hover:bg-[#FFD19A]"
                                        : "bg-white border-[#E0E2E6] text-[#0b57d0] hover:bg-[#F8F9FA]"
                                    }`}
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                    <span>Issue</span>
                                    {issues.length > 0 && (
                                      <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold leading-none ${
                                        hasPending ? "bg-[#E65100] text-white" : "bg-[#5F6368] text-white"
                                      }`}>
                                        {issues.length}
                                      </span>
                                    )}
                                  </button>
                                );
                              })()}

                               {/* Log Button */}
                               <button
                                 onClick={() => setSelectedOrderForLogs(order)}
                                 className="px-2.5 py-1 text-[11px] font-bold rounded-lg border border-[#E0E2E6] bg-white text-[#0b57d0] hover:bg-[#F8F9FA] transition duration-150 cursor-pointer outline-none flex items-center gap-1 h-[28px]"
                                 title="View order logs"
                                >
                                 <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                   <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                 </svg>
                                 <span>Log</span>
                               </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
            )}
          </div>

          {/* Pagination Footer */}
          <div className="flex items-center justify-between px-6 py-3 border-t border-[#E0E2E6] bg-[#F8F9FA] select-none text-xs text-[#5F6368] font-medium">
            <div>
              Showing {processedOrders.length > 0 ? startIndex + 1 : 0} to {Math.min(endIndex, processedOrders.length)} of {processedOrders.length} orders
            </div>
            
            <div className="flex items-center gap-1.5">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                className={`px-3 py-1.5 rounded-lg border text-[11px] font-semibold transition duration-150 outline-none ${
                  currentPage === 1
                    ? "bg-[#F1F3F4] text-[#9AA0A6] border-transparent cursor-not-allowed"
                    : "bg-white text-[#1F1F1F] border-[#E0E2E6] hover:bg-[#F8F9FA] cursor-pointer"
                }`}
              >
                Previous
              </button>
              
              <div className="flex items-center gap-0.5">
                {Array.from({ length: totalPages }).map((_, idx) => {
                  const pageNum = idx + 1;
                  if (totalPages > 6) {
                    if (pageNum !== 1 && pageNum !== totalPages && Math.abs(pageNum - currentPage) > 1) {
                      if (pageNum === 2 && currentPage > 3) {
                        return <span key="ellipsis-start" className="px-1 text-[#9AA0A6]">...</span>;
                      }
                      if (pageNum === totalPages - 1 && currentPage < totalPages - 2) {
                        return <span key="ellipsis-end" className="px-1 text-[#9AA0A6]">...</span>;
                      }
                      return null;
                    }
                  }
                  
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`w-7 h-7 rounded-lg text-[11px] font-bold transition duration-150 outline-none cursor-pointer ${
                        currentPage === pageNum
                          ? "bg-[#0B57D0] text-white border-transparent"
                          : "bg-transparent text-[#5F6368] border-transparent hover:bg-[#EAF1FB] hover:text-[#0B57D0]"
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>

              <button
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                className={`px-3 py-1.5 rounded-lg border text-[11px] font-semibold transition duration-150 outline-none ${
                  currentPage === totalPages
                    ? "bg-[#F1F3F4] text-[#9AA0A6] border-transparent cursor-not-allowed"
                    : "bg-white text-[#1F1F1F] border-[#E0E2E6] hover:bg-[#F8F9FA] cursor-pointer"
                }`}
              >
                Next
              </button>
            </div>
          </div>

      </div>

      {/* Items Popover Card Modal */}
      {selectedOrderItems && (
        <div className="fixed inset-0 bg-[#00000040] backdrop-blur-[2px] flex items-center justify-center z-[20000] p-4 select-none">
          <div className="bg-white border border-[#E0E2E6] rounded-2xl shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col overflow-hidden animate-[fadeIn_0.15s_ease-out]">
            
            {/* Header */}
            <div className="flex justify-between items-center border-b border-[#E0E2E6] p-4 bg-[#F8F9FA]">
              <div>
                <h3 className="text-sm font-bold text-[#1F1F1F] mb-0.5">Order Items</h3>
                <span className="text-[10px] text-[#5F6368] font-mono">ID: {selectedOrderItems.id}</span>
              </div>
              <button
                onClick={() => setSelectedOrderItems(null)}
                className="p-1.5 hover:bg-[#E0E2E6] rounded-full text-[#5F6368] hover:text-[#1F1F1F] transition duration-150 cursor-pointer outline-none"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Item List */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
              {selectedOrderItems.items.map((item, idx) => (
                <div key={idx} className="flex items-start gap-3 border-b border-[#F1F3F4] pb-3 last:border-b-0 last:pb-0">
                  {item.sku_image ? (
                    <img
                      src={item.sku_image}
                      alt="SKU image"
                      className="w-12 h-12 rounded border border-[#E0E2E6] object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded border border-[#E0E2E6] bg-[#F1F3F4] flex items-center justify-center text-xs text-[#5F6368] font-bold flex-shrink-0">
                      N/A
                    </div>
                  )}
                  <div className="min-w-0 flex-1 flex flex-col justify-between min-h-[48px]">
                    <div>
                      <span className="text-xs font-bold text-[#1F1F1F] block leading-tight mb-1">
                        {item.sku_name}
                      </span>
                      <span className="text-[10px] text-[#5F6368] font-mono block">
                        SKU: {item.seller_sku}
                      </span>
                    </div>
                    <div className="flex justify-end mt-1">
                      <span className="text-xs font-bold text-[#1F1F1F]">
                        Qty: {item.quantity} × {item.currency} {parseFloat(item.sale_price).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="border-t border-[#E0E2E6] p-4 bg-[#F8F9FA] flex justify-between items-center">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-[#5F6368]">
                  Total: <span className="font-bold text-[#1F1F1F]">{selectedOrderItems.items.reduce((s, i) => s + i.quantity, 0)} Items</span>
                </span>
                <span className="text-xs text-[#5F6368]">
                  Total Amount: <span className="font-bold text-[#1F1F1F]">{selectedOrderItems.currency} {parseFloat(selectedOrderItems.total_amount).toFixed(2)}</span>
                </span>
              </div>
              <button
                onClick={() => setSelectedOrderItems(null)}
                className="btn-primary px-4 py-2"
              >
                Close
              </button>
            </div>

          </div>
        </div>
      )}

      {printConfirmData.isOpen && (
        <div className="fixed inset-0 bg-[#00000040] backdrop-blur-[2px] flex items-center justify-center z-[20000] p-4 select-none">
          <div className="bg-white border border-[#E0E2E6] rounded-2xl shadow-xl max-w-md w-full flex flex-col overflow-hidden animate-[fadeIn_0.15s_ease-out] p-6">
            
            <div className="flex items-start gap-4 mb-4">
              <div className="p-3 bg-[#FEF7EC] rounded-full text-[#B76E00] flex-shrink-0">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-bold text-[#1F1F1F] mb-1">
                  {printConfirmData.isBulk ? "AWBs Already Printed" : "AWB Already Printed"}
                </h3>
                <div className="text-xs text-[#5F6368] leading-relaxed">
                  {printConfirmData.isBulk ? (
                    <div>
                      Some of the selected orders have already had their AWBs printed before.
                      <span className="block mt-2 font-semibold text-[#1F1F1F]">
                        Already printed ({printConfirmData.printedOrderIds?.length}):
                      </span>
                      <span className="block mt-1 font-mono text-[10px] text-gray-500 max-h-[80px] overflow-y-auto border border-gray-100 p-2 rounded bg-slate-50">
                        {printConfirmData.printedOrderIds?.join(", ")}
                      </span>
                    </div>
                  ) : (
                    <p>The AWB for order <strong>{printConfirmData.orderId}</strong> has already been printed. Do you want to print it again?</p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setPrintConfirmData({ isOpen: false, isBulk: false })}
                className="btn-secondary px-4 py-2"
                style={{
                  padding: "8px 16px",
                  fontSize: "12px",
                  fontWeight: "600",
                  height: "36px",
                  borderRadius: "8px",
                  cursor: "pointer"
                }}
              >
                Cancel
              </button>

              {printConfirmData.isBulk ? (
                <>
                  <button
                    onClick={() => {
                      const nonPrintedIds = (printConfirmData.bulkOrderIds || []).filter(
                        id => !(printConfirmData.printedOrderIds || []).includes(id)
                      );
                      setPrintConfirmData({ isOpen: false, isBulk: false });
                      handleBulkPrint(nonPrintedIds);
                    }}
                    className="btn-secondary px-4 py-2"
                    style={{
                      padding: "8px 16px",
                      fontSize: "12px",
                      fontWeight: "600",
                      height: "36px",
                      borderRadius: "8px",
                      cursor: "pointer"
                    }}
                  >
                    Skip Printed
                  </button>
                  <button
                    onClick={() => {
                      setPrintConfirmData({ isOpen: false, isBulk: false });
                      handleBulkPrint(printConfirmData.bulkOrderIds);
                    }}
                    className="btn-primary px-4 py-2"
                    style={{
                      padding: "8px 16px",
                      fontSize: "12px",
                      fontWeight: "600",
                      height: "36px",
                      borderRadius: "8px",
                      cursor: "pointer",
                      backgroundColor: "#0B57D0"
                    }}
                  >
                    Print All
                  </button>
                </>
              ) : (
                <button
                  onClick={() => {
                    const orderId = printConfirmData.orderId!;
                    const shopId = printConfirmData.shopId!;
                    setPrintConfirmData({ isOpen: false, isBulk: false });
                    handlePrintAWB(orderId, shopId, true);
                  }}
                  className="btn-primary px-4 py-2"
                  style={{
                    padding: "8px 16px",
                    fontSize: "12px",
                    fontWeight: "600",
                    height: "36px",
                    borderRadius: "8px",
                    cursor: "pointer",
                    backgroundColor: "#0B57D0"
                  }}
                >
                  Print Again
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Issues Management Modal */}
      {issuesOrder && (
        <div className="fixed inset-0 bg-[#00000040] backdrop-blur-[2px] flex items-center justify-center z-[20000] p-4 select-none">
          <div className="bg-white border border-[#E0E2E6] rounded-2xl shadow-xl max-w-xl w-full max-h-[85vh] flex flex-col overflow-hidden animate-[fadeIn_0.15s_ease-out]">
            
            {/* Header */}
            <div className="flex justify-between items-center border-b border-[#E0E2E6] p-4 bg-[#F8F9FA]">
              <div>
                <h3 className="text-sm font-bold text-[#1F1F1F] mb-0.5 flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-[#5F6368]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  Order Issues & Tasks
                </h3>
                <span className="text-[10px] text-[#5F6368] font-mono">Order ID: {issuesOrder.id}</span>
              </div>
              <button
                onClick={() => setIssuesOrder(null)}
                className="p-1.5 hover:bg-[#E0E2E6] rounded-full text-[#5F6368] hover:text-[#1F1F1F] transition duration-150 cursor-pointer outline-none border-none bg-transparent"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
              
              {/* Add New Issue Form */}
              <div className="bg-[#F8F9FA] border border-[#E0E2E6] rounded-xl p-3 flex flex-col gap-2.5">
                <span className="text-[11px] font-bold text-[#1F1F1F] uppercase tracking-wider">Create New Task / Issue</span>
                
                <div>
                  <input
                    type="text"
                    placeholder="Task Title (e.g. Damaged packaging, Missing item)"
                    value={newIssueTitle}
                    onChange={(e) => setNewIssueTitle(e.target.value)}
                    className="w-full border border-[#E0E2E6] rounded-lg px-3 py-1.5 text-xs text-[#1F1F1F] placeholder-[#5F6368] bg-white focus:outline-none focus:border-[#0B57D0]"
                    maxLength={100}
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <textarea
                    placeholder="Describe details or remarks here (maximum 300 words)..."
                    value={newIssueNote}
                    onChange={(e) => setNewIssueNote(e.target.value)}
                    className="w-full border border-[#E0E2E6] rounded-lg px-3 py-1.5 text-xs text-[#1F1F1F] placeholder-[#5F6368] bg-white focus:outline-none focus:border-[#0B57D0] h-20 resize-none"
                  />
                  <div className="flex justify-between items-center px-1">
                    {(() => {
                      const clean = newIssueNote.trim();
                      const count = clean === "" ? 0 : clean.split(/\s+/).length;
                      const isOver = count > 300;
                      return (
                        <>
                          <span className={`text-[10px] font-medium ${isOver ? "text-[#C5221F]" : "text-[#5F6368]"}`}>
                            Word count: {count} / 300 {isOver && "(Limit exceeded)"}
                          </span>
                          <span className="text-[10px] text-[#5F6368]">
                            {(issuesOrder.issues || []).length} / 10 issues max
                          </span>
                        </>
                      );
                    })()}
                  </div>
                </div>

                <button
                  disabled={
                    newIssueTitle.trim() === "" ||
                    (newIssueNote.trim() !== "" && newIssueNote.trim().split(/\s+/).length > 300) ||
                    (issuesOrder.issues || []).length >= 10
                  }
                  onClick={async () => {
                    const currentIssues = issuesOrder.issues || [];
                    const newIssue: IssueItem = {
                      id: Math.random().toString(36).substring(7) + "_" + Date.now(),
                      title: newIssueTitle.trim(),
                      note: newIssueNote.trim(),
                      done: false
                    };
                    const updated = [...currentIssues, newIssue];
                    await handleUpdateIssues(issuesOrder.id, updated);
                    setNewIssueTitle("");
                    setNewIssueNote("");
                  }}
                  className={`py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 border border-transparent transition duration-150 outline-none cursor-pointer ${
                    newIssueTitle.trim() === "" ||
                    (newIssueNote.trim() !== "" && newIssueNote.trim().split(/\s+/).length > 300) ||
                    (issuesOrder.issues || []).length >= 10
                      ? "bg-[#F1F3F4] text-[#9AA0A6] cursor-not-allowed"
                      : "bg-[#0B57D0] text-white hover:bg-[#0842A0]"
                  }`}
                  style={{ height: "32px" }}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Add Task / Issue
                </button>
              </div>

              {/* Existing Issues List */}
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider px-1">Issues & Tasks List</span>
                
                {(!issuesOrder.issues || issuesOrder.issues.length === 0) ? (
                  <div className="text-center text-xs text-[#5F6368] italic py-8 border border-dashed border-[#E0E2E6] rounded-xl">
                    No active tasks or issues recorded for this order.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {issuesOrder.issues.map((issue) => (
                      <div
                        key={issue.id}
                        className={`border rounded-xl p-3 flex gap-3 items-start transition duration-150 ${
                          issue.done
                            ? "bg-[#F8F9FA] border-[#E0E2E6] opacity-60"
                            : "bg-[#FFFDF4] border-[#FFE0B2]"
                        }`}
                      >
                        {/* Done status toggle */}
                        <div className="pt-0.5">
                          <input
                            type="checkbox"
                            checked={issue.done}
                            onChange={async () => {
                              const updated = issuesOrder.issues!.map(x => {
                                if (x.id === issue.id) {
                                  return { ...x, done: !x.done };
                                }
                                return x;
                              });
                              await handleUpdateIssues(issuesOrder.id, updated);
                            }}
                            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                            title="Toggle Done/Not Done status"
                          />
                        </div>

                        {/* Title & Notes details */}
                        <div className="flex-1 min-w-0">
                          <h4 className={`text-xs font-bold text-[#1F1F1F] mb-0.5 break-words ${issue.done ? "line-through text-[#5F6368]" : ""}`}>
                            {issue.title}
                          </h4>
                          {issue.note && (
                            <p className="text-[11px] text-[#5F6368] leading-normal break-words whitespace-pre-wrap mb-0">
                              {issue.note}
                            </p>
                          )}
                        </div>

                        {/* Delete Button */}
                        <button
                          onClick={async () => {
                            const updated = issuesOrder.issues!.filter(x => x.id !== issue.id);
                            await handleUpdateIssues(issuesOrder.id, updated);
                          }}
                          className="p-1 hover:bg-[#F1F3F4] rounded text-[#5F6368] hover:text-[#C5221F] transition duration-150 cursor-pointer outline-none border-none bg-transparent"
                          title="Delete issue"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>

            {/* Footer */}
            <div className="border-t border-[#E0E2E6] p-3.5 bg-[#F8F9FA] flex justify-end">
              <button
                onClick={() => setIssuesOrder(null)}
                className="btn-secondary px-4 py-1.5"
                style={{
                  padding: "8px 16px",
                  fontSize: "12px",
                  fontWeight: "600",
                  height: "36px",
                  borderRadius: "8px",
                  cursor: "pointer"
                }}
              >
                Close
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Activity Logs Modal */}
      {selectedOrderForLogs && (
        <div className="fixed inset-0 bg-[#00000040] backdrop-blur-[2px] flex items-center justify-center z-[20000] p-4 select-none">
          <div className="bg-white border border-[#E0E2E6] rounded-2xl shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col overflow-hidden animate-[fadeIn_0.15s_ease-out]">
            
            {/* Header */}
            <div className="flex justify-between items-center border-b border-[#E0E2E6] p-4 bg-[#F8F9FA]">
              <div>
                <h3 className="text-sm font-bold text-[#1F1F1F] mb-0.5 flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-[#5F6368]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                  </svg>
                  Order Activity Logs
                </h3>
                <span className="text-[10px] text-[#5F6368] font-mono">Order ID: {selectedOrderForLogs.id}</span>
              </div>
              <button
                onClick={() => setSelectedOrderForLogs(null)}
                className="p-1.5 hover:bg-[#E0E2E6] rounded-full text-[#5F6368] hover:text-[#1F1F1F] transition duration-150 cursor-pointer outline-none border-none bg-transparent"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5">
              {(() => {
                // Compile logs chronologically
                const logsList = [...(selectedOrderForLogs.logs || [])];
                
                // Fallback for packing proof photo
                const hasPackingLog = logsList.some((l: any) => {
                  const act = (l.action || "").toLowerCase();
                  return act.includes("before pack") || act.includes("packing proof");
                });
                if (selectedOrderForLogs.before_pack_photo && !hasPackingLog) {
                  logsList.push({
                    action: "Packing Proof",
                    actionBy: selectedOrderForLogs.packed_by || "Packer",
                    remark: "Scanned items in bucket before packing",
                    timestamp: selectedOrderForLogs.packed_at ? (selectedOrderForLogs.packed_at - 60000) : (selectedOrderForLogs.create_time * 1000 + 120000),
                    photoUrl: selectedOrderForLogs.before_pack_photo
                  });
                }

                // Fallback for shipping proof photo (packed_at)
                const hasPackLog = logsList.some((l: any) => {
                  const act = (l.action || "").toLowerCase();
                  return act === "pack" || act === "packed" || act === "shipping proof" || act === "shipping proof (repacked)";
                });
                if (selectedOrderForLogs.packed_at && !hasPackLog) {
                  logsList.push({
                    action: "Shipping Proof",
                    actionBy: selectedOrderForLogs.packed_by || "Packer",
                    remark: "Order packed successfully",
                    timestamp: selectedOrderForLogs.packed_at,
                    photoUrl: selectedOrderForLogs.proof_photo || ""
                  });
                }

                // Fallback for In Transit
                const hasTransitLog = logsList.some((l: any) => {
                  const act = (l.action || "").toLowerCase();
                  return act.includes("transit") || act.includes("shipped") || act.includes("handover") || act.includes("collect");
                });
                if (selectedOrderForLogs.transit_at && !hasTransitLog) {
                  logsList.push({
                    action: "In Transit",
                    actionBy: "System",
                    remark: "Status updated to Transit (via TikTok Sync)",
                    timestamp: selectedOrderForLogs.transit_at
                  });
                }

                // Fallback for Delivered
                const hasDeliveredLog = logsList.some((l: any) => {
                  const act = (l.action || "").toLowerCase();
                  return act.includes("delivered") || act.includes("completed");
                });
                if (selectedOrderForLogs.delivered_at && !hasDeliveredLog) {
                  logsList.push({
                    action: "Delivered",
                    actionBy: "System",
                    remark: "Status updated to Delivered (via TikTok Sync)",
                    timestamp: selectedOrderForLogs.delivered_at
                  });
                }
                
                // Sort descending (newest first)
                logsList.sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));

                // Helper to format date-time
                const formatDateTime = (ts: number) => {
                  if (!ts) return "N/A";
                  const date = new Date(ts);
                  const yyyy = date.getFullYear();
                  const mm = String(date.getMonth() + 1).padStart(2, '0');
                  const dd = String(date.getDate()).padStart(2, '0');
                  const hh = String(date.getHours()).padStart(2, '0');
                  const min = String(date.getMinutes()).padStart(2, '0');
                  const ss = String(date.getSeconds()).padStart(2, '0');
                  return `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`;
                };

                return (
                  <div className="flex flex-col gap-4">
                    <div>
                      <h4 className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider mb-4">Timeline Events</h4>
                      {logsList.length === 0 ? (
                        <div className="text-center text-xs text-[#5F6368] italic py-8 border border-dashed border-[#E0E2E6] rounded-xl">
                          No activity logs recorded for this order.
                        </div>
                      ) : (
                        <div className="relative border-l border-[#E0E2E6] ml-2.5 pl-6 flex flex-col gap-6">
                          {logsList.map((log: any, idx: number) => {
                            const actionLower = (log.action || "").toLowerCase();
                            
                            const isAWBAction = ["create awb", "print awb", "reprint awb"].includes(actionLower);
                            const isPackingProof = ["before pack", "packing proof"].includes(actionLower);
                            const isShippingProof = ["pack", "repack", "shipping proof", "shipping proof (repacked)"].includes(actionLower);
                            const isTransit = ["collect", "collected", "handover", "transit", "in transit"].includes(actionLower);
                            const isDelivered = ["delivered", "completed"].includes(actionLower);
                            const isSync = actionLower.includes("sync");

                            let dotColor = "bg-gray-400";
                            if (isAWBAction) dotColor = "bg-[#0b57d0]"; // Blue
                            else if (isPackingProof) dotColor = "bg-[#137333]"; // Green
                            else if (isShippingProof) dotColor = "bg-[#007a87]"; // Teal/Cyan
                            else if (isTransit) dotColor = "bg-[#b76e00]"; // Orange
                            else if (isDelivered) dotColor = "bg-[#681da8]"; // Purple
                            else if (isSync) dotColor = "bg-[#5f6368]"; // Slate/Gray

                            let actionLabel = log.action || "";
                            if (actionLabel.toLowerCase() === "before pack") actionLabel = "Packing Proof";
                            if (actionLabel.toLowerCase() === "pack" || actionLabel.toLowerCase() === "repack") actionLabel = "Shipping Proof";

                            return (
                              <div key={idx} className="relative group">
                                <span className={`absolute -left-[32px] top-1 w-3.5 h-3.5 rounded-full border-2 border-white ring-4 ring-transparent transition duration-150 ${dotColor}`} />
                                <div className="flex flex-col gap-1.5">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-bold text-[#1f1f1f]">{actionLabel}</span>
                                    <span className="text-[10px] text-[#5f6368] font-semibold bg-[#f1f3f4] px-2 py-0.5 rounded-full select-none">
                                      by {log.actionBy || "System"}
                                    </span>
                                  </div>
                                  {log.remark && (
                                    <span className="text-[11px] text-[#5F6368] leading-relaxed break-words font-medium">
                                      {log.remark}
                                    </span>
                                  )}
                                  {log.photoUrl && (
                                    <div className="mt-2 border border-[#E0E2E6] rounded-xl bg-[#F8F9FA] p-2.5 max-w-[200px] flex flex-col gap-1.5 items-center">
                                      <span className="text-[9px] font-bold text-[#5f6368] uppercase tracking-wide select-none">Proof Attachment</span>
                                      <a href={log.photoUrl} target="_blank" rel="noreferrer" className="relative group overflow-hidden rounded-lg border border-[#E0E2E6] aspect-square w-full flex items-center justify-center bg-white cursor-pointer">
                                        <img src={log.photoUrl} alt="Log Attachment" className="w-full h-full object-cover group-hover:scale-105 transition duration-150" />
                                      </a>
                                    </div>
                                  )}
                                  <span className="text-[10px] text-[#9aa0a6] font-medium font-mono select-none mt-1">
                                    {formatDateTime(log.timestamp)}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Footer */}
            <div className="border-t border-[#E0E2E6] p-3.5 bg-[#F8F9FA] flex justify-end">
              <button
                onClick={() => setSelectedOrderForLogs(null)}
                className="btn-secondary px-4 py-1.5"
                style={{
                  padding: "8px 16px",
                  fontSize: "12px",
                  fontWeight: "600",
                  height: "36px",
                  borderRadius: "8px",
                  cursor: "pointer"
                }}
              >
                Close
              </button>
            </div>

          </div>
        </div>
      )}

      </div>
    </div>
  );
}
