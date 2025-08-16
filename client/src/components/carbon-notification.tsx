import { useEffect, useState } from "react";
import { InlineNotification } from "@carbon/react";
import { useToast } from "@/hooks/use-toast";

export function CarbonNotificationContainer() {
  const { toasts, dismiss } = useToast();
  const [visibleToasts, setVisibleToasts] = useState<typeof toasts>([]);
  const [dismissTimers, setDismissTimers] = useState<Map<string, NodeJS.Timeout>>(new Map());

  useEffect(() => {
    setVisibleToasts(toasts);
    
    // Auto-dismiss new toasts after 3 seconds
    toasts.forEach((toast) => {
      // Only set timer if toast doesn't already have one
      if (!dismissTimers.has(toast.id)) {
        const timer = setTimeout(() => {
          dismiss(toast.id);
          setDismissTimers(prev => {
            const newMap = new Map(prev);
            newMap.delete(toast.id);
            return newMap;
          });
        }, 3000);
        
        setDismissTimers(prev => new Map(prev).set(toast.id, timer));
      }
    });
    
    // Clean up timers for toasts that no longer exist
    dismissTimers.forEach((timer, toastId) => {
      if (!toasts.find(t => t.id === toastId)) {
        clearTimeout(timer);
        setDismissTimers(prev => {
          const newMap = new Map(prev);
          newMap.delete(toastId);
          return newMap;
        });
      }
    });
  }, [toasts, dismiss]);
  
  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      dismissTimers.forEach(timer => clearTimeout(timer));
    };
  }, [dismissTimers]);

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
        <div 
          key={toast.id}
          className="transition-all duration-300 ease-in-out animate-in slide-in-from-right-2"
          style={{
            animation: toast.open === false ? 'slideOut 300ms ease-in-out forwards' : undefined
          }}
        >
          <InlineNotification
            kind={getNotificationKind(toast.variant)}
            title={toast.title?.toString() || ""}
            subtitle={toast.description?.toString() || ""}
            onClose={() => dismiss(toast.id)}
            hideCloseButton={false}
            lowContrast
          />
        </div>
      ))}
    </div>
  );
}