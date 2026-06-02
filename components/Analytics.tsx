import Script from "next/script";

// Privacy-friendly, cookieless page-view analytics (Umami). Both env vars
// unset → render nothing, so local dev and forks never report to our instance.
export function Analytics() {
  const src = process.env.NEXT_PUBLIC_UMAMI_SRC;
  const websiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
  if (!src || !websiteId) return null;

  return (
    <Script
      src={src}
      data-website-id={websiteId}
      strategy="afterInteractive"
      defer
    />
  );
}
