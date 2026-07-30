"use client";

import Link from "next/link";
import * as React from "react";

interface MenuOption {
  title: string;
  description: string;
  href: string;
  icon: React.ReactNode;
}

export default function Home() {
  const [allowedPages, setAllowedPages] = React.useState<string[]>([]);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
    try {
      const cached = sessionStorage.getItem("terminal_allowed_pages");
      if (cached) {
        setAllowedPages(JSON.parse(cached));
      }
    } catch (_) {}
  }, []);

  const handleLogout = () => {
    sessionStorage.removeItem("terminal_auth");
    sessionStorage.removeItem("terminal_allowed_pages");
    sessionStorage.removeItem("terminal_name");
    sessionStorage.removeItem("terminal_ip");
    window.location.reload();
  };

  const options: MenuOption[] = [
    {
      title: "Dashboard",
      description: "Analyze key metrics, orders statuses, and real-time operations.",
      href: "/dashboard",
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4zM14 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2v-4z" />
        </svg>
      )
    },
    {
      title: "Orders",
      description: "Browse synced system orders, items seller SKUs, and packaging manifests.",
      href: "/orders",
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 114 0v2m-4 0h4m-4 0H3m12 0h3m-3 0V5a2 2 0 114 0v2m-4 0h4" />
        </svg>
      )
    },
    {
      title: "Scan Pack",
      description: "Scan items barcode, verify pick logs, and submit packaging photo proof.",
      href: "/scan-pack",
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h2M4 8h16M4 16h16" />
        </svg>
      )
    },
    {
      title: "Scan Handover",
      description: "Verify dispatch items to courier drivers and generate handover signatures.",
      href: "/scan-handover",
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
      )
    },
    {
      title: "Setting",
      description: "Manage system configurations, printer APIs, and server cache bindings.",
      href: "/setting",
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      )
    }
  ];

  if (!mounted) {
    return (
      <div className="menu-container">
        <div className="menu-grid" />
      </div>
    );
  }

  // Filter options based on allowedPages
  const visibleOptions = options.filter(opt => allowedPages.includes(opt.title));

  return (
    <div className="menu-container flex flex-col gap-10">
      <div className="menu-grid">
        {visibleOptions.map((option) => (
          <Link key={option.title} href={option.href} className="menu-card">
            <div className="card-icon">{option.icon}</div>
            <h3 className="card-title">{option.title}</h3>
            <p className="card-desc">{option.description}</p>
          </Link>
        ))}
      </div>

      {/* Logout Terminal Button */}
      <div className="flex justify-center w-full">
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-xs font-bold rounded-lg transition duration-150 shadow-md cursor-pointer outline-none select-none"
        >
          <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Logout Terminal
        </button>
      </div>
    </div>
  );
}
