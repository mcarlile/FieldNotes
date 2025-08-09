import { useEffect, useState } from "react";
import { InlineNotification } from "@carbon/react";
import { useToast } from "@/hooks/use-toast";

export function CarbonNotificationContainer() {
  const { toasts, dismiss } = useToast();
  const [visibleToasts, setVisibleToasts] = useState<typeof toasts>([]);

  useEffect(() => {
    setVisibleToasts(toasts);
  }, [toasts]);

  const getNotificationKind = (variant?: string) => {
    switch (variant) {
      case "destructive":
        return "error";
      case "success":
        return "success";
      default:
        return "info";
    }
  };

  if (visibleToasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2">
      {visibleToasts.map((toast) => (
        <InlineNotification
          key={toast.id}
          kind={getNotificationKind(toast.variant)}
          title={toast.title?.toString() || ""}
          subtitle={toast.description?.toString() || ""}
          onClose={() => dismiss(toast.id)}
          hideCloseButton={false}
          lowContrast
        />
      ))}
    </div>
  );
}