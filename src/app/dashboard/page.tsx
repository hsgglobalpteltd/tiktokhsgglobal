"use client";

import * as React from "react";
import { TopBar } from "../../components/TopBar";

interface Order {
  id: string;
  actual_status: string;
  system_status: string;
  total_amount: string;
  create_time: number;
  shop_name: string;
  shop_id: string;
}

export default function DashboardPage() {
  const [orders, setOrders] = React.useState<Order[]>([]);
  const [shops, setShops] = React.useState<{ id: string; name: string }[]>([]);
  const [selectedShopId, setSelectedShopId] = React.useState<string>("all");
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Filter offset states
  const [weekOffset, setWeekOffset] = React.useState(0);
  const [monthOffsetOrders, setMonthOffsetOrders] = React.useState(0);
  const [monthOffsetRevenue, setMonthOffsetRevenue] = React.useState(0);

  const filteredOrders = React.useMemo(() => {
    return orders.filter(
      (o) => selectedShopId === "all" || o.shop_id === selectedShopId
    );
  }, [orders, selectedShopId]);

  // Fetch orders from local Supabase cache (sync=false)
  const fetchDashboardData = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const res = await fetch(`https://ib.hsgglobalpteltd.workers.dev/api/tiktok/orders?sync=false&_t=${Date.now()}`, {
        cache: "no-store"
      });
      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
      const data = await res.json();
      if (data.success) {
        setOrders(data.orders || []);
        setShops(data.shops || []);
        setError(null);
      } else {
        throw new Error(data.error || "Unknown error fetching data");
      }
    } catch (err: any) {
      console.error("Dashboard fetch error:", err);
      if (!silent) setError(err.message || "Failed to load dashboard metrics.");
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  // Poll database every 30 seconds
  React.useEffect(() => {
    fetchDashboardData(false);

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        fetchDashboardData(true);
      }
    }, 30000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchDashboardData(true);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // 1. Qty Pending Pack
  // actual === "AWAITING_COLLECTION" && system === "unpacked"
  const pendingPackCount = React.useMemo(() => {
    return filteredOrders.filter(
      (o) =>
        (o.actual_status || "").toUpperCase() === "AWAITING_COLLECTION" &&
        (o.system_status || "").toLowerCase() === "unpacked"
    ).length;
  }, [filteredOrders]);

  // 2. Qty Pending Collection
  // actual === "AWAITING_COLLECTION" && system === "packed"
  const pendingCollectionCount = React.useMemo(() => {
    return filteredOrders.filter(
      (o) =>
        (o.actual_status || "").toUpperCase() === "AWAITING_COLLECTION" &&
        (o.system_status || "").toLowerCase() === "packed"
    ).length;
  }, [filteredOrders]);

  // 3. Weekly Orders (Monday - Sunday)
  const weekRange = React.useMemo(() => {
    const today = new Date();
    const currentDay = today.getDay();
    const distance = currentDay === 0 ? -6 : 1 - currentDay;
    
    const monday = new Date(today);
    monday.setDate(today.getDate() + distance + weekOffset * 7);
    monday.setHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    return { start: monday, end: sunday };
  }, [weekOffset]);

  const weeklyOrdersCount = React.useMemo(() => {
    return filteredOrders.filter((o) => {
      const ms = (o.create_time || 0) * 1000;
      return ms >= weekRange.start.getTime() && ms <= weekRange.end.getTime();
    }).length;
  }, [filteredOrders, weekRange]);

  // 4. Monthly Orders
  const monthRangeOrders = React.useMemo(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + monthOffsetOrders;

    const start = new Date(year, month, 1, 0, 0, 0, 0);
    const end = new Date(year, month + 1, 0, 23, 59, 59, 999);

    return { start, end };
  }, [monthOffsetOrders]);

  const monthlyOrdersCount = React.useMemo(() => {
    return filteredOrders.filter((o) => {
      const ms = (o.create_time || 0) * 1000;
      return ms >= monthRangeOrders.start.getTime() && ms <= monthRangeOrders.end.getTime();
    }).length;
  }, [filteredOrders, monthRangeOrders]);

  // 5. Monthly Gross Revenue
  const monthRangeRevenue = React.useMemo(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + monthOffsetRevenue;

    const start = new Date(year, month, 1, 0, 0, 0, 0);
    const end = new Date(year, month + 1, 0, 23, 59, 59, 999);

    return { start, end };
  }, [monthOffsetRevenue]);

  const monthlyRevenueSum = React.useMemo(() => {
    return filteredOrders
      .filter((o) => {
        const ms = (o.create_time || 0) * 1000;
        return ms >= monthRangeRevenue.start.getTime() && ms <= monthRangeRevenue.end.getTime();
      })
      .reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);
  }, [filteredOrders, monthRangeRevenue]);

  // Date Formatting Helpers
  const formatWeekText = (start: Date, end: Date) => {
    const startStr = start.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const endStr = end.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    return `${startStr} - ${endStr}`;
  };

  const formatMonthText = (date: Date) => {
    return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-SG", {
      style: "currency",
      currency: "SGD",
      minimumFractionDigits: 2
    }).format(amount);
  };

  const shopOptions = React.useMemo(() => {
    return [{ id: "all", name: "All Shops" }, ...shops];
  }, [shops]);

  const currentShopIndex = React.useMemo(() => {
    return shopOptions.findIndex(opt => opt.id === selectedShopId);
  }, [shopOptions, selectedShopId]);

  const handlePrevShop = () => {
    if (shopOptions.length <= 1) return;
    const prev = (currentShopIndex - 1 + shopOptions.length) % shopOptions.length;
    setSelectedShopId(shopOptions[prev].id);
  };

  const handleNextShop = () => {
    if (shopOptions.length <= 1) return;
    const next = (currentShopIndex + 1) % shopOptions.length;
    setSelectedShopId(shopOptions[next].id);
  };

  return (
    <div className="blank-route-page">
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes custom-pulse {
          0%, 100% {
            transform: scale(1);
            box-shadow: 0 0 0 0 rgba(249, 115, 22, 0.25);
          }
          50% {
            transform: scale(1.004);
            box-shadow: 0 0 12px 4px rgba(249, 115, 22, 0.12);
          }
        }
        .pulse-orange-glow {
          animation: custom-pulse 2.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
          border-color: rgb(249, 115, 22) !important;
          background-color: #fffaf5 !important;
        }
        .blue-glow {
          border-color: rgb(14, 165, 233) !important;
          background-color: #f0f9ff !important;
          box-shadow: 0 4px 20px rgba(14, 165, 233, 0.15);
        }
        .metric-title {
          font-size: 0.75rem;
          font-weight: 800;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #5f6368;
        }
        .metric-number {
          font-size: 3.75rem;
          font-weight: 900;
          line-height: 1.1;
          letter-spacing: -0.03em;
        }
        .revenue-number {
          font-size: 3.75rem;
          font-weight: 900;
          line-height: 1.1;
          letter-spacing: -0.03em;
        }
        @media (max-width: 1024px) {
          .metric-number {
            font-size: 2.75rem;
          }
          .revenue-number {
            font-size: 2.75rem;
          }
        }
      `}} />
      
      <TopBar title="Fulfillment Dashboard" />

      <div className="flex flex-col w-full h-[calc(100vh-32px)] px-10 pb-10 pt-6 box-border overflow-hidden select-none">
        
        {/* Centered Shop Navigation Switcher */}
        {shops.length > 0 && (
          <div className="flex items-center justify-center gap-3 bg-white p-2 rounded-2xl mx-auto mb-5 border border-zinc-200/80 shadow-md shadow-zinc-100 select-none min-w-[340px] max-w-sm">
            <button 
              onClick={handlePrevShop}
              className="w-12 h-12 flex items-center justify-center bg-zinc-50 hover:bg-zinc-100 active:scale-95 rounded-xl shadow-sm border border-zinc-200/40 text-zinc-600 hover:text-[#0B57D0] transition cursor-pointer"
              title="Previous Shop"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.8} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            
            <div className="flex-1 flex flex-col items-center justify-center px-4">
              <span className="text-[9px] text-zinc-400 font-extrabold uppercase tracking-widest block mb-0.5 select-none">
                TikTok Shop
              </span>
              <span className="text-sm font-black text-zinc-800 tracking-wider uppercase block text-center min-w-[150px]">
                {shopOptions[currentShopIndex]?.name || "All Shops"}
              </span>
            </div>

            <button 
              onClick={handleNextShop}
              className="w-12 h-12 flex items-center justify-center bg-zinc-50 hover:bg-zinc-100 active:scale-95 rounded-xl shadow-sm border border-zinc-200/40 text-zinc-600 hover:text-[#0B57D0] transition cursor-pointer"
              title="Next Shop"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.8} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        )}
        
        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-4 text-red-700 text-xs font-bold rounded shadow-sm flex items-center gap-2">
            <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            {error}
          </div>
        )}

        {isLoading && orders.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center">
            <div className="w-12 h-12 border-4 border-[#0B57D0] border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-sm font-bold text-zinc-500">Loading live operational metrics...</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col gap-6 mt-2 h-full">
            
            {/* Row 1: Operational Metrics (Pulsing Orange & Blue) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-[48%] min-h-[220px]">
              
              {/* Card 1: Qty Pending Pack */}
              <div 
                className={`bg-white rounded-2xl border-2 border-zinc-200/80 p-6 flex flex-col justify-between transition-all duration-300 ${
                  pendingPackCount > 0 ? "pulse-orange-glow" : "bg-zinc-50/20"
                }`}
              >
                <div className="text-center pt-2">
                  <h2 className="text-2xl font-black uppercase tracking-wide text-zinc-700">
                    Pending Packing
                  </h2>
                  <p className="text-[10px] text-zinc-400 font-bold mt-0.5">READY FOR PACKING IN WAREHOUSE</p>
                </div>
                
                <div className="flex-1 flex items-center justify-center my-1">
                  <span className={`text-center font-black leading-none tracking-tighter ${pendingPackCount > 0 ? "text-orange-600" : "text-zinc-400"}`} style={{ fontSize: "9.5rem" }}>
                    {pendingPackCount}
                  </span>
                </div>

                <div className="flex justify-between items-center text-[10px] font-bold text-zinc-500">
                  <span>STATUS: AWAITING_COLLECTION (UNPACKED)</span>
                  {pendingPackCount > 0 && <span className="text-orange-600 animate-pulse">ACTION REQUIRED</span>}
                </div>
              </div>

              {/* Card 2: Qty Pending Collection */}
              <div className="bg-white rounded-2xl border-2 border-zinc-200/80 p-6 flex flex-col justify-between transition-all duration-300 blue-glow">
                <div className="text-center pt-2">
                  <h2 className="text-2xl font-black uppercase tracking-wide text-zinc-700">
                    Pending Collection
                  </h2>
                  <p className="text-[10px] text-zinc-400 font-bold mt-0.5">PACKED & READY FOR COURIER PICKUP</p>
                </div>

                <div className="flex-1 flex items-center justify-center my-1">
                  <span className="text-sky-600 text-center font-black leading-none tracking-tighter" style={{ fontSize: "9.5rem" }}>
                    {pendingCollectionCount}
                  </span>
                </div>

                <div className="flex justify-between items-center text-[10px] font-bold text-zinc-500">
                  <span>STATUS: AWAITING_COLLECTION (PACKED)</span>
                  <span>MONITOR PICKUP</span>
                </div>
              </div>

            </div>

            {/* Row 2: Calendar Metrics (Week, Month, Revenue) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-[48%] min-h-[220px]">
              
              {/* Card 3: Weekly Order Volume */}
              <div className="bg-white rounded-2xl border border-zinc-200/80 p-6 flex flex-col justify-between hover:shadow-md transition duration-200">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="metric-title block">Weekly Volume</span>
                    <span className="text-[10px] text-zinc-400 font-bold mt-1 block">ORDERS CREATED THIS WEEK</span>
                  </div>
                  
                  {/* Selector Controls */}
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setWeekOffset(prev => prev - 1)}
                      className="w-10 h-10 flex items-center justify-center bg-zinc-100 hover:bg-zinc-200 rounded-full transition text-zinc-700 active:scale-90 cursor-pointer"
                      title="Previous Week"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <button 
                      onClick={() => setWeekOffset(prev => Math.min(0, prev + 1))}
                      disabled={weekOffset >= 0}
                      className={`w-10 h-10 flex items-center justify-center bg-zinc-100 hover:bg-zinc-200 rounded-full transition text-zinc-700 active:scale-90 cursor-pointer ${
                        weekOffset >= 0 ? "opacity-30 cursor-not-allowed pointer-events-none" : ""
                      }`}
                      title="Next Week"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="flex-1 flex flex-col items-center justify-center my-2">
                  <span className="metric-number text-zinc-800 text-center">
                    {weeklyOrdersCount}
                  </span>
                  <span className="text-[10px] font-extrabold text-zinc-500 mt-1 uppercase bg-zinc-100 px-2 py-0.5 rounded">
                    {formatWeekText(weekRange.start, weekRange.end)}
                  </span>
                </div>

                <div className="text-center text-xs font-bold text-zinc-500 uppercase tracking-wider">
                  Week Orders
                </div>
              </div>

              {/* Card 4: Monthly Order Volume */}
              <div className="bg-white rounded-2xl border border-zinc-200/80 p-6 flex flex-col justify-between hover:shadow-md transition duration-200">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="metric-title block">Monthly Volume</span>
                    <span className="text-[10px] text-zinc-400 font-bold mt-1 block">ORDERS CREATED THIS MONTH</span>
                  </div>
                  
                  {/* Selector Controls */}
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setMonthOffsetOrders(prev => prev - 1)}
                      className="w-10 h-10 flex items-center justify-center bg-zinc-100 hover:bg-zinc-200 rounded-full transition text-zinc-700 active:scale-90 cursor-pointer"
                      title="Previous Month"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <button 
                      onClick={() => setMonthOffsetOrders(prev => Math.min(0, prev + 1))}
                      disabled={monthOffsetOrders >= 0}
                      className={`w-10 h-10 flex items-center justify-center bg-zinc-100 hover:bg-zinc-200 rounded-full transition text-zinc-700 active:scale-90 cursor-pointer ${
                        monthOffsetOrders >= 0 ? "opacity-30 cursor-not-allowed pointer-events-none" : ""
                      }`}
                      title="Next Month"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="flex-1 flex flex-col items-center justify-center my-2">
                  <span className="metric-number text-zinc-800 text-center">
                    {monthlyOrdersCount}
                  </span>
                  <span className="text-[10px] font-extrabold text-zinc-500 mt-1 uppercase bg-zinc-100 px-2 py-0.5 rounded">
                    {formatMonthText(monthRangeOrders.start)}
                  </span>
                </div>

                <div className="text-center text-xs font-bold text-zinc-500 uppercase tracking-wider">
                  Month Orders
                </div>
              </div>

              {/* Card 5: Total Gross Revenue */}
              <div className="bg-white rounded-2xl border-2 border-emerald-100 p-6 flex flex-col justify-between hover:shadow-md transition duration-200">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="metric-title block text-emerald-800">Tiktok Revenue</span>
                    <span className="text-[10px] text-zinc-400 font-bold mt-1 block">GROSS TIKTOK SHOP REVENUE</span>
                  </div>
                  
                  {/* Selector Controls */}
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setMonthOffsetRevenue(prev => prev - 1)}
                      className="w-10 h-10 flex items-center justify-center bg-emerald-50 hover:bg-emerald-100 rounded-full transition text-emerald-700 active:scale-90 cursor-pointer"
                      title="Previous Month"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <button 
                      onClick={() => setMonthOffsetRevenue(prev => Math.min(0, prev + 1))}
                      disabled={monthOffsetRevenue >= 0}
                      className={`w-10 h-10 flex items-center justify-center bg-emerald-50 hover:bg-emerald-100 rounded-full transition text-emerald-700 active:scale-90 cursor-pointer ${
                        monthOffsetRevenue >= 0 ? "opacity-30 cursor-not-allowed pointer-events-none" : ""
                      }`}
                      title="Next Month"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="flex-1 flex flex-col items-center justify-center my-2">
                  <span className="revenue-number text-emerald-600 text-center tracking-tight">
                    {formatCurrency(monthlyRevenueSum)}
                  </span>
                  <span className="text-[10px] font-extrabold text-emerald-700 mt-2 uppercase bg-emerald-50 px-2.5 py-0.5 rounded">
                    {formatMonthText(monthRangeRevenue.start)}
                  </span>
                </div>

                <div className="text-center text-xs font-bold text-emerald-700 uppercase tracking-wider">
                  Month Sales
                </div>
              </div>

            </div>

          </div>
        )}
      </div>
    </div>
  );
}
