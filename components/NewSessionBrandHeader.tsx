"use client";

import React, { useState, useEffect } from "react";
import { PiWebBrand } from "./PiWebBrand";
import { useI18n } from "@/hooks/useI18n";
import { BRAND_GITHUB_URL } from "@/lib/branding";
import type { AppUpdateResponse } from "@/lib/api-types";
import { isNewerReleaseVersion } from "@/lib/release-version";
import type { PiAgentReleaseStatus } from "@/lib/pi-update";

export interface NewSessionBrandHeaderProps {
  isMobile?: boolean;
  updateData?: AppUpdateResponse | null;
  releaseNotesLabel?: (version: string) => string;
  appVersion?: string;
  piVersion?: string;
}

export function NewSessionUpdateLink({
  label,
  updateData,
  installedVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0",
}: {
  label: (version: string) => string;
  installedVersion?: string;
  updateData?: AppUpdateResponse | null;
}) {
  const [update, setUpdate] = useState<AppUpdateResponse | null>(() => updateData ?? null);

  useEffect(() => {
    if (updateData !== undefined) {
      setUpdate(updateData);
      return;
    }
    const controller = new AbortController();
    void fetch("/api/app-update", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<AppUpdateResponse>;
      })
      .then((result) => {
        if (result?.updateAvailable && result.latestVersion && result.releaseUrl) {
          setUpdate(result);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [updateData]);

  if (!update?.updateAvailable || !isNewerReleaseVersion(update.latestVersion, installedVersion)) return null;
  const accessibleLabel = label(update.latestVersion);

  return (
    <a
      href={update.releaseUrl}
      target="_blank"
      rel="noopener noreferrer"
      data-pi-element="release-notes-link"
      title={accessibleLabel}
      aria-label={accessibleLabel}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = "transparent";
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        alignSelf: "center",
        gap: 3,
        minHeight: 28,
        minWidth: 0,
        padding: "0 6px",
        background: "transparent",
        borderRadius: 5,
        color: "var(--accent)",
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1.2,
        textDecoration: "none",
        transition: "background 0.12s",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>v{update.latestVersion}</span>
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={{ flexShrink: 0 }}
      >
        <path d="M7 17 17 7" />
        <path d="M7 7h10v10" />
      </svg>
    </a>
  );
}

export function NewSessionBrandHeader({
  isMobile = false,
  updateData,
  releaseNotesLabel,
  appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0",
  piVersion = process.env.NEXT_PUBLIC_PI_VERSION ?? "0.0.0",
}: NewSessionBrandHeaderProps) {
  const { t } = useI18n();
  const [piRelease, setPiRelease] = useState<PiAgentReleaseStatus | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void fetch("/api/pi-update", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<PiAgentReleaseStatus>;
      })
      .then((result) => {
        if (active && result?.latestVersion && result.releaseUrl) setPiRelease(result);
      })
      .catch(() => {});
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  const getReleaseLabel = releaseNotesLabel ?? ((version: string) => t("appUpdate.releaseNotes", { version }));

  return (
    <div
      data-pi-element="new-session-brand-header"
      className="mb-3 w-full"
      style={{
        paddingLeft: 16,
        paddingRight: isMobile ? 16 : 52,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          maxWidth: "var(--chat-content-max-width, 820px)",
          margin: "0 auto",
          fontFamily: "var(--font-mono)",
        }}
      >
        <div
          data-pi-element="brand-and-update-row"
          style={{
            display: "flex",
            alignItems: "center",
            gap: isMobile ? "4px 8px" : 10,
            minWidth: 0,
            flex: 1,
            lineHeight: 1.4,
            flexWrap: "wrap",
          }}
        >
          <PiWebBrand
            width={isMobile ? 180 : 200}
            height={isMobile ? 28.8 : 32}
            style={{ flexShrink: 0 }}
          />
          <NewSessionUpdateLink label={getReleaseLabel} updateData={updateData} installedVersion={appVersion} />
        </div>
        <div
          data-pi-element="version-info-col"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 2,
            flexShrink: 0,
          }}
        >
          <a
            href={BRAND_GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            data-pi-element="web-version"
            title={`打开 GitHub 仓库 (${BRAND_GITHUB_URL})`}
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              textDecoration: "none",
              cursor: "pointer",
              transition: "opacity 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.75")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >
            web <span style={{ color: "var(--text)" }}>v{appVersion}</span>
          </a>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
            <span
              data-pi-element="pi-version"
              title={`当前已安装的 Pi Agent 版本：v${piVersion}`}
              style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}
            >
              pi <span style={{ color: "var(--text)" }}>v{piVersion}</span>
            </span>
            {piRelease?.latestVersion && piRelease.releaseUrl && isNewerReleaseVersion(piRelease.latestVersion, piVersion) ? (
              <a
                href={piRelease.releaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-pi-element="pi-latest-release"
                title={`GitHub 官方最新版本：v${piRelease.latestVersion}（当前已安装：v${piVersion}）`}
                aria-label={`在 GitHub 查看 Pi Agent 最新版本 v${piRelease.latestVersion}；当前已安装 v${piVersion}`}
                style={{ fontSize: 11, color: "var(--accent)", textDecoration: "none", whiteSpace: "nowrap" }}
              >
                v{piRelease.latestVersion} ↗
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default NewSessionBrandHeader;
