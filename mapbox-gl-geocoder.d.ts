declare module "@mapbox/mapbox-gl-geocoder" {
    import { IControl, LngLatLike, Map } from "mapbox-gl";

    export interface GeocoderOptions {
      accessToken?: string;
      mapboxgl?: typeof import("mapbox-gl");
      marker?: boolean | object;
      zoom?: number;
      flyTo?: boolean;
      placeholder?: string;
      bbox?: number[];
      proximity?: LngLatLike;
    }

    export default class MapboxGeocoder implements IControl {
      constructor(options?: GeocoderOptions);
      onAdd(map: Map): HTMLElement;
      onRemove(): void;
      getResult(): unknown;
      on<Event = unknown>(type: string, listener: (e: Event) => void): void;
      off<Event = unknown>(type: string, listener: (e: Event) => void): void;
    }
  }

