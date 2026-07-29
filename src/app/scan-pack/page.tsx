"use client";

import * as React from "react";
import { TopBar } from "../../components/TopBar";

interface OrderItem {
  sku_name: string;
  quantity: number;
  seller_sku?: string;
  sku_image?: string;
  sale_price?: string | number;
  currency?: string;
}

interface Order {
  id: string;
  tracking_number: string;
  create_time: number;
  status: string;
  actual_status?: string;
  system_status: string;
  packed_by: string;
  packed_at: number;
  proof_photo: string;
  before_pack_photo?: string;
  items: OrderItem[];
  shop_id?: string;
  shop_name?: string;
  shipping_provider?: string;
  total_amount?: string | number;
  currency?: string;
  logs?: any;
}

interface ScannedItem {
  id: string;
  tracking_number: string;
  create_time: number;
  before_pack_photo: string;
  after_pack_photo: string;
  scanned_at_before?: number;
  scanned_at_after?: number;
}

export default function ScanPackPage() {
  const [orders, setOrders] = React.useState<Order[]>([]);
  const [shops, setShops] = React.useState<{ id: string; name: string }[]>([]);
  const [scannedItems, setScannedItems] = React.useState<ScannedItem[]>([]);
  const [batchId, setBatchId] = React.useState<string>("");
  const [batchStartTime, setBatchStartTime] = React.useState<number>(0);
  
  const [selectedShopId, setSelectedShopId] = React.useState<string>("all");
  const [searchQuery, setSearchQuery] = React.useState<string>("");
  const [selectedTab, setSelectedTab] = React.useState<string>("pending_pack");
  const [isLoading, setIsLoading] = React.useState(true);
  const [toastMessage, setToastMessage] = React.useState<string | null>(null);

  // Row selection & items view modal states
  const [selectedOrderIds, setSelectedOrderIds] = React.useState<Set<string>>(new Set());
  const [selectedOrderItems, setSelectedOrderItems] = React.useState<Order | null>(null);

  // Modals & Popups States
  const [isOptionsOpen, setIsOptionsOpen] = React.useState(false);
  const [isCameraOpen, setIsCameraOpen] = React.useState(false);
  const [cameraMode, setCameraMode] = React.useState<"before" | "after">("before");
  const [cameraError, setCameraError] = React.useState<string | null>(null);
  
  // Repack Confirmation Dialog State
  const [repackConfirmData, setRepackConfirmData] = React.useState<{
    order: Order;
    barcode: string;
    blob: Blob;
  } | null>(null);

  // Manual Input State
  const [manualInputCode, setManualInputCode] = React.useState("");
  const [manualFile, setManualFile] = React.useState<File | null>(null);
  const [isUploading, setIsUploading] = React.useState(false);

  // Image zoom preview state
  const [zoomImgUrl, setZoomImgUrl] = React.useState<string | null>(null);

  // Inactivity countdown state (60 seconds)
  const [inactivityCountdown, setInactivityCountdown] = React.useState(60);

  // References for camera capture
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  // Memoized counts for each status tab to match Orders page layout
  const counts = React.useMemo(() => {
    let all = 0;
    let pending_pack = 0;
    let pending_collection = 0;
    let in_transit = 0;
    let delivered = 0;

    const shopFiltered = orders.filter(o => selectedShopId === "all" || o.shop_id === selectedShopId);

    shopFiltered.forEach(order => {
      all++;
      const actual = (order.actual_status || "").toUpperCase();
      const system = (order.system_status || "").toLowerCase();

      if (actual === "AWAITING_COLLECTION") {
        if (system === "packed") {
          pending_collection++;
        } else {
          pending_pack++;
        }
      } else if (actual === "IN_TRANSIT") {
        in_transit++;
      } else if (actual === "DELIVERED" || actual === "COMPLETED") {
        delivered++;
      }
    });

    return { all, pending_pack, pending_collection, in_transit, delivered };
  }, [orders, selectedShopId]);

  // Memoized displayed orders list (filtered by tab, search, and sorted accordingly)
  const displayedOrders = React.useMemo(() => {
    return orders
      .filter(order => {
        // Shop filter
        if (selectedShopId !== "all" && order.shop_id !== selectedShopId) return false;

        const actual = (order.actual_status || "").toUpperCase();
        const system = (order.system_status || "").toLowerCase();

        // Tab filter
        if (selectedTab === "pending_pack") {
          if (!(actual === "AWAITING_COLLECTION" && system === "unpacked")) return false;
        } else if (selectedTab === "pending_collection") {
          if (!(actual === "AWAITING_COLLECTION" && system === "packed")) return false;
        } else if (selectedTab === "in_transit") {
          if (actual !== "IN_TRANSIT") return false;
        } else if (selectedTab === "delivered") {
          if (!(actual === "DELIVERED" || actual === "COMPLETED")) return false;
        }

        // Search query filter
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const matchId = order.id.toLowerCase().includes(q);
          const matchTracking = (order.tracking_number || "").toLowerCase().includes(q);
          const matchItems = (order.items || []).some(item => 
            (item.sku_name || "").toLowerCase().includes(q)
          );
          if (!matchId && !matchTracking && !matchItems) return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (selectedTab === "pending_collection") {
          // Sort by Scan / Pack timestamp descending (newest scans first)
          const timeA = Number(a.packed_at || 0);
          const timeB = Number(b.packed_at || 0);
          return timeB - timeA;
        } else {
          // Sort by Order Timestamp descending (newest creation date first)
          const timeA = Number(a.create_time || 0);
          const timeB = Number(b.create_time || 0);
          return timeB - timeA;
        }
      });
  }, [orders, selectedShopId, selectedTab, searchQuery]);

  const isAllSelected = React.useMemo(() => {
    if (displayedOrders.length === 0) return false;
    return displayedOrders.every(o => selectedOrderIds.has(o.id));
  }, [displayedOrders, selectedOrderIds]);

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedOrderIds(new Set());
    } else {
      setSelectedOrderIds(new Set(displayedOrders.map(o => o.id)));
    }
  };

  // Initialize Batch ID and load orders list
  React.useEffect(() => {
    const now = Date.now();
    setBatchId("BATCH_" + now.toString(36).toUpperCase());
    setBatchStartTime(now);
    fetchOrders();
  }, []);

  // Sync / Load orders list from Server
  const fetchOrders = async () => {
    try {
      setIsLoading(true);
      const res = await fetch("https://ib.hsgglobalpteltd.workers.dev/api/tiktok/orders?_t=" + Date.now(), { cache: "no-store" });
      if (res.ok) {
        const data = await res.json() as { orders: any[]; shops?: any[] };
        setOrders(data.orders || []);
        setShops(data.shops || []);
      } else {
        showToast("Failed to load orders list");
      }
    } catch (e) {
      console.error(e);
      showToast("Network error synchronizing orders");
    } finally {
      setIsLoading(false);
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Play synthetic warehouse barcode beep sound
  const playBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // High pitch clear beep
      gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime);

      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.12);
    } catch (e) {
      console.error("Audio beep playback failed:", e);
    }
  };

  // R2 Uploader wrapper
  const uploadToStorage = async (blob: Blob, trackingId: string, mode: "before" | "after") => {
    const filename = `proof-${mode}-${trackingId}-${Date.now()}.jpg`;
    const res = await fetch(`https://ib.hsgglobalpteltd.workers.dev/api/upload?filename=${encodeURIComponent(filename)}`, {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg"
      },
      body: blob
    });
    if (!res.ok) {
      throw new Error("Failed to upload screenshot to server");
    }
    const data = await res.json() as { success: boolean; url: string };
    return data.url;
  };

  // Close camera scan window
  const closeCamera = () => {
    setIsCameraOpen(false);
    setCameraError(null);
  };

  // Reset inactivity timer on active operations/interactions
  const resetInactivityTimer = () => {
    setInactivityCountdown(60);
  };

  // Monitor 60 seconds inactivity loop
  React.useEffect(() => {
    if (!isCameraOpen) return;

    setInactivityCountdown(60);
    const interval = setInterval(() => {
      setInactivityCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          closeCamera();
          showToast("Scan window closed due to inactivity");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isCameraOpen]);

  // zxing camera scanner initialization loop
  React.useEffect(() => {
    if (!isCameraOpen) return;

    let active = true;
    let codeReader: any = null;
    let localStream: MediaStream | null = null;

    const stopAllTracks = () => {
      if (localStream) {
        localStream.getTracks().forEach(track => {
          try {
            track.stop();
          } catch (e) {
            console.error("Failed to stop track:", e);
          }
        });
        localStream = null;
      }
      if (codeReader) {
        try {
          codeReader.reset();
        } catch (e) {
          console.error("Failed to reset code reader:", e);
        }
        codeReader = null;
      }
    };

    const startScanner = async () => {
      try {
        const { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } = await import("@zxing/library");
        
        // Configure hint formats to prioritize 1D courier barcodes and QR code scanning
        const hints = new Map();
        const formats = [
          BarcodeFormat.CODE_128
        ];
        hints.set(DecodeHintType.POSSIBLE_FORMATS, formats);
        hints.set(DecodeHintType.TRY_HARDER, true);

        codeReader = new BrowserMultiFormatReader(hints);

        // 1. Get back/rear camera ID if available, or fall back to environment mode
        let constraints: MediaStreamConstraints = {
          video: { facingMode: "environment" },
          audio: false
        };

        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const videoDevices = devices.filter(device => device.kind === "videoinput");
          if (videoDevices.length > 0) {
            const backCamera = videoDevices.filter(device => 
              device.label.toLowerCase().includes("back") || 
              device.label.toLowerCase().includes("rear") ||
              device.label.toLowerCase().includes("environment") ||
              device.label.toLowerCase().includes("dir 0")
            );
            // Use the last camera in the list (usually the highest resolution/back camera)
            if (backCamera.length > 0) {
              constraints = {
                video: { deviceId: { ideal: backCamera[backCamera.length - 1].deviceId } },
                audio: false
              };
            } else {
              constraints = {
                video: { deviceId: { ideal: videoDevices[videoDevices.length - 1].deviceId } },
                audio: false
              };
            }
          }
        } catch (deviceErr) {
          console.warn("Failed to enumerate devices, falling back to environment mode:", deviceErr);
        }

        // 2. Open camera stream with progressive fallbacks
        try {
          localStream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (firstErr) {
          console.warn("Failed to start video source with deviceId constraints, trying facingMode:", firstErr);
          try {
            localStream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: "environment" },
              audio: false
            });
          } catch (secondErr) {
            console.warn("Failed to start video source with facingMode, trying raw video option:", secondErr);
            localStream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: false
            });
          }
        }

        if (!active) {
          stopAllTracks();
          return;
        }

        // 3. Bind stream to native video element
        if (videoRef.current) {
          videoRef.current.srcObject = localStream;
          videoRef.current.setAttribute("playsinline", "true");
          videoRef.current.setAttribute("autoplay", "true");
          videoRef.current.setAttribute("muted", "true");
          await videoRef.current.play();
        }

        // 4. Start decoding continuously from video element when ready
        const startDecoding = () => {
          if (!active || !codeReader || !videoRef.current) return;
          
          codeReader.decodeFromVideoElement(videoRef.current, (result: any, error: any) => {
            if (!active) return;
            if (result) {
              const decodedText = result.getText();
              playBeep();

              // Snap photo from the running video element using our canvas helper
              const videoEl = videoRef.current;
              const canvasEl = canvasRef.current;
              if (videoEl && canvasEl) {
                canvasEl.width = videoEl.videoWidth || 640;
                canvasEl.height = videoEl.videoHeight || 480;
                const ctx = canvasEl.getContext("2d");
                ctx?.drawImage(videoEl, 0, 0);
                canvasEl.toBlob(async (blob) => {
                  if (blob && active) {
                    active = false;
                    stopAllTracks();
                    handleScannedCode(decodedText, blob);
                  }
                }, "image/jpeg", 0.85);
              }
            }
          });
        };

        if (videoRef.current) {
          if (videoRef.current.readyState >= 2) {
            startDecoding();
          } else {
            videoRef.current.oncanplay = startDecoding;
          }
        }

      } catch (err: any) {
        console.error("ZXing Camera startup error:", err);
        setCameraError("Failed to initiate scanning camera. Please check permissions or use manual scan.");
      }
    };

    // Wait a tiny tick for DOM elements to mount
    const timer = setTimeout(() => {
      startScanner();
    }, 120);

    return () => {
      active = false;
      clearTimeout(timer);
      stopAllTracks();
    };
  }, [isCameraOpen, cameraMode]);

  // Convert blob to base64 string helper
  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  // Main code processing function
  const handleScannedCode = async (barcode: string, blob: Blob, forceRepack: boolean = false) => {
    resetInactivityTimer();
    
    // Find matching order in active list
    const order = orders.find(o => o.tracking_number === barcode || o.id === barcode);
    if (!order) {
      showToast(`Order not found for tracking: ${barcode}`);
      return;
    }

    const isAfter = cameraMode === "after";

    // 1. Same Batch duplicate check
    const alreadyInBatchIndex = scannedItems.findIndex(s => s.id === order.id);
    if (alreadyInBatchIndex !== -1) {
      const item = scannedItems[alreadyInBatchIndex];
      // If already has this photo mode scanned in current batch, ignore it
      if ((!isAfter && item.before_pack_photo) || (isAfter && item.after_pack_photo)) {
        showToast(`Ignore: already scanned in current session`);
        return;
      }
    }

    // 2. Different Batch check / repack detection (Only for After Pack)
    const isAlreadyPacked = order.system_status === "packed" || !!order.packed_at;
    if (isAfter && isAlreadyPacked && !forceRepack) {
      // Prompt repack confirmation popup dialog
      setRepackConfirmData({ order, barcode, blob });
      return;
    }

    // Proceed to upload and status mapping
    try {
      setIsUploading(true);

      // AI Gemini Label Stuck Validation (Only for Shipping Proof / After Pack)
      if (isAfter) {
        try {
          const base64Img = await blobToBase64(blob);
          const valRes = await fetch("https://ib.hsgglobalpteltd.workers.dev/api/tiktok/orders/validate-label", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              image: base64Img,
              mime_type: "image/jpeg"
            })
          });

          if (valRes.ok) {
            const valJson = await valRes.json() as { success: boolean; stuck: boolean };
            if (valJson.success && !valJson.stuck) {
              showToast("Scan ignored: Label must be stuck on the parcel, box, or plastic!");
              closeCamera();
              return;
            }
          } else {
            console.warn("AI Label validation service returned status", valRes.status);
          }
        } catch (e) {
          console.error("AI label validation failed, bypassing check:", e);
        }
      }

      const photoUrl = await uploadToStorage(blob, order.tracking_number, cameraMode);

      // Call Backend pack endpoint
      const updateRes = await fetch("https://ib.hsgglobalpteltd.workers.dev/api/tiktok/orders/pack", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          order_id: order.id,
          packed_by: "Operator", // Default generic Operator actor
          proof_photo: photoUrl,
          is_after_pack: isAfter,
          repack: forceRepack
        })
      });

      if (!updateRes.ok) {
        const errorText = await updateRes.json() as any;
        throw new Error(errorText.error || "Save operation failed on backend");
      }

      const resJson = await updateRes.json() as { success: boolean; order: any };
      
      // Update local orders record
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, ...resJson.order } : o));

      // Append/Update in session table list
      setScannedItems(prev => {
        const existIdx = prev.findIndex(item => item.id === order.id);
        if (existIdx !== -1) {
          const updated = [...prev];
          updated[existIdx] = {
            ...updated[existIdx],
            before_pack_photo: !isAfter ? photoUrl : updated[existIdx].before_pack_photo,
            after_pack_photo: isAfter ? photoUrl : updated[existIdx].after_pack_photo,
            scanned_at_before: !isAfter ? Date.now() : updated[existIdx].scanned_at_before,
            scanned_at_after: isAfter ? Date.now() : updated[existIdx].scanned_at_after
          };
          return updated;
        } else {
          return [
            {
              id: order.id,
              tracking_number: order.tracking_number,
              create_time: order.create_time,
              before_pack_photo: !isAfter ? photoUrl : "",
              after_pack_photo: isAfter ? photoUrl : "",
              scanned_at_before: !isAfter ? Date.now() : undefined,
              scanned_at_after: isAfter ? Date.now() : undefined
            },
            ...prev
          ];
        }
      });

      showToast(`${isAfter ? "After-Pack" : "Before-Pack"} saved for ${order.id}`);
      closeCamera();

    } catch (err: any) {
      console.error(err);
      showToast(`Upload Error: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  // Trigger manual entry form submit
  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualInputCode.trim()) return;

    if (!manualFile) {
      showToast("Please snap or select a proof photo file");
      return;
    }

    try {
      setIsUploading(true);
      await handleScannedCode(manualInputCode.trim(), manualFile);
      setManualInputCode("");
      setManualFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e) {
      console.error(e);
    } finally {
      setIsUploading(false);
    }
  };

  const openScanOptions = () => {
    setIsOptionsOpen(true);
  };

  const launchCameraScanner = (mode: "before" | "after") => {
    setCameraMode(mode);
    setIsOptionsOpen(false);
    setIsCameraOpen(true);
  };

  const formatDateTime = (timestamp?: number) => {
    if (!timestamp) return "N/A";
    const d = new Date(timestamp);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hrs = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    const secs = String(d.getSeconds()).padStart(2, '0');
    return `${day}/${month}/${year} ${hrs}:${mins}:${secs}`;
  };

  const formatDate = (timestamp?: number) => {
    if (!timestamp) return "N/A";
    const date = new Date(timestamp * 1000);
    return date.toLocaleString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  const getScanInfo = (order: Order, type: "before" | "after") => {
    const logs = Array.isArray(order.logs)
      ? order.logs
      : typeof order.logs === "string"
      ? (() => {
          try {
            return JSON.parse(order.logs);
          } catch (e) {
            return [];
          }
        })()
      : [];

    if (type === "before") {
      const log = logs.find((l: any) => l.action === "Before Pack");
      if (log) {
        return {
          timestamp: log.timestamp,
          by: log.actionBy || "Operator"
        };
      }
      if (order.before_pack_photo) {
        return {
          timestamp: order.create_time * 1000,
          by: "Operator"
        };
      }
      return null;
    } else {
      const log = logs.find((l: any) => l.action === "Pack" || l.action === "Repack");
      if (log) {
        return {
          timestamp: log.timestamp,
          by: log.actionBy || "Operator"
        };
      }
      if (order.packed_at) {
        return {
          timestamp: order.packed_at,
          by: order.packed_by || "Operator"
        };
      }
      return null;
    }
  };

  const formatScanTime = (timestamp?: number) => {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    return date.toLocaleString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  const handleCopyText = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast("Copied to clipboard!");
  };

  return (
    <div className="blank-route-page">
      <TopBar title="Scan Pack" />

      {/* Main Layout matches the Orders page layout exactly */}
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
                { key: "pending_pack", label: "Pending Pack" },
                { key: "pending_collection", label: "Pending Collection" }
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

            {/* Search and Action button row (Refresh is replaced by Scan Order) */}
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

              {/* Scan Order button replacing Refresh Orders */}
              <button
                onClick={openScanOptions}
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
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M4 8h16M4 16h16" />
                </svg>
                Scan Order
              </button>
            </div>

          </div>

          {/* Table Container */}
          <div className="flex-1 overflow-y-scroll overflow-x-auto min-h-0">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center h-64 text-sm text-[#5F6368] italic">
                <svg className="w-8 h-8 animate-spin text-[#0B57D0] mb-2" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                Loading orders database...
              </div>
            ) : displayedOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-80 text-sm text-[#5F6368] italic p-6 text-center">
                <svg className="w-12 h-12 text-[#9AA0A6] mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
                No orders matching this category found.
                <button onClick={openScanOptions} className="mt-3 btn-secondary text-xs rounded-full">Start Scanning Session</button>
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
                    <th className="p-3 font-semibold text-[#1F1F1F] w-[22%] sticky top-0 bg-[#F8F9FA] z-10 shadow-[0_1px_0_0_#E0E2E6]">Order ID & Date</th>
                    <th className="p-3 font-semibold text-[#1F1F1F] w-[12%] sticky top-0 bg-[#F8F9FA] z-10 shadow-[0_1px_0_0_#E0E2E6]">Shop</th>
                    <th className="p-3 font-semibold text-[#1F1F1F] w-[10%] sticky top-0 bg-[#F8F9FA] z-10 shadow-[0_1px_0_0_#E0E2E6]">Items</th>
                    <th className="p-3 font-semibold text-[#1F1F1F] w-[22%] sticky top-0 bg-[#F8F9FA] z-10 shadow-[0_1px_0_0_#E0E2E6]">Tracking</th>
                    <th className="p-3 font-semibold text-[#1F1F1F] w-[17%] sticky top-0 bg-[#F8F9FA] z-10 shadow-[0_1px_0_0_#E0E2E6] text-center">Packing Proof</th>
                    <th className="p-3 font-semibold text-[#1F1F1F] w-[17%] sticky top-0 bg-[#F8F9FA] z-10 shadow-[0_1px_0_0_#E0E2E6] text-center">Shipping Proof</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedOrders.map((item) => {
                    const isSelected = selectedOrderIds.has(item.id);
                    return (
                      <tr key={item.id} className="border-b border-[#F1F3F4] hover:bg-slate-50 transition duration-150">
                        
                        {/* Checkbox */}
                        <td className="p-3 text-center align-top">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {
                              setSelectedOrderIds(prev => {
                                const next = new Set(prev);
                                if (next.has(item.id)) {
                                  next.delete(item.id);
                                } else {
                                  next.add(item.id);
                                }
                                return next;
                              });
                            }}
                            className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          />
                        </td>

                        {/* ID & Date */}
                        <td className="p-3 align-top">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="font-mono font-semibold text-[#1F1F1F] text-xs truncate max-w-[140px]" title={item.id}>
                              {item.id}
                            </span>
                            <button
                              onClick={() => handleCopyText(item.id)}
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
                            {formatDate(item.create_time)}
                          </span>
                        </td>

                        {/* Shop */}
                        <td className="p-3 align-top font-medium text-[#1F1F1F] truncate" title={item.shop_name}>
                          {item.shop_name || "N/A"}
                        </td>

                        {/* Items badge toggle */}
                        <td className="p-3 align-top">
                          <button
                            onClick={() => setSelectedOrderItems(item)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#E0E2E6] hover:bg-[#EAF1FB] hover:border-[#C2E7FF] hover:text-[#0B57D0] transition duration-150 cursor-pointer text-xs font-semibold text-[#5F6368] outline-none"
                          >
                            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                            </svg>
                            <span>
                              {item.items.reduce((s, i) => s + i.quantity, 0)} {item.items.reduce((s, i) => s + i.quantity, 0) === 1 ? "Item" : "Items"}
                            </span>
                          </button>
                        </td>

                        {/* Tracking */}
                        <td className="p-3 align-top">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-medium text-[#1F1F1F] truncate block max-w-[160px]" title={item.shipping_provider || "N/A"}>
                              {item.shipping_provider || "N/A"}
                            </span>
                            {item.tracking_number && item.tracking_number !== "N/A" && item.tracking_number.trim() !== "" ? (
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-[#5F6368] text-[10px] truncate max-w-[120px]" title={item.tracking_number}>
                                  {item.tracking_number}
                                </span>
                                <button
                                  onClick={() => handleCopyText(item.tracking_number)}
                                  className="text-[#5F6368] hover:text-[#1F1F1F] cursor-pointer outline-none"
                                  title="Copy tracking number"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
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

                        {/* Packing Proof (Before Pack proof photo) */}
                        <td className="p-3 align-top text-center">
                          <div className="flex flex-col items-center gap-1.5">
                            {item.before_pack_photo ? (
                              <>
                                <img 
                                  src={item.before_pack_photo} 
                                  alt="Before Pack Proof"
                                  onClick={() => setZoomImgUrl(item.before_pack_photo || null)}
                                  className="w-12 h-12 rounded-lg object-cover cursor-pointer hover:opacity-85 border border-[#E0E2E6] shadow-sm transition"
                                />
                                {(() => {
                                  const info = getScanInfo(item, "before");
                                  if (info) {
                                    return (
                                      <div className="flex flex-col items-center leading-tight">
                                        <span className="font-semibold text-gray-700">{info.by}</span>
                                        <span className="text-[9px] text-[#80868B]">{formatScanTime(info.timestamp)}</span>
                                      </div>
                                    );
                                  }
                                  return null;
                                })()}
                              </>
                            ) : (
                              <div className="w-12 h-12 bg-[#F1F3F4] border border-dashed border-[#E0E2E6] rounded-lg flex flex-col items-center justify-center text-[8px] text-[#9AA0A6] select-none">
                                <span>Pending</span>
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Shipping Proof (After Pack proof photo) */}
                        <td className="p-3 align-top text-center">
                          <div className="flex flex-col items-center gap-1.5">
                            {item.proof_photo ? (
                              <>
                                <img 
                                  src={item.proof_photo} 
                                  alt="After Pack Proof"
                                  onClick={() => setZoomImgUrl(item.proof_photo)}
                                  className="w-12 h-12 rounded-lg object-cover cursor-pointer hover:opacity-85 border border-[#E0E2E6] shadow-sm transition"
                                />
                                {(() => {
                                  const info = getScanInfo(item, "after");
                                  if (info) {
                                    return (
                                      <div className="flex flex-col items-center leading-tight">
                                        <span className="font-semibold text-gray-700">{info.by}</span>
                                        <span className="text-[9px] text-[#80868B]">{formatScanTime(info.timestamp)}</span>
                                      </div>
                                    );
                                  }
                                  return null;
                                })()}
                              </>
                            ) : (
                              <div className="w-12 h-12 bg-[#F1F3F4] border border-dashed border-[#E0E2E6] rounded-lg flex flex-col items-center justify-center text-[8px] text-[#9AA0A6] select-none">
                                <span>Pending</span>
                              </div>
                            )}
                          </div>
                        </td>

                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

        </div>

      </div>

      {/* 1. Mode Selection Modal Options */}
      {isOptionsOpen && (
        <div className="fixed inset-0 bg-[#00000040] backdrop-blur-[2px] flex items-center justify-center z-[20000] p-4 select-none">
          <div className="bg-white border border-[#E0E2E6] rounded-2xl shadow-xl max-w-sm w-full p-6 flex flex-col gap-4">
            <div>
              <h3 className="text-base font-semibold text-[#1F1F1F]">Scan Order Mode</h3>
              <p className="text-xs text-[#5F6368] mt-1">Select the packing stage to begin camera scan</p>
            </div>
            
            <div className="flex flex-col gap-2.5 mt-2">
              <button 
                onClick={() => launchCameraScanner("before")}
                className="w-full text-left p-3.5 rounded-xl border border-[#C2E7FF] bg-[#EAF1FB] hover:bg-[#D2E3FC] text-[#0B57D0] transition font-semibold text-xs flex items-center justify-between"
              >
                <span>Packing Proof</span>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </button>

              <button 
                onClick={() => launchCameraScanner("after")}
                className="w-full text-left p-3.5 rounded-xl border border-[#A7F3D0] bg-[#E6F4EA] hover:bg-[#CEEAD6] text-[#137333] transition font-semibold text-xs flex items-center justify-between"
              >
                <span>Shipping Proof</span>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </button>
            </div>

            <button 
              onClick={() => setIsOptionsOpen(false)}
              className="mt-2 text-center text-xs font-semibold text-[#5F6368] hover:text-[#1F1F1F] py-2 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* 2. Barcode Camera Scanner Modal */}
      {isCameraOpen && (
        <div 
          onClick={resetInactivityTimer}
          onMouseMove={resetInactivityTimer}
          onKeyDown={resetInactivityTimer}
          className="fixed inset-0 bg-black flex items-center justify-center z-[25000]"
        >
          {/* Main camera layout bounds */}
          <div className="relative w-full h-full max-w-2xl max-h-[85vh] bg-[#1a1a1a] rounded-2xl overflow-hidden shadow-2xl flex flex-col border border-[#333]">
            
            {/* Header control banner */}
            <div className="p-4 bg-[#262626] border-b border-[#333] flex justify-between items-center text-white">
              <div className="flex items-center gap-3">
                <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                  cameraMode === "after" ? "bg-[#137333] text-white" : "bg-[#0b57d0] text-white"
                }`}>
                  {cameraMode === "after" ? "Shipping Proof" : "Packing Proof"}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className={`text-xs font-semibold ${inactivityCountdown <= 10 ? "text-red-500 animate-pulse" : "text-gray-300"}`}>
                  Closing in {inactivityCountdown}s
                </span>
                <button 
                  onClick={closeCamera}
                  className="text-gray-400 hover:text-white outline-none cursor-pointer"
                  title="Close scanner"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Video Feed Box container */}
            <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden">
              {cameraError ? (
                <div className="p-6 text-center text-red-400 text-sm max-w-sm">
                  <svg className="w-12 h-12 mx-auto text-red-500 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  {cameraError}
                </div>
              ) : (
                <>
                  {/* Native HTML5 Video stream viewport */}
                  <video 
                    ref={videoRef}
                    className="w-full h-full object-cover"
                    playsInline
                    autoPlay
                    muted
                  />
                  
                  {/* Canvas helper */}
                  <canvas ref={canvasRef} className="hidden" />

                  {/* style tag for scanner crosshair radar animation */}
                  <style>{`
                    @keyframes radarRotate {
                      0% { transform: rotate(0deg); }
                      100% { transform: rotate(360deg); }
                    }
                  `}</style>
                  {/* Scanner Hunter Crosshair Reticle (aiming tracker) */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                    <div className="relative w-44 h-44 flex items-center justify-center">
                      {/* Outer Ring */}
                      <div 
                        className="absolute inset-0 border border-dashed border-[#22c55e]/50 rounded-full"
                        style={{ animation: "radarRotate 15s linear infinite" }}
                      />
                      {/* Corner target brackets */}
                      <div className="absolute w-6 h-6 border-t-2 border-l-2 border-[#22c55e] top-0 left-0 rounded-tl-md" />
                      <div className="absolute w-6 h-6 border-t-2 border-r-2 border-[#22c55e] top-0 right-0 rounded-tr-md" />
                      <div className="absolute w-6 h-6 border-b-2 border-l-2 border-[#22c55e] bottom-0 left-0 rounded-bl-md" />
                      <div className="absolute w-6 h-6 border-b-2 border-r-2 border-[#22c55e] bottom-0 right-0 rounded-br-md" />
                      {/* Center targeting green dot and crosshair lines */}
                      <div className="w-1.5 h-1.5 bg-[#22c55e] rounded-full shadow-[0_0_6px_#22c55e]" />
                      <div className="absolute w-5 h-[1px] bg-[#22c55e]/70" />
                      <div className="absolute h-5 w-[1px] bg-[#22c55e]/70" />
                    </div>
                  </div>
                </>
              )}

              {/* Loading upload indicator overlay */}
              {isUploading && (
                <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center text-white z-[30000]">
                  <svg className="w-8 h-8 animate-spin text-[#0B57D0] mb-2" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                  <span className="text-xs font-semibold uppercase tracking-wider">Uploading Proof & Updating...</span>
                </div>
              )}
            </div>

          </div>
        </div>
      )}

      {/* 3. Repack Duplicate Confirmation Alert Overlay */}
      {repackConfirmData && (
        <div className="fixed inset-0 bg-[#00000040] backdrop-blur-[2px] flex items-center justify-center z-[30000] p-4 select-none">
          <div className="bg-white border border-[#FFE0B2] rounded-2xl shadow-2xl max-w-md w-full p-6 flex flex-col gap-4 animate-[fadeIn_0.15s_ease-out]">
            
            <div className="flex items-start gap-3.5">
              <div className="bg-[#FFE0B2] p-2 rounded-full text-[#E65100]">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-semibold text-[#E65100]">Duplicate Pack Alert</h3>
                <p className="text-xs text-[#5F6368] mt-1 leading-relaxed">
                  Product <code className="font-mono bg-[#FFF3E0] text-[#E65100] px-1 py-0.5 rounded font-bold">{repackConfirmData.barcode}</code> has already been scanned and packed before on:
                  <br />
                  <strong className="text-gray-800">{formatDateTime(repackConfirmData.order.packed_at)}</strong> by operator <strong>{repackConfirmData.order.packed_by || "Operator"}</strong>.
                  <br />
                  <br />
                  Did this repack or how?
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 mt-3">
              <button 
                onClick={() => {
                  const { barcode, blob } = repackConfirmData;
                  setRepackConfirmData(null);
                  handleScannedCode(barcode, blob, true); // Force repack
                }}
                className="px-4 py-2 bg-[#E65100] hover:bg-[#B63D00] text-white text-xs font-semibold rounded-lg shadow transition cursor-pointer"
              >
                Confirm Repack
              </button>
              <button 
                onClick={() => {
                  setRepackConfirmData(null);
                }}
                className="px-4 py-2 border border-[#E0E2E6] hover:bg-[#F8F9FA] text-[#5F6368] text-xs font-semibold rounded-lg transition cursor-pointer"
              >
                Cancel
              </button>
            </div>

          </div>
        </div>
      )}

      {/* 4. Fullscreen Zoom Image Overlay */}
      {zoomImgUrl && (
        <div 
          onClick={() => setZoomImgUrl(null)}
          className="fixed inset-0 bg-black/85 backdrop-blur-[2px] flex items-center justify-center z-[40000] cursor-zoom-out p-4"
        >
          <div className="relative max-w-3xl max-h-[85vh] overflow-hidden rounded-xl border border-[#222]">
            <img src={zoomImgUrl} alt="Zoom Preview" className="w-full h-full object-contain" />
            <button 
              onClick={() => setZoomImgUrl(null)}
              className="absolute top-4 right-4 bg-black/60 hover:bg-black/90 text-white rounded-full p-2"
              title="Close preview"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* 5. Items list preview modal */}
      {selectedOrderItems && (
        <div className="fixed inset-0 bg-[#00000040] backdrop-blur-[2px] flex items-center justify-center z-[30000] p-4 select-none animate-[fadeIn_0.12s_ease-out]">
          <div className="bg-white border border-[#E0E2E6] rounded-2xl shadow-2xl max-w-lg w-full flex flex-col overflow-hidden">
            
            {/* Header */}
            <div className="border-b border-[#E0E2E6] p-4 bg-[#F8F9FA] flex justify-between items-center">
              <h3 className="text-sm font-bold text-[#1F1F1F]">
                Order Items Preview
              </h3>
              <button
                onClick={() => setSelectedOrderItems(null)}
                className="text-gray-400 hover:text-gray-600 outline-none cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* List */}
            <div className="p-4 flex flex-col gap-4 overflow-y-auto max-h-[350px]">
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
                        SKU: {item.seller_sku || "N/A"}
                      </span>
                    </div>
                    <div className="flex justify-between items-center mt-1">
                      <span className="text-xs text-[#5F6368]">
                        Qty: {item.quantity}
                      </span>
                      {item.sale_price && (
                        <span className="text-xs font-bold text-[#1F1F1F]">
                          {item.currency || "$"} {parseFloat(String(item.sale_price)).toFixed(2)}
                        </span>
                      )}
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
                {selectedOrderItems.total_amount && (
                  <span className="text-xs text-[#5F6368]">
                    Total Amount: <span className="font-bold text-[#1F1F1F]">{selectedOrderItems.currency || "$"} {parseFloat(String(selectedOrderItems.total_amount)).toFixed(2)}</span>
                  </span>
                )}
              </div>
              <button
                onClick={() => setSelectedOrderItems(null)}
                className="btn-primary px-4 py-2"
                style={{ backgroundColor: "#0B57D0" }}
              >
                Close
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Floating global notifications toast */}
      {toastMessage && (
        <div className="toast-msg">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
