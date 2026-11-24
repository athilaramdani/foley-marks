import { useCallback, useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { native } from "./bridge";
type Status =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "installing"
  | "error";
export function useUpdates(auto: boolean, saveWork: () => Promise<void>) {
  const [status, setStatus] = useState<Status>("idle"),
    [error, setError] = useState(""),
    [progress, setProgress] = useState<number | null>(null);
  const [info, setInfo] = useState<{ version: string; body: string } | null>(
    null,
  );
  const update = useRef<Update | null>(null),
    busy = useRef(false);
  const checkNow = useCallback(async () => {
    if (!native || busy.current) return;
    busy.current = true;
    setStatus("checking");
    setError("");
    try {
      const next = await check({ timeout: 20000 });
      await update.current?.close();
      update.current = next;
      setInfo(next ? { version: next.version, body: next.body || "" } : null);
      setStatus(next ? "available" : "current");
    } catch (e) {
      setError(String(e));
      setStatus("error");
    } finally {
      busy.current = false;
    }
  }, []);
  useEffect(() => {
    if (auto) void checkNow();
  }, [auto, checkNow]);
  const install = async () => {
    const next = update.current;
    if (!next || busy.current) return;
    busy.current = true;
    setStatus("downloading");
    setProgress(null);
    try {
      let received = 0,
        size = 0;
      await next.download((ev) => {
        if (ev.event === "Started") size = ev.data.contentLength || 0;
        if (ev.event === "Progress") {
          received += ev.data.chunkLength;
          if (size)
            setProgress(Math.min(100, Math.floor((received / size) * 100)));
        }
      });
      await saveWork();
      setStatus("installing");
      await next.install();
      await relaunch();
    } catch (e) {
      setError(String(e));
      setStatus("error");
    } finally {
      busy.current = false;
    }
  };
  return { status, error, progress, info, checkNow, install };
}
