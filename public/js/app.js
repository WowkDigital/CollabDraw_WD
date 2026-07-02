import { CanvasManager } from './canvas.js';
import { SyncManager } from './sync.js';
import { UIManager } from './ui.js';

document.addEventListener('DOMContentLoaded', () => {
  // 1. PWA Service Worker Registration
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then((registration) => {
          console.log('ServiceWorker registered with scope: ', registration.scope);
        })
        .catch((error) => {
          console.error('ServiceWorker registration failed: ', error);
        });
    });
  }

  // 2. Prevent default browser scrolling and multi-touch gestures on the page
  const preventDefaultGestures = (e) => {
    // Only prevent default on the body/html level if touch target is not input fields
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT' && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
    }
  };
  
  document.addEventListener('touchmove', preventDefaultGestures, { passive: false });
  document.addEventListener('gesturestart', preventDefaultGestures);
  document.addEventListener('gesturechange', preventDefaultGestures);

  // 3. Initialize Core Managers
  const canvasManager = new CanvasManager('canvas-container');
  const syncManager = new SyncManager();
  
  // 4. Initialize UI manager to connect all handlers
  const uiManager = new UIManager(canvasManager, syncManager);

  // Expose instances to window for debugging if necessary
  window.__codraw__ = {
    canvas: canvasManager,
    sync: syncManager,
    ui: uiManager
  };
});
