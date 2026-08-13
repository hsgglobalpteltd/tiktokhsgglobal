"use client";

import React, { useState, useEffect, useMemo } from "react";
import { TopBar } from "../../components/TopBar";

interface OrderItem {
  id: string;
  product_name: string;
  sku_name: string;
  quantity: number;
}

interface Order {
  id: string;
  actual_status: string;
  system_status: string;
  tracking_number: string;
  shipping_provider: string;
  recipient_name: string;
  shop_id: string;
  items: OrderItem[];
  packed_at?: number;
  packed_by?: string;
  logs?: string;
}

interface HandoverBatch {
  id: string;
  timestamp: number;
  driver_name: string;
  vehicle_plate: string;
  signature_url: string;
  operator_name: string;
  courier: string;
  type: "Manual" | "Auto-Detected";
  orders: { id: string; tracking_number: string; recipient_name: string }[];
}

export default function HandoverParcelPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // History Filter states
  const [historySearch, setHistorySearch] = useState("");
  
  // Default date range: 15 days ago to today
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 15);
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState<string>(() => {
    return new Date().toISOString().split("T")[0];
  });

  const [filterCourier, setFilterCourier] = useState<string>("");
  const [filterType, setFilterType] = useState<string>("");

  // Pagination states
  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 10;

  // Selected details
  const [selectedBatch, setSelectedBatch] = useState<HandoverBatch | null>(null);
  const [selectedSignatureUrl, setSelectedSignatureUrl] = useState<string | null>(null);

  // "Create Handover" modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [modalCourier, setModalCourier] = useState("");
  const [modalMode, setModalMode] = useState<"Pickup" | "Drop-Off">("Pickup");
  const [manifestOrders, setManifestOrders] = useState<Order[]>([]);
  const [forceAddInput, setForceAddInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDownloadingAWB, setIsDownloadingAWB] = useState(false);
  const [terminalName, setTerminalName] = useState("Terminal");

  // Success overlay state
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
  const [lastHandoverCourier, setLastHandoverCourier] = useState("");
  const [lastHandoverCount, setLastHandoverCount] = useState(0);

  // Toast helper
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [historySearch, startDate, endDate, filterCourier, filterType]);

  // Barcode beep sounds
  const playBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
      gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.12);
    } catch (e) {
      console.error("Audio beep failed:", e);
    }
  };

  const playErrorBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.type = "sawtooth";
      oscillator.frequency.setValueAtTime(150, audioCtx.currentTime);
      gainNode.gain.setValueAtTime(0.2, audioCtx.currentTime);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.25);
    } catch (e) {
      console.error("Error buzz failed:", e);
    }
  };

  // Load Orders on Mount
  useEffect(() => {
    const name = localStorage.getItem("terminal_name");
    if (name) setTerminalName(name);
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    try {
      setIsLoading(true);
      const res = await fetch("https://ib-v2.hsgglobalpteltd.workers.dev/api/tiktok/orders?sync=false&active_only=true&_t=" + Date.now(), { cache: "no-store" });
      if (res.ok) {
        const data = await res.json() as { orders: any[] };
        setOrders(data.orders || []);
      } else {
        showToast("Failed to load orders registry");
      }
    } catch (err) {
      console.error(err);
      showToast("Network error loading orders list");
    } finally {
      setIsLoading(false);
    }
  };

  // Derive unique active couriers for packing/packed orders
  const courierList = useMemo(() => {
    const providers = orders
      .filter(o => (o.actual_status === "AWAITING_COLLECTION" || o.actual_status === "AWAITING_SHIPMENT"))
      .map(o => o.shipping_provider || "Unknown");
    return Array.from(new Set(providers)).filter(Boolean).sort();
  }, [orders]);

  // Handle Courier Select inside Modal
  useEffect(() => {
    if (!modalCourier) {
      setManifestOrders([]);
      return;
    }
    const packedList = orders.filter(o => 
      (o.actual_status === "AWAITING_COLLECTION" || o.actual_status === "AWAITING_SHIPMENT") &&
      (o.system_status || "").toLowerCase() === "packed" &&
      o.shipping_provider === modalCourier
    );
    setManifestOrders(packedList);
  }, [modalCourier, orders]);

  // Force Add manual order (Tracking Number or Order ID)
  const handleForceAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanInput = forceAddInput.trim();
    if (!cleanInput) return;

    if (!modalCourier) {
      playErrorBeep();
      showToast("Please choose a courier first!");
      setForceAddInput("");
      return;
    }

    const matchedOrder = orders.find(o => 
      String(o.id).trim() === cleanInput || 
      String(o.tracking_number).trim() === cleanInput
    );

    if (matchedOrder) {
      const isAlreadyInList = manifestOrders.some(o => o.id === matchedOrder.id);
      if (isAlreadyInList) {
        playErrorBeep();
        showToast("Order is already in the list!");
      } else {
        playBeep();
        const forcedOrder = { ...matchedOrder, shipping_provider: modalCourier };
        setManifestOrders(prev => [...prev, forcedOrder]);
        showToast(`Forced Add: ${matchedOrder.tracking_number}`);
      }
    } else {
      playErrorBeep();
      showToast("Tracking number / Order ID not found in database!");
    }
    setForceAddInput("");
  };

  const handleRemoveOrder = (orderId: string) => {
    setManifestOrders(prev => prev.filter(o => o.id !== orderId));
    showToast("Removed order from list.");
  };

  // Download Merged AWB PDF from backend
  const handleDownloadAWB = async () => {
    if (manifestOrders.length === 0) return;

    try {
      setIsDownloadingAWB(true);
      const res = await fetch("https://ib-v2.hsgglobalpteltd.workers.dev/api/tiktok/orders/merge-awb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orders: manifestOrders.map(o => ({ id: o.id, shop_id: o.shop_id || "" }))
        })
      });

      if (res.ok) {
        const data = await res.json() as { url: string };
        window.open(data.url, "_blank");
        showToast("AWBs compiled successfully!");
      } else {
        const errData = await res.json() as { error?: string };
        showToast(`AWB Merge failed: ${errData.error || "Unknown Error"}`);
      }
    } catch (err: any) {
      console.error(err);
      showToast(`Error merging AWBs: ${err.message}`);
    } finally {
      setIsDownloadingAWB(false);
    }
  };

  // Download Drop List Checklist PDF via client-side pdf-lib
  const handleDownloadDropList = async () => {
    if (manifestOrders.length === 0) return;

    try {
      const { PDFDocument, rgb, StandardFonts } = await import("pdf-lib");
      const pdfDoc = await PDFDocument.create();
      
      const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const courierFont = await pdfDoc.embedFont(StandardFonts.Courier);
      
      const printTime = new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore" });
      
      const drawHeader = (pageObj: any, pageNum: number, totalPages: number) => {
        pageObj.drawText("TikTok Handover Drop List", { x: 40, y: 800, size: 18, font: helveticaBold, color: rgb(0.12, 0.12, 0.12) });
        pageObj.drawText(`Courier: ${modalCourier} | Mode: ${modalMode} | Total: ${manifestOrders.length} parcels`, { x: 40, y: 780, size: 10, font: helvetica, color: rgb(0.37, 0.39, 0.41) });
        
        pageObj.drawText(`Print Date/Time: ${printTime}`, { x: 380, y: 800, size: 9, font: helvetica, color: rgb(0.37, 0.39, 0.41) });
        pageObj.drawText(`Printed By: ${terminalName}`, { x: 380, y: 785, size: 9, font: helvetica, color: rgb(0.37, 0.39, 0.41) });
        pageObj.drawText(`Page ${pageNum} of ${totalPages}`, { x: 380, y: 770, size: 9, font: helvetica, color: rgb(0.37, 0.39, 0.41) });
        
        pageObj.drawRectangle({
          x: 40,
          y: 730,
          width: 515,
          height: 20,
          color: rgb(0.95, 0.95, 0.96),
          borderColor: rgb(0.75, 0.76, 0.78),
          borderWidth: 1
        });
        
        pageObj.drawText("Order ID", { x: 48, y: 736, size: 9, font: helveticaBold, color: rgb(0.12, 0.12, 0.12) });
        pageObj.drawText("Tracking Number", { x: 248, y: 736, size: 9, font: helveticaBold, color: rgb(0.12, 0.12, 0.12) });
        pageObj.drawText("Collect", { x: 505, y: 736, size: 9, font: helveticaBold, color: rgb(0.12, 0.12, 0.12) });
      };
      
      const drawFooter = (pageObj: any) => {
        pageObj.drawLine({ start: { x: 40, y: 55 }, end: { x: 555, y: 55 }, color: rgb(0.85, 0.85, 0.86), thickness: 0.5 });
        pageObj.drawText("* Please verify that all listed parcels are physically loaded into the vehicle for dispatch.", {
          x: 40,
          y: 40,
          size: 7.5,
          font: helveticaBold,
          color: rgb(0.37, 0.39, 0.41)
        });
      };
      
      const rowsPerPage = 23;
      const totalPages = Math.max(1, Math.ceil(manifestOrders.length / rowsPerPage));
      
      let page = pdfDoc.addPage([595.28, 841.89]);
      drawHeader(page, 1, totalPages);
      drawFooter(page);
      
      let currentY = 710;
      let countOnPage = 0;
      let currentPageNum = 1;
      
      for (let i = 0; i < manifestOrders.length; i++) {
        if (countOnPage >= rowsPerPage) {
          page = pdfDoc.addPage([595.28, 841.89]);
          currentPageNum++;
          drawHeader(page, currentPageNum, totalPages);
          drawFooter(page);
          currentY = 710;
          countOnPage = 0;
        }
        
        const item = manifestOrders[i];
        const id = item.id || "";
        const tracking = item.tracking_number || "-";
        
        page.drawRectangle({
          x: 40,
          y: currentY,
          width: 515,
          height: 20,
          borderColor: rgb(0.75, 0.76, 0.78),
          borderWidth: 1
        });
        
        page.drawLine({ start: { x: 240, y: currentY }, end: { x: 240, y: currentY + 20 }, color: rgb(0.75, 0.76, 0.78), thickness: 1 });
        page.drawLine({ start: { x: 490, y: currentY }, end: { x: 490, y: currentY + 20 }, color: rgb(0.75, 0.76, 0.78), thickness: 1 });
        
        page.drawText(id, { 
          x: 48, 
          y: currentY + 6, 
          size: 8, 
          font: courierFont, 
          color: rgb(0.12, 0.12, 0.12) 
        });
        page.drawText(tracking, { x: 248, y: currentY + 6, size: 8, font: courierFont, color: rgb(0.12, 0.12, 0.12) });
        
        currentY -= 20;
        countOnPage++;
      }
      
      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes as any], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      const dateStr = new Date().toLocaleDateString("en-SG").replace(/\//g, "-");
      link.setAttribute("download", `TikTok_Handover_DropList_${modalCourier.replace(/\s+/g, '_')}_${dateStr}.pdf`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      showToast("Drop List PDF downloaded!");
    } catch (err: any) {
      alert("Error generating Drop List PDF: " + err.message);
    }
  };

  // Submit and Save Handover Batch on Backend
  const handleHandoverSubmit = async () => {
    if (manifestOrders.length === 0) {
      showToast("Manifest is empty. Please add orders first.");
      return;
    }

    try {
      setIsSubmitting(true);
      const driverLabel = modalMode === "Pickup" ? "Courier Pickup" : "Drop-Off";

      const res = await fetch("https://ib-v2.hsgglobalpteltd.workers.dev/api/tiktok/orders/handover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_ids: manifestOrders.map(o => o.id),
          driver_name: driverLabel,
          vehicle_plate: "N/A",
          signature_url: "",
          operator_name: terminalName
        })
      });

      if (res.ok) {
        setLastHandoverCourier(modalCourier);
        setLastHandoverCount(manifestOrders.length);
        setShowSuccessOverlay(true);
        
        setManifestOrders([]);
        setModalCourier("");
        setShowCreateModal(false);
        
        fetchOrders();
      } else {
        const errData = await res.json() as { error?: string };
        showToast(`Save failed: ${errData.error || "Unknown Error"}`);
      }
    } catch (err: any) {
      console.error(err);
      showToast(`Error completing handover: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Download Merged AWB PDF for a past Batch
  const handleDownloadAWBForBatch = async (batch: HandoverBatch) => {
    try {
      showToast("Compiling AWBs from Secure Storage...");
      const res = await fetch("https://ib-v2.hsgglobalpteltd.workers.dev/api/tiktok/orders/merge-awb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orders: batch.orders.map(o => ({ id: o.id, shop_id: "" }))
        })
      });

      if (res.ok) {
        const data = await res.json() as { success: boolean; url?: string };
        if (data.success && data.url) {
          window.open(data.url, "_blank");
          showToast("Merged AWB PDF downloaded!");
        } else {
          showToast("Failed to compile AWBs.");
        }
      } else {
        const err = await res.json() as { error?: string };
        showToast("Error compiles AWB: " + (err.error || "Unknown Error"));
      }
    } catch (err: any) {
      showToast("Error compiles AWB: " + err.message);
    }
  };

  // Download Handover List PDF (Drop List) for a past Batch
  const handleDownloadDropListForBatch = async (batch: HandoverBatch) => {
    try {
      const { PDFDocument, rgb, StandardFonts } = await import("pdf-lib");
      const pdfDoc = await PDFDocument.create();
      
      const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const courierFont = await pdfDoc.embedFont(StandardFonts.Courier);
      
      const printTime = new Date(batch.timestamp).toLocaleString("en-SG", { timeZone: "Asia/Singapore" });
      
      const drawHeader = (pageObj: any, pageNum: number, totalPages: number) => {
        pageObj.drawText("TikTok Handover Drop List", { x: 40, y: 800, size: 18, font: helveticaBold, color: rgb(0.12, 0.12, 0.12) });
        pageObj.drawText(`Courier: ${batch.courier} | Type: ${batch.type} | Total: ${batch.orders.length} parcels`, { x: 40, y: 780, size: 10, font: helvetica, color: rgb(0.37, 0.39, 0.41) });
        
        pageObj.drawText(`Handover Date/Time: ${printTime}`, { x: 380, y: 800, size: 9, font: helvetica, color: rgb(0.37, 0.39, 0.41) });
        pageObj.drawText(`Printed By: ${terminalName}`, { x: 380, y: 785, size: 9, font: helvetica, color: rgb(0.37, 0.39, 0.41) });
        pageObj.drawText(`Page ${pageNum} of ${totalPages}`, { x: 380, y: 770, size: 9, font: helvetica, color: rgb(0.37, 0.39, 0.41) });
        
        pageObj.drawRectangle({
          x: 40,
          y: 730,
          width: 515,
          height: 20,
          color: rgb(0.95, 0.95, 0.96),
          borderColor: rgb(0.75, 0.76, 0.78),
          borderWidth: 1
        });
        
        pageObj.drawText("Order ID", { x: 48, y: 736, size: 9, font: helveticaBold, color: rgb(0.12, 0.12, 0.12) });
        pageObj.drawText("Tracking Number", { x: 248, y: 736, size: 9, font: helveticaBold, color: rgb(0.12, 0.12, 0.12) });
        pageObj.drawText("Collect", { x: 505, y: 736, size: 9, font: helveticaBold, color: rgb(0.12, 0.12, 0.12) });
      };
      
      const drawFooter = (pageObj: any) => {
        pageObj.drawLine({ start: { x: 40, y: 55 }, end: { x: 555, y: 55 }, color: rgb(0.85, 0.85, 0.86), thickness: 0.5 });
        pageObj.drawText("* Please verify that all listed parcels are physically loaded into the vehicle for dispatch.", {
          x: 40,
          y: 40,
          size: 7.5,
          font: helveticaBold,
          color: rgb(0.37, 0.39, 0.41)
        });
      };
      
      const rowsPerPage = 23;
      const totalPages = Math.max(1, Math.ceil(batch.orders.length / rowsPerPage));
      
      let page = pdfDoc.addPage([595.28, 841.89]);
      drawHeader(page, 1, totalPages);
      drawFooter(page);
      
      let currentY = 710;
      let countOnPage = 0;
      let currentPageNum = 1;
      
      for (let i = 0; i < batch.orders.length; i++) {
        if (countOnPage >= rowsPerPage) {
          page = pdfDoc.addPage([595.28, 841.89]);
          currentPageNum++;
          drawHeader(page, currentPageNum, totalPages);
          drawFooter(page);
          currentY = 710;
          countOnPage = 0;
        }
        
        const item = batch.orders[i];
        const id = item.id || "";
        const tracking = item.tracking_number || "-";
        
        page.drawRectangle({
          x: 40,
          y: currentY,
          width: 515,
          height: 20,
          borderColor: rgb(0.75, 0.76, 0.78),
          borderWidth: 1
        });
        
        page.drawLine({ start: { x: 240, y: currentY }, end: { x: 240, y: currentY + 20 }, color: rgb(0.75, 0.76, 0.78), thickness: 1 });
        page.drawLine({ start: { x: 490, y: currentY }, end: { x: 490, y: currentY + 20 }, color: rgb(0.75, 0.76, 0.78), thickness: 1 });
        
        page.drawText(id, { 
          x: 48, 
          y: currentY + 6, 
          size: 8, 
          font: courierFont, 
          color: rgb(0.12, 0.12, 0.12) 
        });
        page.drawText(tracking, { x: 248, y: currentY + 6, size: 8, font: courierFont, color: rgb(0.12, 0.12, 0.12) });
        
        currentY -= 20;
        countOnPage++;
      }
      
      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes as any], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      const dateStr = new Date(batch.timestamp).toLocaleDateString("en-SG").replace(/\//g, "-");
      link.setAttribute("download", `TikTok_Handover_DropList_${batch.courier.replace(/\s+/g, '_')}_${dateStr}.pdf`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      showToast("Handover List PDF downloaded!");
    } catch (err: any) {
      alert("Error generating Handover List PDF: " + err.message);
    }
  };

  // Derive Handover Batches History from orders logs
  const handoverHistory = useMemo(() => {
    const batchesMap = new Map<string, HandoverBatch>();

    orders.forEach(order => {
      let logsArray: any[] = [];
      if (order.logs) {
        if (Array.isArray(order.logs)) {
          logsArray = order.logs;
        } else if (typeof order.logs === "string") {
          try {
            logsArray = JSON.parse(order.logs);
          } catch {}
        }
      }

      if (!Array.isArray(logsArray)) return;

      logsArray.forEach(log => {
        const actionStr = (log.action || "").toLowerCase();
        const timestamp = Number(log.timestamp || 0);
        if (timestamp === 0) return;

        const orderInfo = {
          id: order.id,
          tracking_number: order.tracking_number || "N/A",
          recipient_name: order.recipient_name || "N/A"
        };

        if (actionStr === "handover completed") {
          const key = `manual_${timestamp}_${log.actionBy}`;
          const existing = batchesMap.get(key);

          if (existing) {
            if (!existing.orders.some(o => o.id === orderInfo.id)) {
              existing.orders.push(orderInfo);
            }
          } else {
            let parsedDriver = "Unknown";
            let parsedPlate = "N/A";
            const remark = log.remark || "";
            
            const driverMatch = remark.match(/Handed over to (.*?)(?:\s*\(Plate:|$)/);
            if (driverMatch) parsedDriver = driverMatch[1].trim();

            const plateMatch = remark.match(/\(Plate:\s*(.*?)\)/);
            if (plateMatch) parsedPlate = plateMatch[1].trim();

            batchesMap.set(key, {
              id: key,
              timestamp,
              driver_name: parsedDriver || "Unknown",
              vehicle_plate: parsedPlate || "N/A",
              signature_url: log.photoUrl || "",
              operator_name: log.actionBy || "System",
              courier: order.shipping_provider || "Unknown",
              type: "Manual",
              orders: [orderInfo]
            });
          }
        } else if (actionStr === "in transit" && log.actionBy === "System") {
          const dateStr = new Date(timestamp).toLocaleDateString("en-SG");
          const provider = order.shipping_provider || "Unknown";
          const key = `auto_${dateStr}_${provider}`;
          
          const existing = batchesMap.get(key);
          if (existing) {
            if (!existing.orders.some(o => o.id === orderInfo.id)) {
              existing.orders.push(orderInfo);
            }
          } else {
            batchesMap.set(key, {
              id: key,
              timestamp,
              driver_name: "Auto Courier Scan",
              vehicle_plate: "N/A",
              signature_url: "",
              operator_name: "System",
              courier: provider,
              type: "Auto-Detected",
              orders: [orderInfo]
            });
          }
        }
      });
    });

    return Array.from(batchesMap.values()).sort((a, b) => b.timestamp - a.timestamp);
  }, [orders]);

  // Filtered History Batches based on date, courier, type, and search queries
  const filteredHistory = useMemo(() => {
    const q = historySearch.toLowerCase().trim();
    
    // Parse filter bounds
    const startMs = startDate ? new Date(startDate + "T00:00:00").getTime() : 0;
    const endMs = endDate ? new Date(endDate + "T23:59:59").getTime() : Infinity;

    return handoverHistory.filter(batch => {
      // 1. Date range bounds check
      if (batch.timestamp < startMs || batch.timestamp > endMs) return false;

      // 2. Courier dropdown select check
      if (filterCourier && batch.courier !== filterCourier) return false;

      // 3. Handover Type dropdown select check
      if (filterType && batch.type !== filterType) return false;

      // 4. Keyword queries search
      if (!q) return true;

      const matchHeader = 
        batch.driver_name.toLowerCase().includes(q) ||
        batch.vehicle_plate.toLowerCase().includes(q) ||
        batch.courier.toLowerCase().includes(q) ||
        batch.operator_name.toLowerCase().includes(q);

      if (matchHeader) return true;

      return batch.orders.some(o => 
        o.id.toLowerCase().includes(q) || 
        o.tracking_number.toLowerCase().includes(q) ||
        o.recipient_name.toLowerCase().includes(q)
      );
    });
  }, [handoverHistory, historySearch, startDate, endDate, filterCourier, filterType]);

  // Pagination bounds computations
  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(filteredHistory.length / itemsPerPage));
  }, [filteredHistory]);

  const startIndex = useMemo(() => {
    return (currentPage - 1) * itemsPerPage;
  }, [currentPage]);

  const paginatedHistory = useMemo(() => {
    return filteredHistory.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredHistory, startIndex]);

  const handleCopyTrackingIds = (batch: HandoverBatch) => {
    const list = batch.orders.map(o => o.tracking_number).join("\n");
    navigator.clipboard.writeText(list);
    showToast(`Copied ${batch.orders.length} tracking numbers to clipboard!`);
  };

  return (
    <div className="blank-route-page">
      <TopBar title="Handover Parcel" />

      {isLoading && orders.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="w-12 h-12 border-4 border-[#0B57D0] border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-sm font-bold text-zinc-500">Retrieving operational registers...</p>
        </div>
      ) : (
        <div className="flex flex-col w-full h-[calc(100vh-32px)] px-6 pb-6 pt-6 box-border overflow-hidden select-none">
          
          {/* Combined Filters and Table Container */}
          <div className="flex-1 flex flex-col bg-white border border-[#E0E2E6] rounded-2xl shadow-sm overflow-hidden min-h-0">
            
            {/* Multiple Filters & Actions Bar */}
            <div className="flex flex-wrap items-center justify-between p-4 border-b border-[#E0E2E6] bg-[#FDFDFD] gap-4 select-none">
              
              {/* Left: Combined Filters */}
              <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
                
                {/* Search input (Driver/Vehicle details removed from placeholder) */}
                <div className="relative w-full max-w-xs">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-zinc-400">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </span>
                  <input
                    type="text"
                    placeholder="Search by Courier, Tracking, Order ID..."
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 border border-zinc-300 rounded-lg text-xs font-semibold focus:outline-none focus:border-[#0B57D0] transition bg-white"
                  />
                </div>

                {/* Date Filters */}
                <div className="flex items-center gap-1">
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="px-2 py-1 border border-zinc-300 rounded-lg text-xs font-bold text-zinc-700 focus:outline-none focus:border-[#0B57D0]"
                  />
                  <span className="text-zinc-400 text-xs font-bold">to</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="px-2 py-1 border border-zinc-300 rounded-lg text-xs font-bold text-zinc-700 focus:outline-none focus:border-[#0B57D0]"
                  />
                </div>

                {/* Courier Dropdown Filter */}
                <select
                  value={filterCourier}
                  onChange={(e) => setFilterCourier(e.target.value)}
                  className="px-2.5 py-1.5 border border-[#E0E2E6] rounded-lg text-xs font-bold text-zinc-700 focus:outline-none focus:border-[#0B57D0] cursor-pointer bg-white"
                >
                  <option value="">All Couriers</option>
                  {courierList.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>

                {/* Handover Type Filter */}
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="px-2.5 py-1.5 border border-[#E0E2E6] rounded-lg text-xs font-bold text-zinc-700 focus:outline-none focus:border-[#0B57D0] cursor-pointer bg-white"
                >
                  <option value="">All Handover Types</option>
                  <option value="Manual">Manual (Voucher)</option>
                  <option value="Auto-Detected">Auto-Detected (Fallback)</option>
                </select>

              </div>
              
              {/* Right: Actions Button */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="px-4 py-2 bg-[#0B57D0] hover:bg-[#0842a0] text-white rounded-lg text-xs font-black cursor-pointer shadow-sm active:scale-95 transition flex items-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Create Handover
                </button>
              </div>

            </div>

            <div className="flex-1 overflow-auto">
              <table className="w-full text-left border-collapse text-xs table-fixed">
                <thead>
                  <tr className="select-none">
                    <th className="p-3 font-semibold text-[#1F1F1F] w-[26%] sticky top-0 bg-[#F8F9FA] z-10 shadow-[0_1px_0_0_#E0E2E6]">Timestamp / Date</th>
                    <th className="p-3 font-semibold text-[#1F1F1F] w-[20%] sticky top-0 bg-[#F8F9FA] z-10 shadow-[0_1px_0_0_#E0E2E6]">Courier</th>
                    <th className="p-3 font-semibold text-[#1F1F1F] w-[18%] sticky top-0 bg-[#F8F9FA] z-10 shadow-[0_1px_0_0_#E0E2E6]">Handover Type</th>
                    <th className="p-3 font-semibold text-[#1F1F1F] w-[14%] text-center sticky top-0 bg-[#F8F9FA] z-10 shadow-[0_1px_0_0_#E0E2E6]">Total Parcels</th>
                    <th className="p-3 font-semibold text-[#1F1F1F] w-[22%] text-right sticky top-0 bg-[#F8F9FA] z-10 shadow-[0_1px_0_0_#E0E2E6]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E0E2E6]">
                  {paginatedHistory.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-20 text-[#5F6368] italic font-medium">
                        No handover records matching the query were found.
                      </td>
                    </tr>
                  ) : (
                    paginatedHistory.map((batch) => (
                      <tr key={batch.id} className="hover:bg-[#F8F9FA] border-b border-[#E0E2E6] transition text-[#1F1F1F] font-medium">
                        <td className="p-3 text-[#1F1F1F] font-medium">
                          {new Date(batch.timestamp).toLocaleString("en-SG", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: true
                          })}
                        </td>
                        <td className="p-3">
                          <span className="bg-[#F1F3F4] text-[#3C4043] border border-[#E0E2E6] px-2 py-0.5 rounded uppercase text-[11px] font-semibold tracking-wide">
                            {batch.courier}
                          </span>
                        </td>
                        <td className="p-3">
                          <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded border ${
                            batch.type === "Manual" 
                              ? "bg-[#E6F4EA] text-[#137333] border-[#CEEAD6]" 
                              : "bg-[#E8F0FE] text-[#1A73E8] border-[#D2E3FC]"
                          }`}>
                            {batch.type}
                          </span>
                        </td>
                        <td className="p-3 text-center font-semibold text-[#1F1F1F]">
                          {batch.orders.length}
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => handleDownloadAWBForBatch(batch)}
                              className="w-[28px] h-[28px] rounded-lg border transition duration-150 cursor-pointer outline-none flex items-center justify-center bg-white text-[#5F6368] border-[#E0E2E6] hover:bg-[#F8F9FA] hover:text-[#1F1F1F] active:scale-95"
                              title="Download AWB"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleDownloadDropListForBatch(batch)}
                              className="w-[28px] h-[28px] rounded-lg border transition duration-150 cursor-pointer outline-none flex items-center justify-center bg-white text-[#5F6368] border-[#E0E2E6] hover:bg-[#F8F9FA] hover:text-[#1F1F1F] active:scale-95"
                              title="Download Handover List"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer (Same style and structure as Orders table) */}
            <div className="flex items-center justify-between px-6 py-3 border-t border-[#E0E2E6] bg-[#F8F9FA] select-none text-xs text-[#5F6368] font-medium">
              <div>
                Showing {filteredHistory.length > 0 ? startIndex + 1 : 0} to {Math.min(startIndex + itemsPerPage, filteredHistory.length)} of {filteredHistory.length} handover batches
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

        </div>
      )}

      {/* CREATE MANUAL HANDOVER MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center p-4 animate-in fade-in duration-150 select-none">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden font-primary max-h-[85vh] flex flex-col animate-in zoom-in-95 duration-150">
            <header className="px-6 py-4 bg-[#f8f9fa] border-b border-zinc-200 flex justify-between items-center">
              <h3 className="text-sm font-black text-[#1f1f1f] uppercase tracking-wide">
                Create Handover Batch
              </h3>
              <button 
                type="button" 
                onClick={() => { setShowCreateModal(false); setModalCourier(""); setManifestOrders([]); }} 
                className="text-zinc-400 hover:text-zinc-700 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </header>

            <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-4 min-h-[300px]">
              
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Select Courier *</label>
                  <select
                    value={modalCourier}
                    onChange={(e) => setModalCourier(e.target.value)}
                    className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-xs font-bold text-zinc-700 bg-zinc-50 hover:bg-zinc-100/50 cursor-pointer focus:outline-none focus:border-[#0B57D0] transition"
                  >
                    <option value="">-- Choose Courier --</option>
                    {courierList.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Handover Mode *</label>
                  <select
                    value={modalMode}
                    onChange={(e) => setModalMode(e.target.value as "Pickup" | "Drop-Off")}
                    className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-xs font-bold text-zinc-700 bg-zinc-50 hover:bg-zinc-100/50 cursor-pointer focus:outline-none focus:border-[#0B57D0] transition"
                  >
                    <option value="Pickup">Pickup (Courier Driver Picked up)</option>
                    <option value="Drop-Off">Drop-Off (Delivered to Drop Center)</option>
                  </select>
                </div>
              </div>

              {/* Force Add Input Field */}
              {modalCourier && (
                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-3 flex flex-col gap-2">
                  <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Force Add Unpacked Order (Fallback)</label>
                  <form onSubmit={handleForceAdd} className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Enter Tracking # or Order ID..."
                      value={forceAddInput}
                      onChange={(e) => setForceAddInput(e.target.value)}
                      className="flex-1 px-3 py-1.5 border border-zinc-300 rounded-lg text-xs font-medium focus:outline-none focus:border-[#0B57D0] focus:ring-4 focus:ring-blue-500/10 transition bg-white"
                    />
                    <button
                      type="submit"
                      className="px-4 py-1.5 bg-[#0B57D0] hover:bg-[#0842a0] text-white font-bold text-xs rounded-lg cursor-pointer transition active:scale-95"
                    >
                      Add Order
                    </button>
                  </form>
                </div>
              )}

              {/* Manifest List Table */}
              {modalCourier && (
                <div className="flex flex-col flex-1 min-h-[180px] overflow-hidden">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">
                      Handover Manifest List ({manifestOrders.length} orders)
                    </span>
                  </div>
                  
                  <div className="flex-1 border border-zinc-200 rounded-xl overflow-y-auto bg-white pr-1 py-1 flex flex-col gap-1.5 max-h-[220px]">
                    {manifestOrders.length === 0 ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-zinc-400 text-center py-10">
                        <span className="text-xs font-bold">No orders in manifest list.</span>
                        <span className="text-[10px] text-zinc-400 mt-1 max-w-[280px]">Choose courier to populate packed items, or use Force Add above.</span>
                      </div>
                    ) : (
                      manifestOrders.map(o => (
                        <div key={o.id} className="mx-2 p-2.5 bg-zinc-50/50 border border-zinc-200 rounded-xl flex items-center justify-between">
                          <div>
                            <div className="text-xs font-black text-zinc-800 font-mono tracking-wide uppercase">{o.tracking_number}</div>
                            <div className="text-[10px] font-bold text-zinc-400 mt-0.5">
                              ID: {o.id} | Status: <span className={`uppercase font-black ${o.system_status === "packed" ? "text-emerald-600" : "text-rose-600"}`}>{o.system_status}</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveOrder(o.id)}
                            className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded text-[9px] font-black cursor-pointer transition active:scale-90"
                          >
                            Remove
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

            </div>

            <footer className="px-6 py-4 bg-[#f8f9fa] border-t border-zinc-200 flex justify-between items-center gap-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={manifestOrders.length === 0 || isDownloadingAWB}
                  onClick={handleDownloadAWB}
                  className={`px-4 py-2.5 border border-zinc-300 hover:border-zinc-400 text-zinc-700 rounded-lg text-xs font-black active:scale-95 transition cursor-pointer flex items-center gap-1 ${
                    (manifestOrders.length === 0 || isDownloadingAWB) ? "opacity-50 cursor-not-allowed" : ""
                  }`}
                >
                  {isDownloadingAWB ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-zinc-700 border-t-transparent rounded-full animate-spin mr-1" />
                      AWB...
                    </>
                  ) : (
                    "Download AWB"
                  )}
                </button>
                <button
                  type="button"
                  disabled={manifestOrders.length === 0}
                  onClick={handleDownloadDropList}
                  className={`px-4 py-2.5 border border-zinc-300 hover:border-zinc-400 text-zinc-700 rounded-lg text-xs font-black active:scale-95 transition cursor-pointer ${
                    manifestOrders.length === 0 ? "opacity-50 cursor-not-allowed" : ""
                  }`}
                >
                  Download Drop List
                </button>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setShowCreateModal(false); setModalCourier(""); setManifestOrders([]); }}
                  className="px-4 py-2.5 border border-zinc-300 text-zinc-700 text-xs font-bold rounded-lg hover:bg-zinc-50 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSubmitting || manifestOrders.length === 0}
                  onClick={handleHandoverSubmit}
                  className={`px-4 py-2.5 bg-[#0B57D0] hover:bg-[#0942a0] text-white text-xs font-black rounded-lg transition cursor-pointer ${
                    (isSubmitting || manifestOrders.length === 0) ? "opacity-50 cursor-not-allowed" : ""
                  }`}
                >
                  {isSubmitting ? "Saving..." : "Submit Handover"}
                </button>
              </div>
            </footer>

          </div>
        </div>
      )}

      {/* Manifest viewer popup Modal */}
      {selectedBatch && (
        <div className="fixed inset-0 bg-black/55 z-50 flex items-center justify-center p-4 animate-in fade-in duration-150 select-none">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden font-primary max-h-[85vh] flex flex-col animate-in zoom-in-95 duration-150">
            <header className="px-6 py-4 bg-[#f8f9fa] border-b border-zinc-250 flex justify-between items-center">
              <div>
                <h3 className="text-sm font-black text-[#1f1f1f] uppercase tracking-wide">
                  Manifest List Details
                </h3>
                <span className="text-[10px] font-bold text-zinc-400 uppercase mt-0.5 block">
                  Courier: {selectedBatch.courier} | Total: {selectedBatch.orders.length} parcels
                </span>
              </div>
              <button 
                type="button" 
                onClick={() => setSelectedBatch(null)} 
                className="text-zinc-400 hover:text-zinc-700 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </header>

            <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-3 min-h-[250px]">
              <div className="flex justify-between items-center mb-1">
                <span className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">
                  Dispatched Parcels
                </span>
                <button
                  onClick={() => handleCopyTrackingIds(selectedBatch)}
                  className="text-[10px] text-[#0B57D0] hover:underline font-bold"
                >
                  Copy All Tracking Numbers
                </button>
              </div>

              <div className="flex flex-col gap-2 flex-1">
                {selectedBatch.orders.map((o, idx) => (
                  <div key={o.id} className="p-3 bg-zinc-50 border border-zinc-200/80 rounded-xl flex items-center justify-between">
                    <div>
                      <div className="text-xs font-black text-zinc-800 font-mono tracking-wide uppercase">{o.tracking_number}</div>
                      <div className="text-[10px] font-bold text-zinc-400 mt-0.5">Order ID: {o.id} | Recipient: {o.recipient_name}</div>
                    </div>
                    <span className="text-[10px] font-mono font-bold text-zinc-400">
                      #{idx + 1}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <footer className="px-6 py-4 bg-[#f8f9fa] border-t border-zinc-250 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedBatch(null)}
                className="px-5 py-2 bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg text-xs font-black cursor-pointer active:scale-95 transition"
              >
                Close
              </button>
            </footer>

          </div>
        </div>
      )}

      {/* Signature Preview Modal */}
      {selectedSignatureUrl && (
        <div 
          className="fixed inset-0 bg-black/75 z-[60] flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setSelectedSignatureUrl(null)}
        >
          <div className="bg-white p-4 rounded-xl max-w-md w-full shadow-2xl relative">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block mb-2 text-center">
              Driver Signature Record
            </span>
            <img 
              src={selectedSignatureUrl} 
              alt="Signature Zoom" 
              className="w-full bg-zinc-50 border rounded-lg p-4"
            />
            <button
              onClick={() => setSelectedSignatureUrl(null)}
              className="mt-3 w-full py-2 bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-bold rounded-lg cursor-pointer transition text-center block"
            >
              Close Preview
            </button>
          </div>
        </div>
      )}

      {/* Full-Screen Success Overlay */}
      {showSuccessOverlay && (
        <div className="fixed inset-0 bg-zinc-950/80 backdrop-blur-xs z-55 flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl animate-in zoom-in-95 duration-200 select-none">
            <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-100">
              <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            
            <h3 className="text-lg font-black text-zinc-900 mb-1">Handover Created!</h3>
            <p className="text-xs text-zinc-500 leading-relaxed mb-5">
              Successfully created handover batch for <span className="font-bold text-zinc-800">{lastHandoverCount} parcels</span> under <span className="font-bold text-zinc-800">{lastHandoverCourier}</span>. System logs updated.
            </p>

            <button
              onClick={() => setShowSuccessOverlay(false)}
              className="w-full py-2.5 bg-zinc-900 text-white rounded-xl text-xs font-black hover:bg-zinc-800 cursor-pointer active:scale-98 transition"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Floating Notifications Toast */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-zinc-900 text-white px-4 py-2.5 rounded-xl shadow-lg font-bold text-xs z-50 flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <svg className="w-4 h-4 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {toastMessage}
        </div>
      )}

    </div>
  );
}
