"use client";

import { TopBar } from "../../components/TopBar";

export default function HandoverParcelPage() {
  const handleReload = () => {
    window.location.reload();
  };

  return (
    <div className="blank-route-page">
      <TopBar title="Handover Parcel" />
      
      <button onClick={handleReload} className="gmail-reload-btn">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 7.89M9 11l3-3m-3 3l-3-3" />
        </svg>
        Reload
      </button>
    </div>
  );
}
