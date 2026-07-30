"use client";

import React from "react";
import { useSearchParams, useRouter } from "next/navigation";

function MobileScannerPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const mode = searchParams.get("mode") === "before" ? "before" : "after";
  const operator = searchParams.get("operator") || "Mobile Operator";

  const [cameraError, setCameraError] = React.useState<string | null>(null);
  const [toastMessage, setToastMessage] = React.useState<string | null>(null);
  const [isUploading, setIsUploading] = React.useState(false);
  const [successOverlay, setSuccessOverlay] = React.useState<string | null>(null);

  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const playSuccessBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      // Double beep for success
      [0, 0.15].forEach((delay) => {
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(1200, audioCtx.currentTime + delay);
        gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime + delay);
        oscillator.start(audioCtx.currentTime + delay);
        oscillator.stop(audioCtx.currentTime + delay + 0.08);
      });
    } catch (e) {
      console.error(e);
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
      oscillator.frequency.setValueAtTime(150, audioCtx.currentTime); // Low buzz sound
      gainNode.gain.setValueAtTime(0.25, audioCtx.currentTime);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.4);
    } catch (e) {
      console.error(e);
    }
  };

  // R2 Uploader wrapper
  const uploadToStorage = async (blob: Blob, trackingId: string) => {
    const filename = `proof-${mode}-${trackingId}-${Date.now()}.jpg`;
    const res = await fetch(`https://ib.hsgglobalpteltd.workers.dev/api/upload?filename=${encodeURIComponent(filename)}`, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: blob
    });
    if (!res.ok) throw new Error("Upload failed");
    const data = await res.json() as { success: boolean; url: string };
    return data.url;
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        resolve(dataUrl.split(",")[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const handleScannedCode = async (barcode: string, blob: Blob, restartScanCallback: () => void) => {
    try {
      setIsUploading(true);

      // AI Gemini Label Stuck Validation (Only for Shipping Proof / after mode)
      if (mode === "after") {
        const base64Img = await blobToBase64(blob);
        const valRes = await fetch("https://ib.hsgglobalpteltd.workers.dev/api/tiktok/orders/validate-label", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: base64Img, mime_type: "image/jpeg" })
        });

        if (valRes.ok) {
          const valJson = await valRes.json() as { success: boolean; stuck: boolean };
          if (valJson.success && !valJson.stuck) {
            playErrorBeep();
            showToast("Scan ignored: Label must be stuck on the parcel, box, or plastic!");
            setIsUploading(false);
            restartScanCallback();
            return;
          }
        }
      }

      // Upload proof photo
      const photoUrl = await uploadToStorage(blob, barcode);

      // Submit pack update to backend worker
      const updateRes = await fetch("https://ib.hsgglobalpteltd.workers.dev/api/tiktok/orders/pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: barcode, // Can match tracking number
          packed_by: operator,
          proof_photo: photoUrl,
          is_after_pack: mode === "after"
        })
      });

      if (!updateRes.ok) {
        const errText = await updateRes.text();
        throw new Error(errText || "Database update failed");
      }

      playSuccessBeep();
      setSuccessOverlay(barcode);
      setTimeout(() => {
        setSuccessOverlay(null);
        restartScanCallback();
      }, 2500);

    } catch (err: any) {
      console.error(err);
      playErrorBeep();
      showToast(err.message || "Failed to process scan. Try again.");
      restartScanCallback();
    } finally {
      setIsUploading(false);
    }
  };

  const captureAndAIScan = async () => {
    const videoEl = videoRef.current;
    const canvasEl = canvasRef.current;
    if (!videoEl || !canvasEl) return;

    try {
      setIsUploading(true);
      
      // Capture frame
      canvasEl.width = videoEl.videoWidth || 1280;
      canvasEl.height = videoEl.videoHeight || 720;
      const ctx = canvasEl.getContext("2d");
      ctx?.drawImage(videoEl, 0, 0);

      // Convert canvas to base64
      const base64Img = canvasEl.toDataURL("image/jpeg", 0.85).split(",")[1];

      // Call AI Scan endpoint
      const res = await fetch("https://ib.hsgglobalpteltd.workers.dev/api/tiktok/orders/ai-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64Img, mime_type: "image/jpeg" })
      });

      if (!res.ok) {
        throw new Error("Failed to process image with AI decoder");
      }

      const scanResult = await res.json() as { success: boolean; tracking_number: string | null; stuck: boolean };
      
      if (!scanResult.success || !scanResult.tracking_number) {
        playErrorBeep();
        showToast("AI Scan failed: No courier barcode detected. Align label and try again.");
        return;
      }

      // If Shipping Proof (after mode) and label is not stuck, reject it
      if (mode === "after" && !scanResult.stuck) {
        playErrorBeep();
        showToast("Scan ignored: Label must be stuck on the parcel package!");
        return;
      }

      playSuccessBeep();

      // Convert canvas to Blob for final storage upload
      canvasEl.toBlob(async (blob) => {
        if (blob) {
          await handleScannedCode(scanResult.tracking_number!, blob, () => {});
        }
      }, "image/jpeg", 0.85);

    } catch (err: any) {
      console.error(err);
      playErrorBeep();
      showToast(err.message || "Decoding error. Please retry.");
    } finally {
      setIsUploading(false);
    }
  };

  React.useEffect(() => {
    let active = true;
    let localStream: MediaStream | null = null;

    const stopAllTracks = () => {
      if (localStream) {
        localStream.getTracks().forEach(track => {
          try { track.stop(); } catch (_) {}
        });
        localStream = null;
      }
    };

    const startScanner = async () => {
      try {
        let constraints: MediaStreamConstraints = {
          video: { 
            facingMode: "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
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
            if (backCamera.length > 0) {
              constraints = {
                video: { 
                  deviceId: { ideal: backCamera[backCamera.length - 1].deviceId },
                  width: { ideal: 1280 },
                  height: { ideal: 720 }
                },
                audio: false
              };
            }
          }
        } catch (_) {}

        try {
          localStream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (e) {
          try {
            localStream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
              audio: false
            });
          } catch (e2) {
            localStream = await navigator.mediaDevices.getUserMedia({
              video: { width: { ideal: 1280 }, height: { ideal: 720 } },
              audio: false
            });
          }
        }

        if (!active) {
          stopAllTracks();
          return;
        }

        if (videoRef.current) {
          videoRef.current.srcObject = localStream;
          videoRef.current.setAttribute("playsinline", "true");
          videoRef.current.setAttribute("autoplay", "true");
          videoRef.current.setAttribute("muted", "true");
          await videoRef.current.play();
        }

      } catch (err: any) {
        console.error(err);
        setCameraError("Camera access denied or device issue.");
      }
    };

    startScanner();

    return () => {
      active = false;
      stopAllTracks();
    };
  }, []);

  // Silent background auto-scan loop for mobile
  React.useEffect(() => {
    if (isUploading || successOverlay) return;

    const interval = setInterval(async () => {
      if (isUploading || successOverlay) return;

      const videoEl = videoRef.current;
      const canvasEl = canvasRef.current;
      if (!videoEl || !canvasEl) return;

      try {
        canvasEl.width = videoEl.videoWidth || 1280;
        canvasEl.height = videoEl.videoHeight || 720;
        const ctx = canvasEl.getContext("2d");
        ctx?.drawImage(videoEl, 0, 0);

        const base64Img = canvasEl.toDataURL("image/jpeg", 0.7).split(",")[1];

        const res = await fetch("https://ib.hsgglobalpteltd.workers.dev/api/tiktok/orders/ai-scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: base64Img, mime_type: "image/jpeg" })
        });

        if (res.ok) {
          const scanResult = await res.json() as { success: boolean; tracking_number: string | null; stuck: boolean };
          if (scanResult.success && scanResult.tracking_number) {
            if (mode === "after" && !scanResult.stuck) {
              return;
            }

            playSuccessBeep();
            canvasEl.toBlob(async (blob) => {
              if (blob) {
                await handleScannedCode(scanResult.tracking_number!, blob, () => {});
              }
            }, "image/jpeg", 0.85);
          }
        }
      } catch (err) {
        console.warn("Mobile background auto-scan warning:", err);
      }
    }, 2800);

    return () => clearInterval(interval);
  }, [isUploading, successOverlay]);

  return (
    <div className="fixed inset-0 bg-black flex flex-col select-none overflow-hidden font-sans">
      
      {/* Header bar */}
      <div className="p-4 bg-[#1a1a1a] border-b border-[#2d2d2d] flex justify-between items-center text-white z-20">
        <div className="flex flex-col">
          <span className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">Mobile Scanner</span>
          <span className="text-xs font-bold mt-0.5">
            Mode: {mode === "after" ? "Shipping Proof" : "Packing Proof"}
          </span>
        </div>
        <button 
          onClick={() => router.replace("/scan-parcel")}
          className="text-xs font-semibold px-3 py-1.5 rounded bg-[#333] hover:bg-[#444] text-white transition active:scale-95 animate-pulse"
        >
          Exit
        </button>
      </div>

      {/* Main scanner viewport */}
      <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
        {cameraError ? (
          <div className="p-6 text-center text-red-400 text-sm z-20">
            <svg className="w-12 h-12 mx-auto text-red-500 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="font-bold mb-1">Camera error</p>
            <p className="text-xs text-gray-500">{cameraError}</p>
          </div>
        ) : (
          <>
            <video 
              ref={videoRef}
              className="w-full h-full object-cover"
              playsInline
              autoPlay
              muted
            />
            <canvas ref={canvasRef} className="hidden" />

            {/* Target Hunting Finder Reticle */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
              <div className="relative w-40 h-40 flex items-center justify-center">
                <div className="absolute inset-0 border border-dashed border-[#22c55e]/40 rounded-full animate-spin" style={{ animationDuration: "12s" }} />
                <div className="absolute w-5 h-5 border-t-2 border-l-2 border-[#22c55e] top-0 left-0 rounded-tl" />
                <div className="absolute w-5 h-5 border-t-2 border-r-2 border-[#22c55e] top-0 right-0 rounded-tr" />
                <div className="absolute w-5 h-5 border-b-2 border-l-2 border-[#22c55e] bottom-0 left-0 rounded-bl" />
                <div className="absolute w-5 h-5 border-b-2 border-r-2 border-[#22c55e] bottom-0 right-0 rounded-br" />
                <div className="w-1.5 h-1.5 bg-[#22c55e] rounded-full shadow-[0_0_6px_#22c55e]" />
                <div className="absolute w-4 h-[1px] bg-[#22c55e]/60" />
                <div className="absolute h-4 w-[1px] bg-[#22c55e]/60" />
              </div>
            </div>

            {/* Shutter Capture & AI Scan button */}
            <div className="absolute bottom-10 left-0 right-0 flex justify-center z-20">
              <button
                onClick={captureAndAIScan}
                disabled={isUploading}
                className="w-16 h-16 rounded-full bg-white active:scale-95 flex items-center justify-center shadow-2xl border-4 border-gray-300 transition duration-150 outline-none cursor-pointer"
              >
                <div className="w-11 h-11 rounded-full bg-[#22c55e] hover:bg-[#16a34a] transition" />
              </button>
            </div>
          </>
        )}

        {/* Uploading Overlay */}
        {isUploading && (
          <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center text-white z-30">
            <svg className="w-8 h-8 animate-spin text-[#22c55e] mb-3" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <span className="text-xs uppercase font-semibold tracking-wider">Verifying & Registering Scan...</span>
          </div>
        )}

        {/* Success Scan Flash Screen */}
        {successOverlay && (
          <div className="absolute inset-0 bg-[#22c55e] flex flex-col items-center justify-center text-white z-40 animate-fade-in">
            <div className="p-4 rounded-full bg-white/20 mb-4 animate-bounce">
              <svg className="w-16 h-16 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <span className="text-base font-bold uppercase tracking-wider">Scan Registered!</span>
            <span className="text-xs text-green-100 font-mono mt-1">{successOverlay}</span>
          </div>
        )}
      </div>

      {/* Floating notification Toast */}
      {toastMessage && (
        <div className="absolute bottom-6 left-4 right-4 bg-red-600 border border-red-500 rounded-xl p-3 text-white text-xs text-center z-50 shadow-2xl font-semibold">
          {toastMessage}
        </div>
      )}
    </div>
  );
}

export default function MobileScannerPage() {
  return (
    <React.Suspense fallback={
      <div className="fixed inset-0 bg-black flex flex-col items-center justify-center text-white text-xs font-semibold gap-3">
        <svg className="w-8 h-8 animate-spin text-[#22c55e]" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
        <span>Loading Mobile Scanner...</span>
      </div>
    }>
      <MobileScannerPageContent />
    </React.Suspense>
  );
}
