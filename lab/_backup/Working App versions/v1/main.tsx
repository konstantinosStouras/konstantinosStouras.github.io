import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

interface Item {
  id: number;
  name: string;
  weight: number;
  value: number;
}

declare global {
  interface Window {
    isMobile: boolean;
    selectedItem?: Item;
    geoInfo: { city: string; country: string };
  }
}

window.isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

(() => {
  document.addEventListener("click", (e) => {
    if (!window.isMobile) return;
    const target = e.target as HTMLElement;
    const dataAttr = target.closest("[data-item]")?.getAttribute("data-item");
    if (dataAttr) {
      window.selectedItem = JSON.parse(dataAttr);
    } else if (target.closest("[data-knapsack]") && window.selectedItem) {
      const dropEvent = new CustomEvent("manualdrop", {
        detail: window.selectedItem,
        bubbles: true,
      });
      target.closest("[data-knapsack]")?.dispatchEvent(dropEvent);
      window.selectedItem = undefined;
    }
  });

  fetch("https://ipapi.co/json")
    .then(res => res.ok ? res.json() : Promise.reject())
    .then(data => window.geoInfo = { city: data.city || "", country: data.country_name || "" })
    .catch(() => window.geoInfo = { city: "", country: "" });
})();

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}