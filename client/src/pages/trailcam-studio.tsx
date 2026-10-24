import { useEffect } from "react";
import { useLocation } from "wouter";

/**
 * Studio projects are trips now. Old links land on the trip
 * (/trailcam-studio?project=<id>) or on the trips that contain videos.
 */
export default function TrailcamStudioRedirect() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    const project = new URLSearchParams(window.location.search).get("project");
    setLocation(project ? `/field-notes/${encodeURIComponent(project)}` : "/dashboard?media=videos", { replace: true });
  }, [setLocation]);
  return null;
}
