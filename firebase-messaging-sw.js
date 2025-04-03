// Firebase Service Worker for Push Notifications
importScripts('https://www.gstatic.com/firebasejs/8.10.0/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.10.0/firebase-messaging.js');

// Initialize Firebase
firebase.initializeApp({
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
});

const messaging = firebase.messaging();

// Background message handler
messaging.setBackgroundMessageHandler((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message', payload);
  
  // Customize notification here
  const notificationTitle = payload.data.title || 'Medicine Reminder';
  const notificationOptions = {
    body: payload.data.body || 'Time to take your medicine',
    icon: '/assets/icons/pill.png',
    data: { 
      url: payload.data.url || '/dashboard.html',
      reminderId: payload.data.reminderId
    }
  };

  return self.registration.showNotification(
    notificationTitle,
    notificationOptions
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  console.log('Notification click received.', event.notification.data);
  
  // Close the notification
  event.notification.close();
  
  // Open the app
  event.waitUntil(
    clients.matchAll({type: 'window'}).then((clientList) => {
      for (const client of clientList) {
        if (client.url === '/' && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(event.notification.data.url || '/dashboard.html');
      }
    })
  );
});

// Listen for periodic sync events for offline functionality
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'check-reminders') {
    console.log('Checking for reminders in background...');
    event.waitUntil(
      checkPendingReminders()
        .catch(err => console.error('Error checking reminders:', err))
    );
  }
});

async function checkPendingReminders() {
  // This would check IndexedDB for reminders that need to be synced
  // when the device comes back online
  console.log('Checking for pending reminders...');
}