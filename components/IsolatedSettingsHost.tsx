"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useI18n } from "@/hooks/useI18n";
import { settingsExtensionRegistry, type SettingsExtensionContext } from "@/lib/settings-extensions";

interface Props {
  id: string;
  sectionId: string;
  className: string;
  onClose: () => void;
  activateSection: (id: string) => boolean;
  availableSections: readonly string[];
  cwd: string | null;
  sessionId: string | null;
  hideWhenEmpty?: boolean;
  showLoading?: boolean;
  fill?: boolean;
}

const noServerRenderer = () => undefined;

/** React owns the empty host; the registered renderer exclusively owns its children. */
export function IsolatedSettingsHost(props: Props) {
  const { id, sectionId, className, hideWhenEmpty, showLoading, fill } = props;
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const currentProps = useRef(props);
  currentProps.current = props;

  const subscribe = useCallback(
    (listener: () => void) => settingsExtensionRegistry.subscribeRenderer(id, listener),
    [id],
  );
  const getRenderer = useCallback(() => settingsExtensionRegistry.getRenderer(id), [id]);
  const renderer = useSyncExternalStore(subscribe, getRenderer, noServerRenderer);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !renderer) return;

    const context: SettingsExtensionContext = {
      onClose: () => currentProps.current.onClose(),
      activateSection: (nextId) => currentProps.current.activateSection(nextId),
      nav: {
        currentSection: sectionId,
        get availableSections() { return currentProps.current.availableSections; },
        get cwd() { return currentProps.current.cwd; },
        get sessionId() { return currentProps.current.sessionId; },
      },
    };

    let cleanup: (() => void) | void;
    try {
      cleanup = renderer(host, context);
    } catch (error) {
      host.replaceChildren();
      console.error(`Error mounting settings host ${id}:`, error);
    }

    return () => {
      try {
        if (typeof cleanup === "function") cleanup();
      } catch (error) {
        console.error(`Error cleaning up settings host ${id}:`, error);
      } finally {
        host.replaceChildren();
      }
    };
  }, [id, renderer, sectionId]);

  return (
    <>
      {showLoading && !renderer && (
        <div className="settings-extension-loading" role="status">{t("common.loading")}</div>
      )}
      <div
        ref={hostRef}
        className={className}
        data-host-id={id}
        hidden={Boolean(hideWhenEmpty && !renderer)}
        style={fill ? { width: "100%", height: "100%", minHeight: 0 } : undefined}
      />
    </>
  );
}
