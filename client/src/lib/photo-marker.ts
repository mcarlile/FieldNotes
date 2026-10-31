/** Makes a photo's URL absolute; relative paths can misbehave in Mapbox marker DOM elements. */
export function absolutePhotoUrl(url: string): string {
  return url.startsWith("http") || url.startsWith("//")
    ? url
    : `${window.location.origin}${url.startsWith("/") ? "" : "/"}${url}`;
}

/**
 * The round photo thumbnail pin shared by the trip map and the heat map.
 * Returns the marker root: Mapbox positions a marker by writing `transform`
 * on it, so the hover scale lives on the inner button.
 */
export function createPhotoMarkerElement(photo: { id: string; thumbnailUrl: string }, onClick: () => void): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.setAttribute("aria-label", "View photo");
  el.dataset.testid = `map-photo-marker-${photo.id}`;
  el.style.cssText = `
    width: 36px;
    height: 36px;
    padding: 0;
    background: #e8e4de;
    border: 2px solid #fff;
    border-radius: 50%;
    box-shadow: 0 2px 6px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.15);
    cursor: pointer;
    transition: transform 120ms ease;
    touch-action: manipulation;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  `;

  const img = document.createElement("img");
  img.src = absolutePhotoUrl(photo.thumbnailUrl);
  img.alt = "";
  // The heat map can hold hundreds of pins; only fetch the ones in view.
  img.loading = "lazy";
  img.decoding = "async";
  img.style.cssText = `
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    border-radius: 50%;
  `;
  img.onerror = () => { img.style.display = "none"; };
  el.appendChild(img);

  const markerRoot = document.createElement("div");
  markerRoot.appendChild(el);

  el.addEventListener("mouseenter", () => { el.style.transform = "scale(1.12)"; });
  el.addEventListener("mouseleave", () => { el.style.transform = "scale(1)"; });
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return markerRoot;
}
