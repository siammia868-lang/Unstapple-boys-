/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { User } from '../types.js';

interface MapContainerProps {
  users: User[];
  currentUserId: string;
  onShareLocation: (lat: number, lng: number) => void;
  onDisableLocation: () => void;
  isSharing: boolean;
}

export default function MapContainer({
  users,
  currentUserId,
  onShareLocation,
  onDisableLocation,
  isSharing,
}: MapContainerProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any | null>(null);
  const markersRef = useRef<Record<string, any>>({});
  const [leafletError, setLeafletError] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Filter users who are actively sharing location
  const sharingUsers = users.filter((u) => u.shareLocationEnabled && u.latitude && u.longitude);

  useEffect(() => {
    // Wait for window.L (Leaflet) to load globally from index.html
    const checkLeaflet = setInterval(() => {
      if ((window as any).L) {
        clearInterval(checkLeaflet);
        initMap();
      }
    }, 200);

    // Timeout if Leaflet takes too long (fallback interface)
    const timeout = setTimeout(() => {
      clearInterval(checkLeaflet);
      if (!(window as any).L) {
        setLeafletError('Leaflet maps could not load. Displaying the Radar Coordinate list instead.');
      }
    }, 4000);

    return () => {
      clearInterval(checkLeaflet);
      clearTimeout(timeout);
      if (mapRef.current) {
        try {
          mapRef.current.remove();
          mapRef.current = null;
        } catch (e) {
          console.error('Error cleaning up map:', e);
        }
      }
    };
  }, []);

  const initMap = () => {
    if (!mapContainerRef.current || mapRef.current || !(window as any).L) return;

    try {
      const L = (window as any).L;

      // Default center is New York or first sharing user's position
      let defaultCenter: [number, number] = [40.7128, -74.006];
      if (sharingUsers.length > 0) {
        defaultCenter = [sharingUsers[0].latitude!, sharingUsers[0].longitude!];
      }

      // Initialize map
      const map = L.map(mapContainerRef.current, {
        zoomControl: true,
        attributionControl: false,
      }).setView(defaultCenter, 13);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
      }).addTo(map);

      mapRef.current = map;
      setMapLoaded(true);
    } catch (err: any) {
      console.error('Failed to initialize Leaflet Map', err);
      setLeafletError('Could not initialize the interactive map canvas.');
    }
  };

  // Update markers when users move or toggle sharing
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !(window as any).L) return;

    const L = (window as any).L;
    const map = mapRef.current;
    const currentMarkers = markersRef.current;

    // Remove obsolete markers
    Object.keys(currentMarkers).forEach((uid) => {
      const isStillSharing = sharingUsers.some((u) => u.uid === uid);
      if (!isStillSharing) {
        currentMarkers[uid].remove();
        delete currentMarkers[uid];
      }
    });

    // Create or update markers
    sharingUsers.forEach((user) => {
      const { uid, username, latitude, longitude, photoURL, statusText } = user;
      if (!latitude || !longitude) return;

      const position: [number, number] = [latitude, longitude];

      // Create a gorgeous custom HTML pulsing radar marker
      const customIcon = L.divIcon({
        html: `
          <div class="relative flex items-center justify-center">
            <span class="absolute inline-flex h-11 w-11 animate-ping rounded-full bg-emerald-400/30 opacity-75"></span>
            <div class="relative flex items-center justify-center h-9 w-9 rounded-full border-2 border-emerald-500 bg-slate-900 overflow-hidden shadow-lg shadow-emerald-500/20">
              <img src="${photoURL}" class="h-full w-full object-cover" onerror="this.onerror=null; this.src='https://api.dicebear.com/7.x/pixel-art/svg?seed=${username}'" />
            </div>
          </div>
        `,
        className: 'custom-leaflet-marker-pulse',
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });

      if (currentMarkers[uid]) {
        // Move existing marker smoothly
        currentMarkers[uid].setLatLng(position);
      } else {
        // Create new marker
        const marker = L.marker(position, { icon: customIcon }).addTo(map);
        
        // Attach interactive popup
        const elapsed = 'Just updated';
        const popupContent = `
          <div class="p-2 min-w-[160px]">
            <div class="flex items-center gap-2 mb-1.5">
              <img class="w-6 h-6 rounded-full bg-slate-800" src="${photoURL}" />
              <b class="text-xs font-semibold text-slate-100">${username}</b>
            </div>
            <p class="text-[11px] text-gray-300 italic mb-1">"${statusText || 'No status active'}"</p>
            <div class="text-[9px] text-emerald-400 font-mono">
              LAT: ${latitude.toFixed(5)}<br/>
              LNG: ${longitude.toFixed(5)}
            </div>
          </div>
        `;
        marker.bindPopup(popupContent);
        currentMarkers[uid] = marker;
      }
    });

    // Fit map bounds if there are markers to show
    if (sharingUsers.length > 0) {
      const bounds = sharingUsers.map((u) => [u.latitude!, u.longitude!] as [number, number]);
      try {
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
      } catch (e) {
        // Safe check
      }
    }
  }, [sharingUsers, mapLoaded]);

  // Handle Geolocation Request
  const requestLocation = () => {
    if (!navigator.geolocation) {
      alert('Your browser does not support geolocation tracking.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        onShareLocation(latitude, longitude);
      },
      (err) => {
        console.error('Geolocation lookup failed:', err);
        alert(`Location collection failed: ${err.message}. Please verify browser frame permissions!`);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  return (
    <div className="flex flex-col h-full bg-[#111827] border border-slate-800 rounded-xl overflow-hidden relative" id="radar-container">
      {/* Top action header bar */}
      <div className="p-4 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div>
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            Live Boys Radar map
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Plot your location dynamically in real-time to meet up with the crew.
          </p>
        </div>

        <div className="flex gap-2">
          {isSharing ? (
            <button
              onClick={onDisableLocation}
              id="stop-sharing-btn"
              className="px-3 py-1.5 rounded-lg bg-orange-600/20 hover:bg-orange-600/35 border border-orange-500/30 text-orange-400 text-xs font-medium cursor-pointer transition-colors"
            >
              Stop Sharing Location
            </button>
          ) : (
            <button
              onClick={requestLocation}
              id="share-location-btn"
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-900/30 cursor-pointer transition-all flex items-center gap-1.5"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
              </svg>
              Share My Location
            </button>
          )}
        </div>
      </div>

      {/* Main map canvas area */}
      <div className="flex-1 relative bg-slate-950 flex flex-col items-center justify-center min-h-[300px]">
        {leafletError ? (
          <div className="text-center p-6 max-w-sm absolute z-10">
            <div className="text-amber-500 text-3xl mb-2">⚠️</div>
            <p className="text-sm text-slate-300 font-medium mb-3">{leafletError}</p>
          </div>
        ) : !mapLoaded ? (
          <div className="text-center text-slate-400 text-sm flex flex-col items-center gap-2">
            <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            Booting Live Map Canvas...
          </div>
        ) : null}

        <div
          ref={mapContainerRef}
          className="w-full h-full dark-map"
          style={{ visibility: mapLoaded && !leafletError ? 'visible' : 'hidden', position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
        />
      </div>

      {/* Active sharing checklist overlay sidebar style */}
      <div className="bg-slate-900/90 border-t border-slate-800 p-3 flex flex-wrap items-center gap-3 shrink-0 text-xs text-slate-400">
        <span className="font-mono text-[10px] text-emerald-400 font-bold uppercase tracking-wider">
          ACTIVE ON RADER ({sharingUsers.length}):
        </span>
        <div className="flex flex-wrap items-center gap-2 overflow-x-auto max-w-full">
          {sharingUsers.length === 0 ? (
            <span className="text-slate-500 italic">No one is currently broadcasting location coordinates. Be the first!</span>
          ) : (
            sharingUsers.map((user) => (
              <div
                key={user.uid}
                className="flex items-center gap-1.5 bg-slate-800 border border-slate-700/50 rounded-full px-2 py-0.5 max-w-[150px]"
                title={`Last updated at ${user.locationSharedAt}`}
              >
                <img src={user.photoURL} className="w-4 h-4 rounded-full bg-slate-800 border border-slate-600" />
                <span className="font-medium text-slate-200 truncate">{user.username}</span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow shadow-emerald-400 animate-pulse" />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
