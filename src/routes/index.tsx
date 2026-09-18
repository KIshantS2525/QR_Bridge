import { createFileRoute } from "@tanstack/react-router";
import { QRTransferApp } from "@/components/QRTransferApp";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "QR File Transfer — Move Files Through Light" },
      { name: "description", content: "Transfer files offline between screens and cameras using animated QR codes with gzip compression and SHA-256 verification." },
      { property: "og:title", content: "QR File Transfer — Move Files Through Light" },
      { property: "og:description", content: "An offline optical file transfer proof of concept using animated QR frames." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: QRTransferApp,
});
