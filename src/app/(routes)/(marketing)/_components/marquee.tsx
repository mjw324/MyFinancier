"use client";

import Image from "next/image";

const BANK_LOGOS = [
  { src: "/logos/chase.svg", alt: "Chase", h: 22 },
  { src: "/logos/bofa.svg", alt: "Bank of America", h: 18 },
  { src: "/logos/wellsfargo.svg", alt: "Wells Fargo", h: 55 },
  { src: "/logos/capitalone.svg", alt: "Capital One", h: 30 },
  { src: "/logos/amex.svg", alt: "American Express", h: 32 },
  { src: "/logos/discover.svg", alt: "Discover", h: 22 },
  { src: "/logos/citi.svg", alt: "Citi", h: 50 },
  { src: "/logos/robinhood.svg", alt: "Robinhood", h: 22 },
];

export function LogoMarquee() {
  const loop = [...BANK_LOGOS, ...BANK_LOGOS];
  return (
    <div
      className="mf-marquee-wrap"
      style={{
        flex: 1,
        position: "relative",
        overflow: "hidden",
        minWidth: 0,
        maskImage:
          "linear-gradient(to right, transparent, black 6%, black 94%, transparent)",
        WebkitMaskImage:
          "linear-gradient(to right, transparent, black 6%, black 94%, transparent)",
      }}
    >
      <div
        className="mf-marquee"
        style={{ display: "inline-flex", whiteSpace: "nowrap" }}
      >
        {loop.map((b, i) => (
          <div
            key={i}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 36px",
              height: 56,
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            <Image
              src={b.src}
              alt={b.alt}
              width={120}
              height={b.h}
              unoptimized
              style={{
                height: b.h,
                width: "auto",
                opacity: 0.7,
                filter: "grayscale(0.2)",
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
