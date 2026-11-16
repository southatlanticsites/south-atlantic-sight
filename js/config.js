// South Atlantic Sight settings. Everything in this file is public.
window.SIGHT_CONFIG = {
  // Google Maps browser key. Restrict it by HTTP referrer in Google Cloud to
  // southatlanticsites.github.io/* (browser keys are always visible to visitors).
  mapsKey: 'AIzaSyCoqCH6BGDq4K-DDZs1XnWnuSGRAzviS00',
  // Listings are read live from the existing SAS property map so there is one source of truth.
  listingsUrl: 'https://southatlanticsites.github.io/sas-property-map/index.html',
  listingsFallback: 'data/listings.json',
  home: { lat: 35.55, lng: -79.4, zoom: 7 },
  // The map stays on North Carolina; the margin leaves room to pan at statewide zoom.
  bounds: { north: 39.6, south: 30.9, west: -89.5, east: -70.5 },
  // Layers switched on for a first-time visitor.
  defaultLayers: ['listings', 'parcels']
};
