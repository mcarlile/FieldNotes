import { useQuery } from "@tanstack/react-query";

export function useDesignPreview() {
  return useQuery({
    queryKey: ["design-preview-status"],
    enabled: import.meta.env.DEV,
    queryFn: async () => {
      const response = await fetch("/api/design-preview/status");
      return response.ok && (await response.json()).readOnly === true;
    },
    staleTime: Infinity,
    retry: false,
  });
}