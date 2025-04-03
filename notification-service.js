// Notification Service for Medicine Reminder App
class NotificationService {
  constructor() {
    this.audioContext = null;
    this.oscillator = null;
    this.audioElement = null;
    this.currentReminder = null;
    this.snoozeTimeout = null;
    this.missedCount = 0;
    this.MAX_MISSED = 3; // After 3 misses, escalate to emergency contact
    this.SNOOZE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

    // Initialize service worker for push notifications
    this.initServiceWorker();
  }

  async initServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        this.registration = await navigator.serviceWorker.register('firebase-messaging-sw.js');
        console.log('ServiceWorker registration successful');
      } catch (err) {
        console.error('ServiceWorker registration failed:', err);
      }
    }
  }

  // Play alert sound
  playAlertSound() {
    try {
      // Try to play recorded voice reminder first
      if (this.currentReminder?.voiceReminderUrl) {
        this.audioElement = new Audio(this.currentReminder.voiceReminderUrl);
        this.audioElement.play();
        return;
      }

      // Fallback to browser-generated alert sound
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();

      this.oscillator.type = 'sine';
      this.oscillator.frequency.setValueAtTime(800, this.audioContext.currentTime);
      gainNode.gain.setValueAtTime(0.5, this.audioContext.currentTime);

      this.oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      // Pulsing effect
      gainNode.gain.exponentialRampToValueAtTime(
        0.3, 
        this.audioContext.currentTime + 0.5
      );
      gainNode.gain.exponentialRampToValueAtTime(
        0.5, 
        this.audioContext.currentTime + 1
      );

      this.oscillator.start();
    } catch (err) {
      console.error('Error playing alert sound:', err);
    }
  }

  // Stop alert sound
  stopAlertSound() {
    try {
      if (this.audioElement) {
        this.audioElement.pause();
        this.audioElement = null;
      }
      
      if (this.oscillator) {
        this.oscillator.stop();
        this.oscillator = null;
      }
    } catch (err) {
      console.error('Error stopping alert sound:', err);
    }
  }

  // Vibrate device (if supported)
  vibrateDevice() {
    if ('vibrate' in navigator) {
      navigator.vibrate([500, 250, 500, 250, 500]);
    }
  }

  // Show notification
  async showNotification(reminder) {
    this.currentReminder = reminder;
    
    // Play sound and vibrate
    this.playAlertSound();
    this.vibrateDevice();

    // Show browser notification
    if ('Notification' in window && Notification.permission === 'granted') {
      const notification = new Notification('Medicine Reminder', {
        body: `Time to take ${reminder.medicineName} (${reminder.dosage})`,
        icon: '/assets/icons/pill.png',
        requireInteraction: true,
        actions: [
          { action: 'taken', title: 'Taken ✅' },
          { action: 'snooze', title: 'Snooze ⏳' }
        ]
      });

      notification.onclick = (event) => {
        event.preventDefault();
        this.handleResponse('taken');
      };

      notification.onclose = () => {
        this.handleMissedReminder();
      };
    } else {
      // Fallback to custom modal if notifications not supported
      this.showCustomAlertModal();
    }

    // Start missed reminder timer
    this.missedTimeout = setTimeout(() => {
      this.handleMissedReminder();
    }, 2 * 60 * 1000); // 2 minutes
  }

  // Show custom alert modal (fallback when notifications not available)
  showCustomAlertModal() {
    const modal = document.createElement('div');
    modal.id = 'reminder-modal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
    modal.innerHTML = `
      <div class="bg-white rounded-lg p-6 max-w-sm w-full">
        <h3 class="text-xl font-bold mb-2">Medicine Reminder</h3>
        <p class="mb-4">Time to take ${this.currentReminder.medicineName} (${this.currentReminder.dosage})</p>
        <div class="flex justify-between">
          <button id="taken-btn" class="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600">
            Taken ✅
          </button>
          <button id="snooze-btn" class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
            Snooze ⏳
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    document.getElementById('taken-btn').addEventListener('click', () => this.handleResponse('taken'));
    document.getElementById('snooze-btn').addEventListener('click', () => this.handleResponse('snooze'));
  }

  // Handle user response to reminder
  handleResponse(action) {
    clearTimeout(this.missedTimeout);
    this.stopAlertSound();
    this.removeCustomModal();

    if (action === 'taken') {
      this.markAsTaken();
      this.missedCount = 0;
    } else if (action === 'snooze') {
      this.snoozeReminder();
    }
  }

  // Handle missed reminder
  handleMissedReminder() {
    this.missedCount++;
    this.stopAlertSound();
    this.removeCustomModal();

    if (this.missedCount >= this.MAX_MISSED) {
      this.escalateToEmergencyContact();
    } else {
      // Repeat the reminder
      setTimeout(() => {
        this.showNotification(this.currentReminder);
      }, 1 * 60 * 1000); // Try again in 1 minute
    }
  }

  // Mark medicine as taken
  async markAsTaken() {
    try {
      const user = firebase.auth().currentUser;
      if (!user) return;

      await firebase.firestore().collection('dose_logs').add({
        userId: user.uid,
        reminderId: this.currentReminder.id,
        medicineName: this.currentReminder.medicineName,
        dosage: this.currentReminder.dosage,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        status: 'taken'
      });

      // Schedule next reminder if recurring
      if (this.currentReminder.frequency !== 'once') {
        await this.scheduleNextReminder();
      }
    } catch (err) {
      console.error('Error marking as taken:', err);
    }
  }

  // Snooze the reminder
  snoozeReminder() {
    this.snoozeTimeout = setTimeout(() => {
      this.showNotification(this.currentReminder);
    }, this.SNOOZE_DURATION);
  }

  // Schedule next occurrence of recurring reminder
  async scheduleNextReminder() {
    try {
      const now = new Date();
      let nextDate = new Date(this.currentReminder.nextReminder.toDate());

      switch (this.currentReminder.frequency) {
        case 'daily':
          nextDate.setDate(nextDate.getDate() + 1);
          break;
        case 'weekly':
          nextDate.setDate(nextDate.getDate() + 7);
          break;
        case 'specific_days':
          // Find next occurrence from selected days
          const days = this.currentReminder.days || [];
          if (days.length === 0) return;
          
          let found = false;
          for (let i = 1; i <= 7 && !found; i++) {
            nextDate.setDate(nextDate.getDate() + 1);
            const dayName = nextDate.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
            if (days.includes(dayName)) {
              found = true;
            }
          }
          break;
      }

      // Update the reminder with next occurrence
      await firebase.firestore().collection('reminders').doc(this.currentReminder.id).update({
        nextReminder: firebase.firestore.Timestamp.fromDate(nextDate)
      });
    } catch (err) {
      console.error('Error scheduling next reminder:', err);
    }
  }

  // Escalate to emergency contact
  async escalateToEmergencyContact() {
    try {
      const user = firebase.auth().currentUser;
      if (!user) return;

      // Get user's emergency contacts
      const userDoc = await firebase.firestore().collection('users').doc(user.uid).get();
      const emergencyContacts = userDoc.data()?.emergencyContacts || [];

      // Log escalation event
      await firebase.firestore().collection('escalation_events').add({
        userId: user.uid,
        reminderId: this.currentReminder.id,
        medicineName: this.currentReminder.medicineName,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        contactsNotified: emergencyContacts.map(c => c.phone || c.email),
        status: 'pending'
      });

      // TODO: Implement actual notification to contacts
      // This would use Twilio API for SMS or EmailJS for emails
      console.log('Escalating to emergency contacts:', emergencyContacts);
    } catch (err) {
      console.error('Error escalating to emergency contact:', err);
    }
  }

  // Remove custom modal if present
  removeCustomModal() {
    const modal = document.getElementById('reminder-modal');
    if (modal) {
      modal.remove();
    }
  }
}

// Initialize notification service
const notificationService = new NotificationService();

// Listen for reminders from Firestore
function setupReminderListener() {
  const user = firebase.auth().currentUser;
  if (!user) return;

  firebase.firestore().collection('reminders')
    .where('userId', '==', user.uid)
    .where('nextReminder', '<=', firebase.firestore.Timestamp.fromDate(new Date()))
    .where('active', '==', true)
    .onSnapshot((snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const reminder = {
            id: change.doc.id,
            ...change.doc.data()
          };
          notificationService.showNotification(reminder);
        }
      });
    });
}

// Request notification permission
async function requestNotificationPermission() {
  if ('Notification' in window) {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }
  return false;
}

// Export for use in other files
export { notificationService, setupReminderListener, requestNotificationPermission };