import { useEffect, useRef } from "react";
import { useSetAtom } from "jotai";
import { toast } from "sonner";
import { vodStatusAtom } from "@/store/flowStore";
import type { VodStatus } from "@/store/flowStore";
import { VodUploadToast, VOD_TOAST_ID } from "@/components/vod-upload-toast";

export function useVodTracking() {
  const setVodStatus = useSetAtom(vodStatusAtom);
  const toastActiveRef = useRef(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleVodStatus = (status: VodStatus) => {
      setVodStatus(status);

      if (!toastActiveRef.current) {
        toastActiveRef.current = true;
        toast.custom(() => <VodUploadToast />, {
          id: VOD_TOAST_ID,
          duration: Infinity,
        });
      }

      if (["found", "not_found", "error"].includes(status.phase)) {
        if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = setTimeout(() => {
          toast.dismiss(VOD_TOAST_ID);
          setVodStatus(null);
          toastActiveRef.current = false;
        }, status.phase === "error" ? 10_000 : 20_000);
      }
    };

    window.electron.onVodStatus(handleVodStatus);
    return () => {
      window.electron.removeOnVodStatus();
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [setVodStatus]);
}
