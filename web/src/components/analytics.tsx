"use client";

import Script from "next/script";
import { useEffect, useState } from "react";

export function Analytics() {
  const [websiteId, setWebsiteId] = useState<string | null>(null);
  const [privacyReady, setPrivacyReady] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/analytics-config", { signal: controller.signal, cache: "no-store" })
      .then(response => response.ok ? response.json() : null)
      .then(config => { if (config?.websiteId) setWebsiteId(config.websiteId); })
      .catch(() => { /* Statistics must never block the website. */ });
    return () => controller.abort();
  }, []);
  if (!websiteId) return null;
  return <>
    <Script src="/analytics-privacy.js" onReady={() => setPrivacyReady(true)} />
    {privacyReady && <Script src="/metrics/script.js" data-website-id={websiteId}
      data-before-send="henuAnalyticsBeforeSend" data-exclude-search="true"
      data-exclude-hash="true" data-do-not-track="true" />}
  </>;
}
