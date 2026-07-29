"use client";

import { TopBar } from "../../components/TopBar";

export default function DashboardPage() {
  const handleReload = () => {
    window.location.reload();
  };

  return (
    <div className="blank-route-page">
      <TopBar title="Dashboard" />
      
      <button onClick={handleReload} className="gmail-reload-btn">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
        </svg>
        Reload
      </button>
    </div>
  );
}
