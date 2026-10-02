"use client";

import React from "react";
import { BRAND_SVG_CONSTANTS, BRAND_ICON_SVG_CONSTANTS, BRAND_NAME } from "@/lib/branding";

export interface PiWebBrandProps {
  className?: string;
  style?: React.CSSProperties;
  width?: number | string;
  height?: number | string;
  ariaLabel?: string;
  title?: string;
  priority?: boolean;
}

/**
 * Pi Web Plus 核心原生矢量品牌标识组件 (816x186 exact viewBox, 纯矢量无外链)
 * 平面蓝紫渐变双圆 + 精准贝塞尔白色 π 与独立 + 徽标 + 渐变 Plus
 * 文本字标采用 fill="currentColor"，自动适配暗黑/浅色及各种自定义 CSS 主题，
 * 支持 SSR 与首屏 0ms 秒开。
 */
export function PiWebBrand({
  className,
  style,
  width = 215,
  height = 49,
  ariaLabel = `π+ ${BRAND_NAME}`,
  title = `π+ ${BRAND_NAME}`,
}: PiWebBrandProps) {
  const c = BRAND_SVG_CONSTANTS;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={c.viewBox}
      width={width}
      height={height}
      preserveAspectRatio="xMinYMid meet"
      fill="none"
      role="img"
      aria-label={ariaLabel}
      className={className}
      style={{
        display: "block",
        flexShrink: 0,
        maxWidth: "100%",
        objectFit: "contain",
        objectPosition: "left center",
        ...style,
      }}
    >
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id="flatBlueViolet" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4F5AE8" />
          <stop offset="100%" stopColor="#7850E8" />
        </linearGradient>
        <linearGradient id="plusGradient" gradientUnits="userSpaceOnUse" x1="591" y1="56" x2="785" y2="140">
          <stop offset="0%" stopColor="#6E67F8" />
          <stop offset="25%" stopColor="#585BF9" />
          <stop offset="52%" stopColor="#3B4FFB" />
          <stop offset="78%" stopColor="#2563EB" />
          <stop offset="100%" stopColor="#1D4ED8" />
        </linearGradient>
      </defs>
      <g id="brand-graphic">
        <circle id="flat-main-disc" cx="91.2" cy="96" r="87.5" fill="url(#flatBlueViolet)" />
        <path id="symbol-pi" fill={c.symbolColor} d={c.piPath} />
        <circle id="flat-plus-disc" cx="167" cy="38" r="34" fill={c.plusDiscColor} stroke={c.symbolColor} strokeWidth="1.6" />
        <path id="symbol-plus" fill={c.symbolColor} d={c.plusPath} />
      </g>
      <g id="brand-typography">
        <text
          data-pi-brand-part="wordmark"
          fill="currentColor"
          fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
          fontSize={c.wordmark.fontSize}
          fontWeight={c.wordmark.fontWeight}
          letterSpacing={c.wordmark.letterSpacing}
        >
          <tspan x={c.wordmark.piX} y={c.wordmark.y} fill="currentColor">Pi</tspan>
          {" "}
          <tspan x={c.wordmark.webX} y={c.wordmark.y} fill="currentColor">Web</tspan>
          {" "}
          <tspan x={c.wordmark.plusX} y={c.wordmark.y} fill="url(#plusGradient)">Plus</tspan>
        </text>
      </g>
    </svg>
  );
}

export interface PiWebBrandIconProps {
  className?: string;
  style?: React.CSSProperties;
  size?: number | string;
  ariaLabel?: string;
}

/**
 * 单独圆盘 π+ 原生矢量图标组件（用于方形头像、登录页品牌等）
 */
export function PiWebBrandIcon({
  className,
  style,
  size = 48,
  ariaLabel = `π+ ${BRAND_NAME}`,
}: PiWebBrandIconProps) {
  const c = BRAND_SVG_CONSTANTS;
  const icon = BRAND_ICON_SVG_CONSTANTS;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={icon.viewBox}
      width={size}
      height={size}
      fill="none"
      role="img"
      aria-label={ariaLabel}
      className={className}
      style={{
        display: "block",
        flexShrink: 0,
        ...style,
      }}
    >
      <defs>
        <linearGradient id="iconFlatBlueViolet" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4F5AE8" />
          <stop offset="100%" stopColor="#7850E8" />
        </linearGradient>
      </defs>
      <g transform={icon.transform}>
        <g id="icon-brand-graphic">
          <circle id="icon-flat-main-disc" cx="91.2" cy="96" r="87.5" fill="url(#iconFlatBlueViolet)" />
          <path id="icon-symbol-pi" fill={c.symbolColor} d={c.piPath} />
          <circle id="icon-flat-plus-disc" cx="167" cy="38" r="34" fill={c.plusDiscColor} stroke={c.symbolColor} strokeWidth="1.6" />
          <path id="icon-symbol-plus" fill={c.symbolColor} d={c.plusPath} />
        </g>
      </g>
    </svg>
  );
}

export default PiWebBrand;
