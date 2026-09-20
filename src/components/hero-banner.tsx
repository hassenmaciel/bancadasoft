"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { isOptimizableImage } from "@/lib/image-source";
import { HOME_BANNER_ROTATION_MS, isExternalBannerLink, type PublicHomeBanner } from "@/lib/home-banner";

/** Carrossel leve do Hero: um banner por vez, rotação a cada 5 s, sem dependências. */
export default function HeroBanner({ banners }: { banners: PublicHomeBanner[] }) {
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const count = banners.length;
  const rotating = count > 1 && !paused && !reduceMotion;

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!rotating) return;
    const timer = setInterval(() => setCurrent((index) => (index + 1) % count), HOME_BANNER_ROTATION_MS);
    return () => clearInterval(timer);
  }, [rotating, count, current]);

  const active = current % Math.max(count, 1);

  return (
    <div
      className="hero-banner"
      role="region"
      aria-roledescription="carrossel"
      aria-label="Destaques"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {banners.map((banner, index) => {
        const isActive = index === active;
        const image = (
          <Image
            src={banner.imageUrl}
            alt={banner.title}
            fill
            sizes="(max-width: 650px) 100vw, 400px"
            priority={index === 0}
            unoptimized={!isOptimizableImage(banner.imageUrl)}
            draggable={false}
          />
        );
        const slideProps = { className: `hero-banner-slide${isActive ? " is-active" : ""}`, "aria-hidden": !isActive } as const;
        if (!banner.linkUrl) return <div key={banner.id} {...slideProps}>{image}</div>;
        return isExternalBannerLink(banner.linkUrl) ? (
          <a key={banner.id} {...slideProps} href={banner.linkUrl} target="_blank" rel="noopener noreferrer" tabIndex={isActive ? 0 : -1}>
            {image}
          </a>
        ) : (
          <Link key={banner.id} {...slideProps} href={banner.linkUrl} tabIndex={isActive ? 0 : -1}>
            {image}
          </Link>
        );
      })}
      {count > 1 && (
        <div className="hero-banner-dots" role="group" aria-label="Escolher banner">
          {banners.map((banner, index) => (
            <button
              key={banner.id}
              type="button"
              className={index === active ? "is-active" : undefined}
              aria-label={`Banner ${index + 1} de ${count}`}
              aria-current={index === active}
              onClick={() => setCurrent(index)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
